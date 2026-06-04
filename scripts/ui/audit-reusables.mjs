#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

const ROOT = process.cwd()
const APP_DIR = path.join(ROOT, "app")
const ALLOWLIST_PATH = path.join(ROOT, "scripts", "ui", "ui-audit-allowlist.json")
const REPORT_PATH = path.join(ROOT, "test-results", "ui-audit-report.json")

const args = new Set(process.argv.slice(2))
const WRITE_ALLOWLIST = args.has("--write-allowlist")

function toPosix(p) {
  return p.split(path.sep).join("/")
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8")
}

async function readTextSafe(filePath) {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return null
  }
}

function resolveImportToCandidateFiles(fromFilePath, specifier) {
  if (!specifier || specifier.startsWith("next/") || specifier.startsWith("react")) return []

  const roots = []
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    roots.push(path.resolve(path.dirname(fromFilePath), specifier))
  } else if (specifier.startsWith("@/")) {
    roots.push(path.join(ROOT, specifier.slice(2)))
  } else {
    return []
  }

  const out = []
  for (const base of roots) {
    out.push(`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts"))
  }
  return out
}

async function hasReusableHeaderSignature(entryFilePath, maxDepth = 4) {
  const queue = [{ filePath: entryFilePath, depth: 0 }]
  const seen = new Set()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    const { filePath, depth } = current
    if (seen.has(filePath)) continue
    seen.add(filePath)

    const content = await readTextSafe(filePath)
    if (!content) continue
    if (content.includes("PageHeader") || content.includes("AdminTablePage") || content.includes("AppTablePage")) {
      return true
    }
    if (depth >= maxDepth) continue

    const imports = [...content.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])
    const exports = [...content.matchAll(/export\s+\{[^}]*\}\s+from\s+"([^"]+)"/g)].map((m) => m[1])
    for (const specifier of [...imports, ...exports]) {
      const candidates = resolveImportToCandidateFiles(filePath, specifier)
      for (const candidate of candidates) {
        queue.push({ filePath: candidate, depth: depth + 1 })
      }
    }
  }
  return false
}

async function walk(dir, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, files)
    else files.push(full)
  }
}

function routeFromPageDir(dirRel) {
  const stripped = dirRel
    .replace(/^app\/?/, "")
    .split("/")
    .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")")))
    .join("/")
  return "/" + stripped
}

function isExemptRoute(route) {
  return (
    route.startsWith("/auth/") ||
    route === "/maintenance" ||
    route === "/suspended" ||
    route === "/profile" ||
    route === "/profile/edit" ||
    route === "/dashboard/profile" ||
    route === "/dashboard/profile/edit" ||
    route === "/tools/watermark" ||
    route === "/" ||
    route.includes("/error") ||
    route.includes("/not-found")
  )
}

function normalizeArray(values) {
  return Array.from(new Set(values)).sort()
}

async function main() {
  const files = []
  await walk(APP_DIR, files)

  const tsxFiles = files.filter((f) => f.endsWith(".tsx"))
  const pageFiles = tsxFiles.filter((f) => toPosix(f).endsWith("/page.tsx"))

  const missingLoading = []
  for (const pagePath of pageFiles) {
    const dir = path.dirname(pagePath)
    try {
      await fs.access(path.join(dir, "loading.tsx"))
    } catch {
      missingLoading.push(toPosix(path.relative(ROOT, dir)))
    }
  }

  const allowlist = JSON.parse(await readText(ALLOWLIST_PATH))
  const allowHeader = new Set(allowlist.header || [])
  const allowTable = new Set(allowlist.table || [])
  const allowStats = new Set(allowlist.stats || [])

  const headerViolations = []
  for (const pagePath of pageFiles) {
    const relPage = toPosix(path.relative(ROOT, pagePath))
    const pageDirRel = toPosix(path.relative(ROOT, path.dirname(pagePath)))
    const route = routeFromPageDir(pageDirRel)
    if (isExemptRoute(route)) continue
    const pageContent = await readText(pagePath)
    if (/\bredirect\s*\(/.test(pageContent)) continue
    if (/export\s+\{\s*default\s*\}\s+from\s+["'][^"']+["']/.test(pageContent)) continue
    if (/router\.replace\s*\(/.test(pageContent) && /\breturn\s+null\b/.test(pageContent)) continue

    const hasHeader = await hasReusableHeaderSignature(pagePath)
    if (!hasHeader && !allowHeader.has(relPage)) {
      headerViolations.push(relPage)
    }
  }

  const tableViolations = []
  for (const filePath of pageFiles) {
    const rel = toPosix(path.relative(ROOT, filePath))
    if (/\/\[[^/]+\]\/page\.tsx$/.test(rel) || /\/\[\.\.\.[^/]+\]\/page\.tsx$/.test(rel)) continue
    const content = await readText(filePath)
    if (!/<Table(\s|>)/.test(content)) continue
    const usesWrapper = content.includes("AdminTablePage") || content.includes("AppTablePage")
    if (!usesWrapper && !allowTable.has(rel)) tableViolations.push(rel)
  }

  const statsViolations = []
  for (const filePath of tsxFiles.filter((f) => toPosix(f).endsWith("/page.tsx"))) {
    const rel = toPosix(path.relative(ROOT, filePath))
    if (/\/\[[^/]+\]\/page\.tsx$/.test(rel) || /\/\[\.\.\.[^/]+\]\/page\.tsx$/.test(rel)) continue
    const content = await readText(filePath)
    if (content.includes("StatCard")) continue

    const cardCount = (content.match(/<Card(\s|>)/g) || []).length
    const hasMetricTokens = /\b(Total|Pending|Open|Completed|Resolved|Amount|Count|Overdue|Active)\b/.test(content)
    const hasNumericSignal =
      /\{\s*stats\./.test(content) ||
      /text-(2xl|3xl|4xl)[^"\n>]*font-bold|font-bold[^"\n>]*text-(2xl|3xl|4xl)/.test(content)
    const metricLike = cardCount >= 3 && hasMetricTokens && hasNumericSignal

    if (metricLike && !allowStats.has(rel)) {
      statsViolations.push(rel)
    }
  }

  const modalViolations = []
  for (const filePath of tsxFiles) {
    const rel = toPosix(path.relative(ROOT, filePath))
    const content = await readText(filePath)
    if (/<DialogContent>/.test(content)) {
      modalViolations.push(rel)
    }
  }

  const adHocEmptyStatePages = []
  for (const filePath of pageFiles) {
    const rel = toPosix(path.relative(ROOT, filePath))
    const content = await readText(filePath)
    const hasEmptyCopy = />\s*No\s+[A-Za-z0-9 "'-]+(found|yet|available|assigned|created)[^<]*</i.test(content)
    if (hasEmptyCopy && !content.includes("EmptyState")) {
      adHocEmptyStatePages.push(rel)
    }
  }

  const adHocErrorStatePages = []
  for (const filePath of pageFiles) {
    const rel = toPosix(path.relative(ROOT, filePath))
    const content = await readText(filePath)
    const hasInlineErrorCopy =
      />\s*(Something went wrong|Error loading|Failed to (load|fetch|save|update|create)|Unable to)[^<]*</i.test(
        content
      ) || />\s*No UI errors captured yet[^<]*</i.test(content)
    if (hasInlineErrorCopy && !content.includes("ErrorState")) {
      adHocErrorStatePages.push(rel)
    }
  }

  const adHocSectionPages = []
  for (const filePath of pageFiles) {
    const rel = toPosix(path.relative(ROOT, filePath))
    const content = await readText(filePath)
    const hasSectionTag = /<section(\s|>)/.test(content)
    if (hasSectionTag && !content.includes("PageSection")) {
      adHocSectionPages.push(rel)
    }
  }

  const adHocFormFieldPages = []
  for (const filePath of pageFiles) {
    const rel = toPosix(path.relative(ROOT, filePath))
    const content = await readText(filePath)
    const labelCount = (content.match(/<Label(\s|>)/g) || []).length
    const hasInputControl = /<(Input|Textarea|SelectTrigger|SearchableSelect)(\s|>)/.test(content)
    if (labelCount >= 4 && hasInputControl && !content.includes("FormFieldGroup")) {
      adHocFormFieldPages.push(rel)
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalPages: pageFiles.length,
      missingLoading: missingLoading.length,
      headerViolations: headerViolations.length,
      tableViolations: tableViolations.length,
      statsViolations: statsViolations.length,
      modalViolations: modalViolations.length,
      adHocEmptyStatePages: adHocEmptyStatePages.length,
      adHocErrorStatePages: adHocErrorStatePages.length,
      adHocSectionPages: adHocSectionPages.length,
      adHocFormFieldPages: adHocFormFieldPages.length,
    },
    violations: {
      missingLoading: normalizeArray(missingLoading),
      header: normalizeArray(headerViolations),
      table: normalizeArray(tableViolations),
      stats: normalizeArray(statsViolations),
      modal: normalizeArray(modalViolations),
      adHocEmptyStatePages: normalizeArray(adHocEmptyStatePages),
      adHocErrorStatePages: normalizeArray(adHocErrorStatePages),
      adHocSectionPages: normalizeArray(adHocSectionPages),
      adHocFormFieldPages: normalizeArray(adHocFormFieldPages),
    },
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), "utf8")

  if (WRITE_ALLOWLIST) {
    const updatedAllowlist = {
      header: normalizeArray([...(allowlist.header || []), ...headerViolations]),
      table: normalizeArray([...(allowlist.table || []), ...tableViolations]),
      stats: normalizeArray([...(allowlist.stats || []), ...statsViolations]),
    }
    await fs.writeFile(ALLOWLIST_PATH, JSON.stringify(updatedAllowlist, null, 2) + "\n", "utf8")
    console.log(`Allowlist updated: ${toPosix(path.relative(ROOT, ALLOWLIST_PATH))}`)
  }

  console.log(`UI audit report: ${toPosix(path.relative(ROOT, REPORT_PATH))}`)
  console.log(
    `missingLoading=${report.summary.missingLoading} header=${report.summary.headerViolations} table=${report.summary.tableViolations} stats=${report.summary.statsViolations} modal=${report.summary.modalViolations}`
  )

  const hasFailures =
    report.summary.missingLoading > 0 ||
    report.summary.headerViolations > 0 ||
    report.summary.tableViolations > 0 ||
    report.summary.statsViolations > 0 ||
    report.summary.modalViolations > 0

  if (hasFailures) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
