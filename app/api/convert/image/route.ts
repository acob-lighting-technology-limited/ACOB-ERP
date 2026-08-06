import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"
import { tmpdir } from "os"
import { unlink } from "fs/promises"
import { existsSync } from "fs"
import path from "path"

export async function POST(request: NextRequest) {
  let tempFile: string | null = null
  let outputFile: string | null = null

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const format = formData.get("format") as string

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 })
    }

    if (!format) {
      return NextResponse.json({ error: "Format is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const tempDir = tmpdir()
    const timestamp = Date.now()
    tempFile = path.join(tempDir, `convert_${timestamp}_input`)
    outputFile = path.join(tempDir, `convert_${timestamp}_output.${format}`)

    let sharpInstance = sharp(buffer)

    switch (format.toLowerCase()) {
      case "jpg":
      case "jpeg":
        sharpInstance = sharpInstance.jpeg({ quality: 90 })
        break
      case "png":
        sharpInstance = sharpInstance.png({ compressionLevel: 9 })
        break
      case "webp":
        sharpInstance = sharpInstance.webp({ quality: 90 })
        break
      case "gif":
        sharpInstance = sharpInstance.gif()
        break
      case "bmp":
        sharpInstance = sharpInstance.png()
        break
      case "tiff":
        sharpInstance = sharpInstance.tiff({ compression: "lzw" })
        break
      case "ico":
        sharpInstance = sharpInstance.png()
        break
      case "svg":
        return NextResponse.json({ error: "SVG output is not supported. SVG is a vector format." }, { status: 400 })
      default:
        return NextResponse.json({ error: `Unsupported format: ${format}` }, { status: 400 })
    }

    const convertedBuffer = await sharpInstance.toBuffer()

    return new NextResponse(convertedBuffer as any, {
      headers: {
        "Content-Type":
          format === "jpg" || format === "jpeg"
            ? "image/jpeg"
            : format === "png"
              ? "image/png"
              : format === "webp"
                ? "image/webp"
                : format === "gif"
                  ? "image/gif"
                  : format === "bmp"
                    ? "image/bmp"
                    : format === "tiff"
                      ? "image/tiff"
                      : format === "ico"
                        ? "image/x-icon"
                        : "application/octet-stream",
        "Content-Disposition": `attachment; filename="converted.${format}"`,
        "Content-Length": convertedBuffer.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error converting image:", error)

    if (tempFile && existsSync(tempFile)) {
      try {
        await unlink(tempFile)
      } catch {}
    }
    if (outputFile && existsSync(outputFile)) {
      try {
        await unlink(outputFile)
      } catch {}
    }

    return NextResponse.json({ error: error.message || "Image conversion failed" }, { status: 500 })
  }
}

export const maxDuration = 60
