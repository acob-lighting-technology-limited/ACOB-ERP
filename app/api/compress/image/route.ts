import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const mode = formData.get("mode") as string
    const targetSize = formData.get("targetSize") as string
    const sizeUnit = formData.get("sizeUnit") as string
    const percentage = formData.get("percentage") as string

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const originalSize = buffer.length

    let quality = 80
    let targetSizeBytes: number | null = null

    if (mode === "size" && targetSize && sizeUnit) {
      const sizeValue = parseFloat(targetSize)
      if (isNaN(sizeValue) || sizeValue <= 0) {
        return NextResponse.json({ error: "Invalid target size" }, { status: 400 })
      }

      switch (sizeUnit.toUpperCase()) {
        case "KB":
          targetSizeBytes = sizeValue * 1024
          break
        case "MB":
          targetSizeBytes = sizeValue * 1024 * 1024
          break
        case "GB":
          targetSizeBytes = sizeValue * 1024 * 1024 * 1024
          break
        default:
          return NextResponse.json({ error: "Invalid size unit" }, { status: 400 })
      }

      if (targetSizeBytes >= originalSize) {
        return NextResponse.json({ error: "Target size must be smaller than original file size" }, { status: 400 })
      }
    } else if (mode === "percentage" && percentage) {
      const percentValue = parseFloat(percentage)
      if (isNaN(percentValue) || percentValue <= 0 || percentValue >= 100) {
        return NextResponse.json({ error: "Percentage must be between 0 and 100" }, { status: 400 })
      }

      targetSizeBytes = originalSize * (1 - percentValue / 100)
    } else {
      return NextResponse.json({ error: "Invalid compression mode or parameters" }, { status: 400 })
    }

    const fileType = file.type || ""
    const sharpInstance = sharp(buffer)
    const isJpeg = fileType.includes("jpeg") || fileType.includes("jpg")
    const isPng = fileType.includes("png")
    const isWebp = fileType.includes("webp")

    let minQuality = 10
    let maxQuality = 100
    let bestBuffer: Buffer | null = null
    let bestQuality = quality

    for (let attempt = 0; attempt < 10; attempt++) {
      quality = Math.round((minQuality + maxQuality) / 2)

      let compressedBuffer: Buffer

      if (isJpeg) {
        compressedBuffer = await sharpInstance.jpeg({ quality, mozjpeg: true }).toBuffer()
      } else if (isPng) {
        const compressionLevel = Math.round((100 - quality) / 10)
        compressedBuffer = await sharpInstance
          .png({ compressionLevel: Math.min(9, Math.max(0, compressionLevel)) })
          .toBuffer()
      } else if (isWebp) {
        compressedBuffer = await sharpInstance.webp({ quality }).toBuffer()
      } else {
        compressedBuffer = await sharpInstance.jpeg({ quality, mozjpeg: true }).toBuffer()
      }

      const compressedSize = compressedBuffer.length

      if (compressedSize <= targetSizeBytes! * 1.05) {
        bestBuffer = compressedBuffer
        bestQuality = quality
        if (compressedSize >= targetSizeBytes! * 0.95) {
          break
        }
        minQuality = quality + 1
      } else {
        maxQuality = quality - 1
        if (maxQuality < minQuality) {
          if (!bestBuffer) {
            bestBuffer = compressedBuffer
          }
          break
        }
      }

      if (minQuality > maxQuality) {
        break
      }
    }

    if (!bestBuffer) {
      if (isJpeg) {
        bestBuffer = await sharpInstance.jpeg({ quality: 50, mozjpeg: true }).toBuffer()
      } else if (isPng) {
        bestBuffer = await sharpInstance.png({ compressionLevel: 9 }).toBuffer()
      } else if (isWebp) {
        bestBuffer = await sharpInstance.webp({ quality: 50 }).toBuffer()
      } else {
        bestBuffer = await sharpInstance.jpeg({ quality: 50, mozjpeg: true }).toBuffer()
      }
    }

    const contentType = isJpeg ? "image/jpeg" : isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg"

    return new NextResponse(bestBuffer as any, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="compressed_${file.name}"`,
        "Content-Length": bestBuffer.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error compressing image:", error)

    return NextResponse.json({ error: error.message || "Image compression failed" }, { status: 500 })
  }
}

export const maxDuration = 60
