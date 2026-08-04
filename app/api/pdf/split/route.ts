import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"

function parsePageRanges(pagesStr: string, totalPages: number): number[] {
  const pages: number[] = []
  const ranges = pagesStr.split(",").map((r) => r.trim())

  for (const range of ranges) {
    if (range.includes("-")) {
      const [start, end] = range.split("-").map((s) => parseInt(s.trim()))
      if (!isNaN(start) && !isNaN(end)) {
        const startPage = Math.max(1, Math.min(start, totalPages))
        const endPage = Math.max(1, Math.min(end, totalPages))
        for (let i = startPage; i <= endPage; i++) {
          if (!pages.includes(i)) {
            pages.push(i)
          }
        }
      }
    } else {
      const page = parseInt(range)
      if (!isNaN(page) && page >= 1 && page <= totalPages) {
        if (!pages.includes(page)) {
          pages.push(page)
        }
      }
    }
  }

  return pages.sort((a, b) => a - b)
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const pagesStr = (formData.get("pages") as string) || (formData.get("pageRanges") as string)

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    if (!pagesStr) {
      return NextResponse.json({ error: "Page ranges are required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const pdfBytes = new Uint8Array(arrayBuffer)
    const pdf = await PDFDocument.load(pdfBytes)

    const totalPages = pdf.getPageCount()
    const pageIndices = parsePageRanges(pagesStr, totalPages)

    if (pageIndices.length === 0) {
      return NextResponse.json({ error: "No valid pages found in the specified ranges" }, { status: 400 })
    }

    const newPdf = await PDFDocument.create()
    const pageIndicesToCopy = pageIndices.map((p) => Math.max(0, Math.min(p - 1, totalPages - 1)))

    if (pageIndicesToCopy.length === 0) {
      return NextResponse.json({ error: "No valid pages to extract" }, { status: 400 })
    }

    const copiedPages = await newPdf.copyPages(pdf, pageIndicesToCopy)

    copiedPages.forEach((page) => {
      newPdf.addPage(page)
    })

    const splitPdfBytes = await newPdf.save()

    return new NextResponse(splitPdfBytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="split.pdf"',
        "Content-Length": splitPdfBytes.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error splitting PDF:", error)
    return NextResponse.json({ error: error.message || "Failed to split PDF" }, { status: 500 })
  }
}

export const maxDuration = 60
