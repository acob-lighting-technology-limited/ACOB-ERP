import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "File must be a PDF" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // pdf-parse v2 is class-based. The old call style (`pdfParse(buffer)`) is the
    // v1 API; invoking the v2 class without `new` blew up inside pdfjs and
    // surfaced as "DOMMatrix is not defined". Used correctly it needs no DOM
    // polyfill in Node.
    const { PDFParse } = await import("pdf-parse")
    const parser = new PDFParse({ data: buffer })

    try {
      const [textResult, infoResult] = await Promise.all([parser.getText(), parser.getInfo()])
      const info = (infoResult.info ?? {}) as Record<string, unknown>

      return NextResponse.json({
        success: true,
        text: textResult.text,
        numPages: infoResult.total ?? null,
        info: {
          title: info.Title ?? null,
          author: info.Author ?? null,
          subject: info.Subject ?? null,
          creator: info.Creator ?? null,
          producer: info.Producer ?? null,
          creationDate: info.CreationDate ?? null,
          modificationDate: info.ModDate ?? null,
        },
        metadata: infoResult.metadata ?? {},
      })
    } finally {
      await parser.destroy()
    }
  } catch (error: any) {
    console.error("Error extracting text from PDF:", error)
    return NextResponse.json({ error: error.message || "Failed to extract text from PDF" }, { status: 500 })
  }
}

export const maxDuration = 60
