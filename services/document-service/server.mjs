/**
 * Document service.
 *
 * Wraps ghostscript / poppler / qpdf / tesseract behind a small HTTP API so the
 * Next.js PDF routes can use them from Vercel, where native binaries are not
 * available.
 *
 * Deliberately dependency-free (Node built-ins only): nothing to npm-install in
 * the image, nothing to keep patched beyond the base image itself.
 *
 * Contract
 *   All operations: POST, body = raw PDF bytes, Authorization: Bearer <token>.
 *   Secrets (PDF passwords) travel in headers, never the query string, so they
 *   stay out of access logs.
 *
 *   POST /compress?targetBytes=1048576  -> application/pdf
 *   POST /convert?format=png|jpg|webp   -> application/zip  (one image per page)
 *   POST /encrypt   x-pdf-password: ..  -> application/pdf
 *   POST /decrypt   x-pdf-password: ..  -> application/pdf
 *   POST /ocr?lang=eng                  -> application/pdf  (searchable)
 *   GET  /health                        -> application/json
 */
import { createServer } from "node:http"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { timingSafeEqual } from "node:crypto"

const execFileAsync = promisify(execFile)

const PORT = Number(process.env.PORT || 8080)
const TOKEN = process.env.DOCUMENT_SERVICE_TOKEN || ""
// 100 MB ceiling: large enough for scanned decks, small enough to bound memory.
const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024)
const EXEC_TIMEOUT_MS = Number(process.env.EXEC_TIMEOUT_MS || 240_000)

if (!TOKEN) {
  console.error("DOCUMENT_SERVICE_TOKEN is required — refusing to start unauthenticated.")
  process.exit(1)
}

/** Constant-time bearer check. */
function authorized(req) {
  const header = req.headers.authorization || ""
  const presented = header.startsWith("Bearer ") ? header.slice(7) : ""
  const a = Buffer.from(presented)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on("data", (chunk) => {
      total += chunk.length
      if (total > MAX_BYTES) {
        reject(Object.assign(new Error("Payload too large"), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

async function run(bin, args) {
  // execFile (not exec) — arguments are passed as an array and never reach a
  // shell, so filenames and passwords cannot be interpreted as shell syntax.
  return execFileAsync(bin, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })
}

/** Ghostscript quality preset for a requested compression ratio. */
function presetFor(ratio) {
  if (ratio < 0.3) return "/screen"
  if (ratio < 0.5) return "/ebook"
  if (ratio < 0.7) return "/printer"
  return "/prepress"
}

async function gsCompress(input, output, preset, dpi) {
  await run("gs", [
    "-dNOPAUSE",
    "-dBATCH",
    "-dSAFER",
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.4",
    `-dPDFSETTINGS=${preset}`,
    `-dColorImageResolution=${dpi}`,
    `-dGrayImageResolution=${dpi}`,
    `-dMonoImageResolution=${dpi}`,
    "-dDownsampleColorImages=true",
    "-dDownsampleGrayImages=true",
    "-dDownsampleMonoImages=true",
    `-sOutputFile=${output}`,
    input,
  ])
}

const handlers = {
  async compress({ body, url, dir }) {
    const input = path.join(dir, "in.pdf")
    const output = path.join(dir, "out.pdf")
    await writeFile(input, body)

    const targetBytes = Number(url.searchParams.get("targetBytes")) || 0
    const ratio = targetBytes > 0 ? targetBytes / body.length : 0.5

    // Escalate through progressively harsher settings, stopping as soon as the
    // target is met, so we never degrade a document more than necessary.
    const attempts = [
      { preset: presetFor(ratio), dpi: 150 },
      { preset: "/ebook", dpi: 110 },
      { preset: "/screen", dpi: 72 },
      { preset: "/screen", dpi: 50 },
    ]

    let best = null
    for (const attempt of attempts) {
      await gsCompress(input, output, attempt.preset, attempt.dpi)
      const result = await readFile(output)
      if (!best || result.length < best.length) best = result
      if (targetBytes > 0 && best.length <= targetBytes) break
      if (targetBytes === 0) break
    }

    return {
      type: "application/pdf",
      body: best,
      headers: {
        "x-original-bytes": String(body.length),
        "x-result-bytes": String(best.length),
        "x-target-bytes": String(targetBytes),
        "x-target-met": String(targetBytes === 0 || best.length <= targetBytes),
      },
    }
  },

  async convert({ body, url, dir }) {
    const requested = (url.searchParams.get("format") || "png").toLowerCase()
    const format = ["png", "jpg", "jpeg", "webp"].includes(requested) ? requested : "png"
    const input = path.join(dir, "in.pdf")
    await writeFile(input, body)

    // pdftoppm emits PNG or JPEG; webp is produced by the caller via sharp.
    const flag = format === "jpg" || format === "jpeg" ? "-jpeg" : "-png"
    await run("pdftoppm", [flag, "-r", "150", input, path.join(dir, "page")])

    const produced = (await readdir(dir)).filter((f) => f.startsWith("page") && !f.endsWith(".pdf")).sort()
    if (produced.length === 0) throw new Error("No pages were rendered from the PDF")

    const archive = path.join(dir, "pages.zip")
    await run("zip", ["-j", "-q", archive, ...produced.map((f) => path.join(dir, f))])

    return {
      type: "application/zip",
      body: await readFile(archive),
      headers: { "x-page-count": String(produced.length) },
    }
  },

  async encrypt({ body, req, dir }) {
    const password = req.headers["x-pdf-password"]
    if (!password) throw Object.assign(new Error("x-pdf-password header is required"), { statusCode: 400 })
    const input = path.join(dir, "in.pdf")
    const output = path.join(dir, "out.pdf")
    await writeFile(input, body)
    // AES-256; same password for user and owner.
    await run("qpdf", ["--encrypt", password, password, "256", "--", input, output])
    return { type: "application/pdf", body: await readFile(output) }
  },

  async decrypt({ body, req, dir }) {
    const password = req.headers["x-pdf-password"]
    if (!password) throw Object.assign(new Error("x-pdf-password header is required"), { statusCode: 400 })
    const input = path.join(dir, "in.pdf")
    const output = path.join(dir, "out.pdf")
    await writeFile(input, body)
    await run("qpdf", [`--password=${password}`, "--decrypt", input, output])
    return { type: "application/pdf", body: await readFile(output) }
  },

  async ocr({ body, url, dir }) {
    const lang = /^[a-z]{3}(\+[a-z]{3})*$/.test(url.searchParams.get("lang") || "") ? url.searchParams.get("lang") : "eng"
    const input = path.join(dir, "in.pdf")
    await writeFile(input, body)

    await run("pdftoppm", ["-png", "-r", "300", input, path.join(dir, "page")])
    const pages = (await readdir(dir)).filter((f) => f.startsWith("page") && f.endsWith(".png")).sort()
    if (pages.length === 0) throw new Error("No pages were rendered for OCR")

    // Tesseract writes one searchable PDF per page; pdfunite stitches them.
    const pagePdfs = []
    for (const [index, page] of pages.entries()) {
      const base = path.join(dir, `ocr-${String(index).padStart(4, "0")}`)
      await run("tesseract", [path.join(dir, page), base, "-l", lang, "pdf"])
      pagePdfs.push(`${base}.pdf`)
    }

    const output = path.join(dir, "ocr.pdf")
    if (pagePdfs.length === 1) {
      return { type: "application/pdf", body: await readFile(pagePdfs[0]) }
    }
    await run("pdfunite", [...pagePdfs, output])
    return {
      type: "application/pdf",
      body: await readFile(output),
      headers: { "x-page-count": String(pages.length) },
    }
  },
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`)

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (!authorized(req)) {
    res.writeHead(401, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "Unauthorized" }))
    return
  }

  const operation = url.pathname.replace(/^\//, "")
  const handler = handlers[operation]
  if (req.method !== "POST" || !handler) {
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "Not found" }))
    return
  }

  let dir = null
  try {
    const body = await readBody(req)
    if (body.length === 0) throw Object.assign(new Error("Empty body"), { statusCode: 400 })

    dir = await mkdtemp(path.join(tmpdir(), `docsvc-${operation}-`))
    const result = await handler({ body, req, url, dir })

    res.writeHead(200, {
      "content-type": result.type,
      "content-length": String(result.body.length),
      ...(result.headers || {}),
    })
    res.end(result.body)
  } catch (error) {
    const statusCode = error.statusCode || 500
    // Never echo the raw command line back — it can carry file paths and, for
    // qpdf, the password.
    console.error(`[${operation}] failed:`, error.message)
    res.writeHead(statusCode, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: statusCode === 500 ? `${operation} failed` : error.message }))
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

server.listen(PORT, () => console.log(`document-service listening on :${PORT}`))
