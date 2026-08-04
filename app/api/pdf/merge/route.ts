import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const count = parseInt(formData.get("count") as string) || 0

    if (count < 2) {
      return NextResponse.json({ error: "At least 2 PDF files are required for merging" }, { status: 400 })
    }

    const mergedPdf = await PDFDocument.create()
    let processedCount = 0

    for (let i = 0; i < count; i++) {
      const file = formData.get(`file${i}`) as File
      if (!file || file.type !== "application/pdf") {
        console.warn(`Skipping file ${i}: not a valid PDF`)
        continue
      }

      try {
        const arrayBuffer = await file.arrayBuffer()
        const pdfBytes = new Uint8Array(arrayBuffer)
        const pdf = await PDFDocument.load(pdfBytes)

        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
        pages.forEach((page) => {
          mergedPdf.addPage(page)
        })

        processedCount++
      } catch (error: any) {
        console.error(`Error processing file ${i} (${file.name}):`, error)
      }
    }

    if (processedCount === 0) {
      return NextResponse.json({ error: "No valid PDF files were processed" }, { status: 400 })
    }

    const mergedPdfBytes = await mergedPdf.save()

    return new NextResponse(mergedPdfBytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="merged.pdf"',
        "Content-Length": mergedPdfBytes.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error merging PDFs:", error)
    return NextResponse.json({ error: error.message || "Failed to merge PDFs" }, { status: 500 })
  }
}

export const maxDuration = 60
