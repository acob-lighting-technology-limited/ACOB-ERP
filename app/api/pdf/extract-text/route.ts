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

    // Dynamic import for pdf-parse (CommonJS)
    const pdfParse = ((await import("pdf-parse")) as any).default || ((await import("pdf-parse")) as any)
    const data = await pdfParse(buffer)

    return NextResponse.json({
      success: true,
      text: data.text,
      numPages: data.numpages,
      info: {
        title: data.info?.Title || null,
        author: data.info?.Author || null,
        subject: data.info?.Subject || null,
        creator: data.info?.Creator || null,
        producer: data.info?.Producer || null,
        creationDate: data.info?.CreationDate || null,
        modificationDate: data.info?.ModDate || null,
      },
      metadata: data.metadata || {},
    })
  } catch (error: any) {
    console.error("Error extracting text from PDF:", error)
    return NextResponse.json({ error: error.message || "Failed to extract text from PDF" }, { status: 500 })
  }
}

export const maxDuration = 60
