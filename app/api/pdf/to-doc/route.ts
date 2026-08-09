import { NextRequest, NextResponse } from "next/server"
import { exec } from "child_process"
import { promisify } from "util"
import { readFile, unlink, writeFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { tmpdir } from "os"
import { hasBinary } from "@/lib/pdf/binaries"
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx"

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
  let tempFile: string | null = null
  let outputFile: string | null = null

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const format = (formData.get("format") as string) || "docx"

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const tempDir = tmpdir()
    const timestamp = Date.now()
    tempFile = path.join(tempDir, `pdf_to_doc_${timestamp}.pdf`)

    await writeFile(tempFile, buffer)

    // pdf-parse v2 is class-based; the old v1-style call surfaced as
    // "DOMMatrix is not defined". See app/api/pdf/extract-text/route.ts.
    const { PDFParse } = await import("pdf-parse")
    const parser = new PDFParse({ data: buffer })
    let pdfData: { text: string }
    try {
      pdfData = await parser.getText()
    } finally {
      await parser.destroy()
    }

    if (!pdfData.text || pdfData.text.trim().length === 0) {
      return NextResponse.json(
        { error: "PDF does not contain extractable text. Scanned PDFs are not supported." },
        { status: 400 }
      )
    }

    const paragraphs = pdfData.text
      .split(/\n\s*\n/)
      .filter((p: string) => p.trim().length > 0)
      .map((text: string) => {
        const trimmed = text.trim()
        const isHeading =
          trimmed.length < 100 &&
          (trimmed === trimmed.toUpperCase() || /^\d+\.?\s+[A-Z]/.test(trimmed) || trimmed.length < 50)

        if (isHeading) {
          return new Paragraph({
            text: trimmed,
            heading: HeadingLevel.HEADING_2,
            spacing: { after: 200 },
          })
        }

        return new Paragraph({
          children: [new TextRun(trimmed)],
          spacing: { after: 100 },
        })
      })

    if (paragraphs.length === 0) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun(pdfData.text)],
          spacing: { after: 100 },
        })
      )
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    })

    const docxBuffer = await Packer.toBuffer(doc)

    if (format === "doc") {
      outputFile = path.join(tempDir, `pdf_to_doc_${timestamp}.docx`)
      await writeFile(outputFile, docxBuffer)

      try {
        if (!(await hasBinary("libreoffice"))) throw new Error("libreoffice not found")
        const docOutputFile = path.join(tempDir, `pdf_to_doc_${timestamp}.doc`)
        const convertCommand = `libreoffice --headless --convert-to doc --outdir "${tempDir}" "${outputFile}"`
        await execAsync(convertCommand, {
          maxBuffer: 50 * 1024 * 1024,
          timeout: 60000,
        })

        if (existsSync(docOutputFile)) {
          const docBuffer = await readFile(docOutputFile)

          setTimeout(async () => {
            try {
              if (tempFile && existsSync(tempFile)) await unlink(tempFile)
              if (outputFile && existsSync(outputFile)) await unlink(outputFile)
              if (existsSync(docOutputFile)) await unlink(docOutputFile)
            } catch (err) {
              console.error("Error cleaning up temp files:", err)
            }
          }, 1000)

          return new NextResponse(docBuffer as any, {
            headers: {
              "Content-Type": "application/msword",
              "Content-Disposition": `attachment; filename="pdf_to_doc_${timestamp}.doc"`,
              "Content-Length": docBuffer.length.toString(),
            },
          })
        }
      } catch (e) {
        console.log("LibreOffice not available, returning DOCX format instead")
      }
    }

    setTimeout(async () => {
      try {
        if (tempFile && existsSync(tempFile)) await unlink(tempFile)
        if (outputFile && existsSync(outputFile)) await unlink(outputFile)
      } catch (err) {
        console.error("Error cleaning up temp files:", err)
      }
    }, 1000)

    return new NextResponse(docxBuffer as any, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="pdf_to_doc_${timestamp}.docx"`,
        "Content-Length": docxBuffer.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error converting PDF to DOC:", error)

    try {
      if (tempFile && existsSync(tempFile)) await unlink(tempFile)
      if (outputFile && existsSync(outputFile)) await unlink(outputFile)
    } catch (cleanupErr) {
      console.error("Error during cleanup:", cleanupErr)
    }

    return NextResponse.json({ error: error.message || "Failed to convert PDF to DOC/DOCX" }, { status: 500 })
  }
}

export const maxDuration = 120
