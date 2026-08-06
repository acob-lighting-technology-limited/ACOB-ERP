import { NextRequest, NextResponse } from "next/server"
import { exec } from "child_process"
import { promisify } from "util"
import { readFile, unlink, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { tmpdir } from "os"
import { PDFDocument } from "pdf-lib"

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
  let tempFile: string | null = null
  let outputDir: string | null = null

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const outputFormat = (formData.get("outputFormat") as string) || "text"

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    try {
      const pdfParse = ((await import("pdf-parse")) as any).default || ((await import("pdf-parse")) as any)
      const pdfData = await pdfParse(buffer)
      if (pdfData.text && pdfData.text.trim().length > 0) {
        if (outputFormat === "text") {
          return NextResponse.json({
            success: true,
            text: pdfData.text,
            method: "direct_extraction",
            numPages: pdfData.numpages,
          })
        } else {
          return new NextResponse(buffer, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="ocr_${file.name}"`,
              "Content-Length": buffer.length.toString(),
            },
          })
        }
      }
    } catch (e) {
      // Ignore and proceed to OCR
    }

    let tesseractAvailable = false
    try {
      await execAsync("which tesseract")
      tesseractAvailable = true
    } catch (e) {}

    if (!tesseractAvailable) {
      return NextResponse.json(
        {
          error:
            "OCR requires Tesseract OCR. Install with: brew install tesseract (macOS) or visit https://github.com/tesseract-ocr/tesseract",
          suggestion: "For scanned PDFs, you need Tesseract OCR installed on your system.",
        },
        { status: 500 }
      )
    }

    const tempDir = tmpdir()
    const timestamp = Date.now()
    tempFile = path.join(tempDir, `pdf_ocr_${timestamp}.pdf`)
    outputDir = path.join(tempDir, `ocr_output_${timestamp}`)
    await mkdir(outputDir, { recursive: true })

    await writeFile(tempFile, buffer)

    const imageCommand = `pdftoppm -png -r 300 "${tempFile}" "${path.join(outputDir, "page")}"`
    await execAsync(imageCommand, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 })

    let imageFiles = (await require("fs").promises.readdir(outputDir)).filter((f: string) => f.endsWith(".png")).sort()

    if (imageFiles.length === 0) {
      const gsCommand = `gs -dNOPAUSE -dBATCH -sDEVICE=pngalpha -r300 -sOutputFile="${path.join(outputDir, "page-%d.png")}" "${tempFile}"`
      await execAsync(gsCommand, { maxBuffer: 50 * 1024 * 1024, timeout: 300000 })
      const gsFiles = (await require("fs").promises.readdir(outputDir)).filter((f: string) => f.endsWith(".png")).sort()
      if (gsFiles.length === 0) {
        throw new Error("Failed to convert PDF pages to images")
      }
      imageFiles = gsFiles
    }

    const allText: string[] = []

    for (const imgFile of imageFiles) {
      const imgPath = path.join(outputDir, imgFile)
      const ocrCommand = `tesseract "${imgPath}" stdout -l eng`
      try {
        const { stdout } = await execAsync(ocrCommand, { maxBuffer: 10 * 1024 * 1024, timeout: 60000 })
        allText.push(stdout.trim())
      } catch (e) {
        console.error(`OCR failed for ${imgFile}:`, e)
      }
    }

    const extractedText = allText.join("\n\n")

    if (outputFormat === "text") {
      return NextResponse.json({
        success: true,
        text: extractedText,
        method: "ocr",
        numPages: imageFiles.length,
      })
    } else {
      const pdfDoc = await PDFDocument.create()
      const font = await pdfDoc.embedFont(require("pdf-lib").StandardFonts.Helvetica)

      const lines = extractedText.split("\n")
      const linesPerPage = 40
      for (let i = 0; i < lines.length; i += linesPerPage) {
        const pageLines = lines.slice(i, i + linesPerPage)
        const page = pdfDoc.addPage([612, 792])
        const pageText = pageLines.join("\n")

        page.drawText(pageText, {
          x: 50,
          y: 750,
          size: 12,
          font: font,
          maxWidth: 512,
        })
      }

      const ocrPdfBytes = await pdfDoc.save()

      setTimeout(async () => {
        try {
          if (tempFile && existsSync(tempFile)) await unlink(tempFile)
          if (outputDir && existsSync(outputDir)) {
            const files = await require("fs").promises.readdir(outputDir)
            for (const f of files) await unlink(path.join(outputDir, f))
            await require("fs").promises.rmdir(outputDir)
          }
        } catch (err) {
          console.error("Error cleaning up:", err)
        }
      }, 5000)

      return new NextResponse(ocrPdfBytes as any, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="ocr_${file.name}"`,
          "Content-Length": ocrPdfBytes.length.toString(),
        },
      })
    }
  } catch (error: any) {
    console.error("Error performing OCR:", error)
    try {
      if (tempFile && existsSync(tempFile)) await unlink(tempFile)
      if (outputDir && existsSync(outputDir)) {
        const files = await require("fs")
          .promises.readdir(outputDir)
          .catch(() => [])
        for (const f of files) await unlink(path.join(outputDir, f)).catch(() => {})
        await require("fs")
          .promises.rmdir(outputDir)
          .catch(() => {})
      }
    } catch (cleanupErr) {
      console.error("Error during cleanup:", cleanupErr)
    }
    return NextResponse.json({ error: error.message || "Failed to perform OCR." }, { status: 500 })
  }
}

// Vercel rejects the build outright if this exceeds the plan's ceiling (300s),
// so the whole app fails to deploy, not just this route.
export const maxDuration = 300
