import { NextRequest, NextResponse } from "next/server"
import { PDFDocument } from "pdf-lib"
import { exec } from "child_process"
import { promisify } from "util"
import { readFile, unlink, writeFile } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { tmpdir } from "os"

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
  let tempFile: string | null = null
  let outputFile: string | null = null

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const mode = formData.get("mode") as string
    const targetSize = formData.get("targetSize") as string
    const sizeUnit = formData.get("sizeUnit") as string
    const percentage = formData.get("percentage") as string

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const pdfBytes = new Uint8Array(arrayBuffer)
    const originalSize = pdfBytes.length

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

    let useGhostscript = false
    try {
      await execAsync("which gs")
      useGhostscript = true
    } catch (e) {}

    let compressedBytes: Uint8Array | null = null

    if (useGhostscript) {
      const tempDir = tmpdir()
      const timestamp = Date.now()
      tempFile = path.join(tempDir, `pdf_compress_${timestamp}_input.pdf`)
      outputFile = path.join(tempDir, `pdf_compress_${timestamp}_output.pdf`)

      await writeFile(tempFile, Buffer.from(pdfBytes))

      const compressionRatio = targetSizeBytes ? targetSizeBytes / originalSize : 0.5

      let quality = "/printer"
      if (compressionRatio < 0.3) {
        quality = "/screen"
      } else if (compressionRatio < 0.5) {
        quality = "/ebook"
      } else if (compressionRatio < 0.7) {
        quality = "/printer"
      } else {
        quality = "/prepress"
      }

      const command = `gs -dNOPAUSE -dBATCH -dSAFER -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${quality} -dColorImageResolution=150 -dGrayImageResolution=150 -dMonoImageResolution=150 -dDownsampleColorImages=true -dDownsampleGrayImages=true -dDownsampleMonoImages=true -dColorImageDownsampleThreshold=1.0 -dGrayImageDownsampleThreshold=1.0 -dMonoImageDownsampleThreshold=1.0 -sOutputFile="${outputFile}" "${tempFile}"`

      console.log("Executing ghostscript compression command:", command)

      try {
        await execAsync(command, {
          maxBuffer: 50 * 1024 * 1024,
          timeout: 300000,
        })

        if (existsSync(outputFile)) {
          const compressedBuffer = await readFile(outputFile)
          compressedBytes = new Uint8Array(compressedBuffer)

          if (targetSizeBytes && compressedBytes.length > targetSizeBytes) {
            const aggressiveCommand = `gs -dNOPAUSE -dBATCH -dSAFER -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dColorImageResolution=72 -dGrayImageResolution=72 -dMonoImageResolution=72 -dDownsampleColorImages=true -dDownsampleGrayImages=true -dDownsampleMonoImages=true -sOutputFile="${outputFile}" "${tempFile}"`

            await execAsync(aggressiveCommand, {
              maxBuffer: 50 * 1024 * 1024,
              timeout: 300000,
            })

            if (existsSync(outputFile)) {
              const aggressiveBuffer = await readFile(outputFile)
              compressedBytes = new Uint8Array(aggressiveBuffer)
            }
          }
        }
      } catch (gsError: any) {
        console.error("Ghostscript compression error:", gsError)
        useGhostscript = false
      }
    }

    if (!compressedBytes) {
      const pdf = await PDFDocument.load(pdfBytes, {
        ignoreEncryption: false,
        updateMetadata: false,
      })

      compressedBytes = await pdf.save({
        useObjectStreams: true,
        addDefaultPage: false,
      })

      const options = [{ useObjectStreams: true }, { useObjectStreams: false }]

      for (const option of options) {
        const testBytes = await pdf.save({
          ...option,
          addDefaultPage: false,
        })
        if (testBytes.length < compressedBytes.length) {
          compressedBytes = testBytes
        }
        if (targetSizeBytes && compressedBytes.length <= targetSizeBytes) {
          break
        }
      }
    }

    if (!compressedBytes) {
      throw new Error("Compression failed - no output generated")
    }

    setTimeout(async () => {
      try {
        if (tempFile && existsSync(tempFile)) await unlink(tempFile)
        if (outputFile && existsSync(outputFile)) await unlink(outputFile)
      } catch (err) {
        console.error("Error cleaning up temp files:", err)
      }
    }, 1000)

    return new NextResponse(compressedBytes as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="compressed_${file.name}"`,
        "Content-Length": compressedBytes.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error compressing PDF:", error)

    try {
      if (tempFile && existsSync(tempFile)) await unlink(tempFile)
      if (outputFile && existsSync(outputFile)) await unlink(outputFile)
    } catch (cleanupErr) {
      console.error("Error during cleanup:", cleanupErr)
    }

    return NextResponse.json({ error: error.message || "Failed to compress PDF" }, { status: 500 })
  }
}

export const maxDuration = 300
