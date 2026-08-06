import { NextRequest, NextResponse } from "next/server"
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib"
import sharp from "sharp"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const watermarkType = formData.get("watermarkType") as string
    const watermarkText = formData.get("watermarkText") as string
    const watermarkImage = formData.get("watermarkImage") as File
    const position = (formData.get("position") as string) || "center"
    const opacity = parseFloat(formData.get("opacity") as string) || 0.5
    const fontSize = parseFloat(formData.get("fontSize") as string) || 48
    const color = (formData.get("color") as string) || "000000"
    const x = parseFloat(formData.get("x") as string) || 0
    const y = parseFloat(formData.get("y") as string) || 0

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    if (watermarkType === "text" && !watermarkText) {
      return NextResponse.json({ error: "Watermark text is required" }, { status: 400 })
    }

    if (watermarkType === "image" && !watermarkImage) {
      return NextResponse.json({ error: "Watermark image is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const pdfBytes = new Uint8Array(arrayBuffer)
    const pdfDoc = await PDFDocument.load(pdfBytes)
    const pages = pdfDoc.getPages()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    const r = parseInt(color.substring(0, 2), 16) / 255
    const g = parseInt(color.substring(2, 4), 16) / 255
    const b = parseInt(color.substring(4, 6), 16) / 255
    const textColor = rgb(r, g, b)

    for (const page of pages) {
      const { width, height } = page.getSize()
      let finalX = x
      let finalY = y

      if (position === "center") {
        finalX = width / 2
        finalY = height / 2
      } else if (position === "top") {
        finalX = width / 2
        finalY = height - 50
      } else if (position === "bottom") {
        finalX = width / 2
        finalY = 50
      }

      if (watermarkType === "text") {
        const textWidth = font.widthOfTextAtSize(watermarkText, fontSize)
        const textHeight = font.heightAtSize(fontSize)
        const adjustedX =
          position === "center" || position === "top" || position === "bottom" ? finalX - textWidth / 2 : finalX
        const adjustedY = position === "center" ? finalY + textHeight / 2 : finalY

        page.drawText(watermarkText, {
          x: adjustedX,
          y: adjustedY,
          size: fontSize,
          font: font,
          color: textColor,
          opacity: opacity,
          rotate: degrees(-45),
        })
      } else if (watermarkType === "image") {
        const imageArrayBuffer = await watermarkImage.arrayBuffer()
        const imageBuffer = Buffer.from(imageArrayBuffer)

        const processedImage = await sharp(imageBuffer)
          .resize(200, 200, { fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer()

        const pdfImage = await pdfDoc.embedPng(processedImage)
        const imageDims = pdfImage.scale(1)

        const imageX =
          position === "center" || position === "top" || position === "bottom" ? finalX - imageDims.width / 2 : finalX
        const imageY = position === "center" ? finalY - imageDims.height / 2 : finalY

        page.drawImage(pdfImage, {
          x: imageX,
          y: imageY,
          width: imageDims.width,
          height: imageDims.height,
          opacity: opacity,
          rotate: degrees(-45),
        })
      }
    }

    const watermarkedBytes = await pdfDoc.save()

    return new NextResponse(watermarkedBytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="watermarked_${file.name}"`,
        "Content-Length": watermarkedBytes.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error adding watermark to PDF:", error)
    return NextResponse.json({ error: error.message || "Failed to add watermark to PDF" }, { status: 500 })
  }
}

export const maxDuration = 60
