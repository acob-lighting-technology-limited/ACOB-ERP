import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"
import sharp from "sharp"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const count = parseInt(formData.get("count") as string) || 0

    if (count === 0) {
      return NextResponse.json({ error: "At least one image file is required" }, { status: 400 })
    }

    const pdfDoc = await PDFDocument.create()

    for (let i = 0; i < count; i++) {
      const file = formData.get(`file${i}`) as File
      if (!file) {
        continue
      }

      try {
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        let imageBuffer: Buffer
        let imageFormat: string

        try {
          const metadata = await sharp(buffer).metadata()
          imageFormat = metadata.format || "jpeg"

          if (imageFormat === "jpeg" || imageFormat === "jpg") {
            imageBuffer = buffer
            imageFormat = "jpeg"
          } else if (imageFormat === "png") {
            imageBuffer = buffer
            imageFormat = "png"
          } else if (
            imageFormat === "webp" ||
            imageFormat === "gif" ||
            imageFormat === "bmp" ||
            imageFormat === "tiff"
          ) {
            imageBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
            imageFormat = "jpeg"
          } else {
            imageBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
            imageFormat = "jpeg"
          }

          let pdfImage
          if (imageFormat === "jpeg" || imageFormat === "jpg") {
            pdfImage = await pdfDoc.embedJpg(imageBuffer)
          } else if (imageFormat === "png") {
            pdfImage = await pdfDoc.embedPng(imageBuffer)
          } else {
            const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
            pdfImage = await pdfDoc.embedJpg(jpegBuffer)
          }

          const { width, height } = pdfImage.scale(1)

          const page = pdfDoc.addPage([width, height])
          page.drawImage(pdfImage, {
            x: 0,
            y: 0,
            width: width,
            height: height,
          })
        } catch (imgError: any) {
          console.error(`Error processing image ${i} (${file.name}):`, imgError)
          continue
        }
      } catch (error: any) {
        console.error(`Error processing image ${i}:`, error)
      }
    }

    if (pdfDoc.getPageCount() === 0) {
      return NextResponse.json({ error: "No valid images were processed." }, { status: 400 })
    }

    const pdfBytes = await pdfDoc.save()

    return new NextResponse(pdfBytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="images.pdf"',
        "Content-Length": pdfBytes.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error converting images to PDF:", error)
    return NextResponse.json({ error: error.message || "Failed to convert images to PDF" }, { status: 500 })
  }
}

export const maxDuration = 60
