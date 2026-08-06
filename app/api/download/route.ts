import { NextRequest, NextResponse } from "next/server"
import { exec } from "child_process"
import { promisify } from "util"
import { readFile, unlink, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { tmpdir } from "os"

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
  let tempFile: string | null = null

  try {
    const body = await request.json()
    const { url, format_id, title } = body

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    // Create a temporary directory for downloads
    const tempDir = path.join(tmpdir(), "video-downloads")
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true })
    }

    // Get video info first to get proper title
    let videoTitle = title || "video"
    try {
      const infoCommand = `yt-dlp -J --no-warnings "${url}"`
      const { stdout: infoStdout } = await execAsync(infoCommand, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      })
      const info = JSON.parse(infoStdout)
      if (info.title) {
        videoTitle = info.title
      }
    } catch (err) {
      console.log("Could not fetch video title, using default")
    }

    // Sanitize title for filename
    const sanitizedTitle = videoTitle
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .substring(0, 100)
      .trim()

    // Generate a unique filename using sanitized title
    const timestamp = Date.now()
    let outputTemplate = path.join(tempDir, `${sanitizedTitle}_${timestamp}.%(ext)s`)

    // Build yt-dlp command
    let command = "yt-dlp"
    let isAudio = false
    let audioBitrate = "0" // Default to best quality
    let sanitizedTitleForAudio = sanitizedTitle // Default to same as video

    // Check if this is an MP3 audio conversion request
    if (format_id && format_id.startsWith("audio_mp3_")) {
      isAudio = true
      // Extract bitrate from format_id (e.g., audio_mp3_128 -> 128)
      const bitrateMatch = format_id.match(/audio_mp3_(\d+)/)
      if (bitrateMatch) {
        const bitrate = parseInt(bitrateMatch[1])
        if (bitrate >= 320) audioBitrate = "0"
        else if (bitrate >= 256) audioBitrate = "2"
        else if (bitrate >= 192) audioBitrate = "5"
        else audioBitrate = "9"
      }
      sanitizedTitleForAudio = videoTitle
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/\s+/g, "_")
        .substring(0, 100)
        .trim()
      outputTemplate = path.join(tempDir, `${sanitizedTitleForAudio}_${timestamp}.%(ext)s`)
      command += ` -x --audio-format mp3 --audio-quality ${audioBitrate}`
    } else if (format_id) {
      command += ` -f "${format_id}"`
    } else {
      command += ` -f "best"`
    }

    command += ` -o "${outputTemplate}" --no-warnings "${url}"`

    console.log("Executing command:", command)

    // Execute download
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      timeout: 120000, // 2 minute timeout
    })

    console.log("Download stdout:", stdout)
    if (stderr) {
      console.log("Download stderr:", stderr)
    }

    // Find the downloaded file
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))

      // List all files in temp directory and find the most recent one matching our pattern
      try {
        const { stdout: listStdout } = await execAsync(`ls -t "${tempDir}"/*${timestamp}* 2>/dev/null | head -1`)
        tempFile = listStdout.trim()
      } catch (e) {
        // Continue
      }

      if (!tempFile || !existsSync(tempFile)) {
        if (isAudio) {
          try {
            const { stdout: mp3Stdout } = await execAsync(
              `find "${tempDir}" -name "*.mp3" -type f -mmin -2 2>/dev/null | head -1`
            )
            tempFile = mp3Stdout.trim()
          } catch (e) {
            try {
              const { stdout: anyMp3 } = await execAsync(`ls -t "${tempDir}"/*.mp3 2>/dev/null | head -1`)
              tempFile = anyMp3.trim()
            } catch (e2) {}
          }
        } else {
          try {
            const { stdout: videoStdout } = await execAsync(
              `find "${tempDir}" -type f \\( -name "*.mp4" -o -name "*.webm" -o -name "*.mkv" \\) -mmin -2 2>/dev/null | head -1`
            )
            tempFile = videoStdout.trim()
          } catch (e) {
            try {
              const { stdout: anyVideo } = await execAsync(`ls -t "${tempDir}"/*.{mp4,webm,mkv} 2>/dev/null | head -1`)
              tempFile = anyVideo.trim()
            } catch (e2) {}
          }
        }
      }

      if (!tempFile || !existsSync(tempFile)) {
        try {
          const { stdout: recentStdout } = await execAsync(`ls -t "${tempDir}"/* 2>/dev/null | head -1`)
          tempFile = recentStdout.trim()
        } catch (e) {}
      }
    } catch (err) {
      console.error("Error finding downloaded file:", err)
    }

    if (!tempFile || !existsSync(tempFile)) {
      let ffmpegInstalled = false
      try {
        await execAsync("which ffmpeg")
        ffmpegInstalled = true
      } catch (e) {}

      if (isAudio && !ffmpegInstalled) {
        throw new Error("ffmpeg is required for MP3 conversion.")
      }

      throw new Error("Download failed - file not found.")
    }

    // Read the file
    const fileBuffer = await readFile(tempFile)
    const originalFilename = path.basename(tempFile)

    let sanitizedFilename = originalFilename

    if (videoTitle && videoTitle !== "video") {
      const ext = isAudio ? ".mp3" : path.extname(originalFilename) || ".mp4"
      const cleanTitle = videoTitle
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .replace(/\s+/g, "_")
        .substring(0, 150)
        .trim()
      sanitizedFilename = `${cleanTitle}${ext}`
    } else {
      sanitizedFilename = originalFilename.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").substring(0, 200)
    }

    // Clean up temp file
    setTimeout(async () => {
      try {
        if (tempFile && existsSync(tempFile)) {
          await unlink(tempFile)
        }
      } catch (err) {
        console.error("Error cleaning up temp file:", err)
      }
    }, 1000)

    return new NextResponse(fileBuffer as any, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${sanitizedFilename}"; filename*=UTF-8''${encodeURIComponent(sanitizedFilename)}`,
        "Content-Length": fileBuffer.length.toString(),
      },
    })
  } catch (error: any) {
    console.error("Error downloading video:", error)

    if (tempFile && existsSync(tempFile)) {
      try {
        await unlink(tempFile)
      } catch (err) {
        console.error("Error cleaning up temp file:", err)
      }
    }

    return NextResponse.json({ error: error.message || "Download failed" }, { status: 500 })
  }
}

export const maxDuration = 60
