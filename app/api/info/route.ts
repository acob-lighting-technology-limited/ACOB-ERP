import { NextRequest, NextResponse } from "next/server"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

const SUPPORTED_PLATFORMS: Record<string, string> = {
  // Video Platforms
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "m.youtube.com": "YouTube",
  "tiktok.com": "TikTok",
  "vm.tiktok.com": "TikTok",
  "instagram.com": "Instagram",
  "twitter.com": "Twitter",
  "x.com": "Twitter",
  "facebook.com": "Facebook",
  "fb.watch": "Facebook",
  "fb.com": "Facebook",
  // Additional Platforms
  "reddit.com": "Reddit",
  "redd.it": "Reddit",
  "linkedin.com": "LinkedIn",
  "pinterest.com": "Pinterest",
  "pin.it": "Pinterest",
  "tumblr.com": "Tumblr",
  "twitch.tv": "Twitch",
  "vimeo.com": "Vimeo",
  "dailymotion.com": "Dailymotion",
  "dai.ly": "Dailymotion",
  "bilibili.com": "Bilibili",
  "b23.tv": "Bilibili",
  "snapchat.com": "Snapchat",
  "snapchat.tv": "Snapchat",
  "rumble.com": "Rumble",
  "odysee.com": "Odysee",
  "vk.com": "VK",
  "ok.ru": "OK.ru",
  "soundcloud.com": "SoundCloud",
  "mixcloud.com": "Mixcloud",
  "bandcamp.com": "Bandcamp",
  "t.me": "Telegram",
  "telegram.org": "Telegram",
  "discord.com": "Discord",
  "discord.gg": "Discord",
  "imgur.com": "Imgur",
  "gfycat.com": "Gfycat",
  "streamable.com": "Streamable",
  "v.redd.it": "Reddit",
  "i.redd.it": "Reddit",
}

function getPlatform(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const domain = urlObj.hostname.toLowerCase().replace("www.", "")

    for (const [platformDomain, platformName] of Object.entries(SUPPORTED_PLATFORMS)) {
      if (domain.includes(platformDomain)) {
        return platformName
      }
    }
    return null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url } = body

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    // Get platform name (or use 'Unknown' if not in our list - yt-dlp might still support it)
    const platform = getPlatform(url) || "Unknown"

    // Use yt-dlp to extract video info
    const command = `yt-dlp -J --no-warnings "${url}"`

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 30000, // 30 second timeout
    })

    if (stderr && !stdout) {
      throw new Error(stderr)
    }

    const info = JSON.parse(stdout)

    // Extract video formats
    const formats: any[] = []
    const seenQualities = new Set<string>()

    if (info.formats) {
      for (const f of info.formats) {
        // Skip audio-only formats for video list
        if (f.vcodec === "none") continue

        const height = f.height
        const width = f.width
        const formatId = f.format_id
        const ext = f.ext || "mp4"
        const filesize = f.filesize || f.filesize_approx || 0

        if (height) {
          const qualityLabel = `${height}p`
          if (!seenQualities.has(qualityLabel)) {
            formats.push({
              format_id: formatId,
              quality: qualityLabel,
              width: width,
              height: height,
              ext: ext,
              filesize: filesize,
              filesize_mb: filesize ? parseFloat((filesize / (1024 * 1024)).toFixed(2)) : null,
              type: "video",
            })
            seenQualities.add(qualityLabel)
          }
        }
      }
    }

    // Sort by quality (height) descending
    formats.sort((a, b) => (b.height || 0) - (a.height || 0))

    // Add audio/MP3 conversion options
    const audioFormats = [
      {
        format_id: "audio_mp3_128",
        quality: "MP3 128kbps",
        width: 0,
        height: 0,
        ext: "mp3",
        filesize: null,
        filesize_mb: null,
        type: "audio",
        bitrate: 128,
      },
      {
        format_id: "audio_mp3_192",
        quality: "MP3 192kbps",
        width: 0,
        height: 0,
        ext: "mp3",
        filesize: null,
        filesize_mb: null,
        type: "audio",
        bitrate: 192,
      },
      {
        format_id: "audio_mp3_256",
        quality: "MP3 256kbps",
        width: 0,
        height: 0,
        ext: "mp3",
        filesize: null,
        filesize_mb: null,
        type: "audio",
        bitrate: 256,
      },
      {
        format_id: "audio_mp3_320",
        quality: "MP3 320kbps (Best)",
        width: 0,
        height: 0,
        ext: "mp3",
        filesize: null,
        filesize_mb: null,
        type: "audio",
        bitrate: 320,
      },
    ]

    return NextResponse.json({
      success: true,
      platform: platform,
      title: info.title || "Unknown",
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader,
      formats: formats.slice(0, 10), // Limit to top 10 video formats
      audioFormats: audioFormats, // MP3 conversion options
    })
  } catch (error: any) {
    console.error("Error fetching video info:", error)
    return NextResponse.json({ error: error.message || "Failed to fetch video information" }, { status: 500 })
  }
}
