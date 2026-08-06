import { NextRequest, NextResponse } from "next/server"
import { exec } from "child_process"
import { promisify } from "util"
import { readFile, unlink, writeFile, readdir, mkdir, rmdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { tmpdir } from "os"
import JSZip from "jszip"

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
  let tempFile: string | null = null
  let outputDir: string | null = null

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const format = (formData.get("format") as string) || "jpg"

    if (!file) {
      return NextResponse.json({ error: "PDF file is required" }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const tempDir = tmpdir()
    const timestamp = Date.now()
    tempFile = path.join(tempDir, `pdf_convert_${timestamp}.pdf`)
    outputDir = path.join(tempDir, `pdf_images_${timestamp}`)

    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true })
    }

    await writeFile(tempFile, buffer)

    let command: string
    let usePoppler = false

    try {
      await execAsync("which pdftoppm")
      usePoppler = true
    } catch (e) {}

    if (usePoppler) {
      const outputPrefix = path.join(outputDir, "page")
      command = `pdftoppm -${format} "${tempFile}" "${outputPrefix}"`
    } else {
      let gsAvailable = false
      try {
        await execAsync("which gs")
        gsAvailable = true
      } catch (e) {}

      if (gsAvailable) {
        let device = "jpeg"
        let ext = "jpg"
        if (format === "png") {
          device = "pngalpha"
          ext = "png"
        } else if (format === "webp") {
          device = "pngalpha"
          ext = "png"
        }

        const outputPattern = path.join(outputDir, `page-%d.${ext}`)
        command = `gs -dNOPAUSE -dBATCH -dSAFER -sDEVICE=${device} -r150 -sOutputFile="${outputPattern}" "${tempFile}"`
      } else {
        return NextResponse.json(
          { error: "PDF to image conversion requires pdftoppm or ghostscript." },
          { status: 500 }
        )
      }
    }

    console.log("Executing conversion command:", command)
    await execAsync(command, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 300000,
    })

    const files = await readdir(outputDir)
    const imageFiles = files
      .filter((f) => {
        const ext = f.toLowerCase()
        return ext.endsWith(".jpg") || ext.endsWith(".jpeg") || ext.endsWith(".png") || ext.endsWith(".webp")
      })
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || "0")
        const numB = parseInt(b.match(/\d+/)?.[0] || "0")
        return numA - numB
      })

    if (format === "webp" && !usePoppler && imageFiles.some((f) => f.endsWith(".png"))) {
      const sharp = (await import("sharp")).default
      for (const imgFile of imageFiles) {
        if (imgFile.endsWith(".png")) {
          const imgPath = path.join(outputDir, imgFile)
          const imgBuffer = await readFile(imgPath)
          const webpBuffer = await sharp(imgBuffer).webp({ quality: 90 }).toBuffer()
          const webpPath = path.join(outputDir, imgFile.replace(/\.png$/i, ".webp"))
          await writeFile(webpPath, webpBuffer)
          await unlink(imgPath)
        }
      }
      const filesAfter = await readdir(outputDir)
      const webpFiles = filesAfter.filter((f) => f.toLowerCase().endsWith(".webp")).sort()
      imageFiles.length = 0
      imageFiles.push(...webpFiles)
    }

    if (imageFiles.length === 0) {
      throw new Error("No images were generated from the PDF")
    }

    // Create zip file using jszip
    const zip = new JSZip()
    for (const imageFile of imageFiles) {
      const imagePath = path.join(outputDir, imageFile)
      if (existsSync(imagePath)) {
        const fileContent = await readFile(imagePath)
        zip.file(imageFile, fileContent)
      }
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" })

    setTimeout(async () => {
      try {
        if (tempFile && existsSync(tempFile)) {
          await unlink(tempFile)
        }
        if (outputDir && existsSync(outputDir)) {
          const files = await readdir(outputDir)
          for (const file of files) {
            const filePath = path.join(outputDir, file)
            if (existsSync(filePath)) {
              await unlink(filePath)
            }
          }
          await rmdir(outputDir)
        }
      } catch (err) {
        console.error("Error cleaning up temp files:", err)
      }
    }, 5000)

    return new NextResponse(zipBuffer as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="pdf_images.zip"`,
        "Content-Length": zipBuffer.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error converting PDF to images:", error)

    try {
      if (tempFile && existsSync(tempFile)) {
        await unlink(tempFile)
      }
      if (outputDir && existsSync(outputDir)) {
        const files = await readdir(outputDir).catch(() => [])
        for (const file of files) {
          try {
            await unlink(path.join(outputDir, file))
          } catch {}
        }
        try {
          await rmdir(outputDir)
        } catch {}
      }
    } catch (cleanupErr) {
      console.error("Error during cleanup:", cleanupErr)
    }

    return NextResponse.json({ error: error.message || "Failed to convert PDF to images." }, { status: 500 })
  }
}

export const maxDuration = 300
