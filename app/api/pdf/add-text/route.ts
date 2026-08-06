import { NextRequest, NextResponse } from "next/server"
import { PDFDocument, rgb, StandardFonts } from "pdf-lib"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const text = formData.get("text") as string
    const x = parseFloat(formData.get("x") as string) || 50
    const y = parseFloat(formData.get("y") as string) || 50
    const fontSize = parseFloat(formData.get("fontSize") as string) || 12
    const pageNumber = parseInt(formData.get("pageNumber") as string) || 1
    const color = (formData.get("color") as string) || "000000"
    const position = (formData.get("position") as string) || "custom"

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const pdfBytes = new Uint8Array(arrayBuffer)
    const pdfDoc = await PDFDocument.load(pdfBytes)
    const pages = pdfDoc.getPages()

    if (pageNumber < 1 || pageNumber > pages.length) {
      return NextResponse.json({ error: `Invalid page number. PDF has ${pages.length} page(s).` }, { status: 400 })
    }

    const page = pages[pageNumber - 1]
    const { width, height } = page.getSize()

    const r = parseInt(color.substring(0, 2), 16) / 255
    const g = parseInt(color.substring(2, 4), 16) / 255
    const b = parseInt(color.substring(4, 6), 16) / 255
    const textColor = rgb(r, g, b)

    let finalX = x
    let finalY = y

    if (position === "top") {
      finalX = width / 2
      finalY = height - 50
    } else if (position === "bottom") {
      finalX = width / 2
      finalY = 50
    } else if (position === "center") {
      finalX = width / 2
      finalY = height / 2
    }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    const maxWidth = width - 100
    const words = text.split(" ")
    const lines: string[] = []
    let currentLine = ""

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      const textWidth = font.widthOfTextAtSize(testLine, fontSize)

      if (textWidth > maxWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) {
      lines.push(currentLine)
    }

    const lineHeight = fontSize * 1.2
    lines.forEach((line, index) => {
      const textWidth = font.widthOfTextAtSize(line, fontSize)
      const lineX =
        position === "center" || position === "top" || position === "bottom" ? finalX - textWidth / 2 : finalX
      const lineY = finalY - index * lineHeight

      page.drawText(line, {
        x: lineX,
        y: lineY,
        size: fontSize,
        font: font,
        color: textColor,
      })
    })

    const modifiedPdfBytes = await pdfDoc.save()

    return new NextResponse(modifiedPdfBytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="pdf_with_text_${Date.now()}.pdf"`,
        "Content-Length": modifiedPdfBytes.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error adding text to PDF:", error)
    return NextResponse.json({ error: error.message || "Failed to add text to PDF" }, { status: 500 })
  }
}

export const maxDuration = 60
