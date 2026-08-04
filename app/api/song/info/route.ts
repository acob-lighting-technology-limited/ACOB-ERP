import { NextRequest, NextResponse } from "next/server"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

const MUSIC_PLATFORMS: Record<string, string> = {
  // Spotify
  "spotify.com": "Spotify",
  "open.spotify.com": "Spotify",
  // Apple Music
  "music.apple.com": "Apple Music",
  "itunes.apple.com": "Apple Music",
  // YouTube Music
  "music.youtube.com": "YouTube Music",
  "youtube.com": "YouTube Music",
  "youtu.be": "YouTube Music",
  // Amazon Music
  "music.amazon.com": "Amazon Music",
  "amazon.com": "Amazon Music",
  // Pandora
  "pandora.com": "Pandora",
  // Deezer
  "deezer.com": "Deezer",
  // Tidal
  "tidal.com": "Tidal",
  // Qobuz
  "qobuz.com": "Qobuz",
  // SoundCloud
  "soundcloud.com": "SoundCloud",
  // Mixcloud
  "mixcloud.com": "Mixcloud",
  // Bandcamp
  "bandcamp.com": "Bandcamp",
}

const DRM_PROTECTED_PLATFORMS = [
  "spotify.com",
  "open.spotify.com",
  "music.apple.com",
  "itunes.apple.com",
  "music.amazon.com",
  "pandora.com",
  "tidal.com",
  "qobuz.com",
]

function isDRMProtected(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const domain = urlObj.hostname.toLowerCase().replace("www.", "")
    return DRM_PROTECTED_PLATFORMS.some((platform) => domain.includes(platform))
  } catch {
    return false
  }
}

function getPlatform(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const domain = urlObj.hostname.toLowerCase().replace("www.", "")

    for (const [platformDomain, platformName] of Object.entries(MUSIC_PLATFORMS)) {
      if (domain.includes(platformDomain)) {
        return platformName
      }
    }
    return null
  } catch {
    return null
  }
}

function detectType(url: string): "song" | "playlist" | "album" {
  const urlLower = url.toLowerCase()
  if (urlLower.includes("/playlist/") || urlLower.includes("/playlist?")) {
    return "playlist"
  }
  if (urlLower.includes("/album/") || urlLower.includes("/album?")) {
    return "album"
  }
  return "song"
}

export async function POST(request: NextRequest) {
  let url: string = ""

  try {
    const body = await request.json()
    url = body.url

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    const platform = getPlatform(url) || "Unknown"
    const type = detectType(url)

    // Check for DRM protection before attempting download
    if (isDRMProtected(url)) {
      const platformName = getPlatform(url) || "This platform"
      return NextResponse.json(
        {
          error: `${platformName} uses DRM (Digital Rights Management) protection and cannot be downloaded directly.`,
          drmProtected: true,
          platform: platformName,
          suggestions: [
            "Try YouTube Music, SoundCloud, or Bandcamp instead",
            "Use the official platform app for offline listening",
            "Look for official download options in the platform's premium features",
          ],
        },
        { status: 400 }
      )
    }

    // Use yt-dlp to extract info
    const command = `yt-dlp -J --no-warnings "${url}"`

    let stdout: string
    let stderr: string

    try {
      const result = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      })
      stdout = result.stdout
      stderr = result.stderr || ""
    } catch (execError: any) {
      const errorMessage = execError.stderr || execError.message || ""
      if (errorMessage.includes("[DRM]") || errorMessage.includes("DRM protection")) {
        const platformName = getPlatform(url) || "This platform"
        return NextResponse.json(
          {
            error: `${platformName} uses DRM (Digital Rights Management) protection and cannot be downloaded.`,
            drmProtected: true,
            platform: platformName,
            suggestions: [
              "Try YouTube Music, SoundCloud, or Bandcamp instead",
              "Use the official platform app for offline listening",
              "Look for official download options in the platform's premium features",
            ],
          },
          { status: 400 }
        )
      }
      throw execError
    }

    if (stderr && !stdout) {
      if (stderr.includes("[DRM]") || stderr.includes("DRM protection")) {
        const platformName = getPlatform(url) || "This platform"
        return NextResponse.json(
          {
            error: `${platformName} uses DRM (Digital Rights Management) protection and cannot be downloaded.`,
            drmProtected: true,
            platform: platformName,
            suggestions: [
              "Try YouTube Music, SoundCloud, or Bandcamp instead",
              "Use the official platform app for offline listening",
              "Look for official download options in the platform's premium features",
            ],
          },
          { status: 400 }
        )
      }
      throw new Error(stderr)
    }

    const info = JSON.parse(stdout)

    // Extract MP3 format options
    const formats = [
      {
        format_id: "audio_mp3_128",
        quality: "MP3 128kbps",
        bitrate: 128,
        ext: "mp3",
        filesize: null,
        filesize_mb: null,
      },
      {
        format_id: "audio_mp3_192",
        quality: "MP3 192kbps",
        bitrate: 192,
        ext: "mp3",
        filesize: null,
        filesize_mb: null,
      },
      {
        format_id: "audio_mp3_256",
        quality: "MP3 256kbps",
        bitrate: 256,
        ext: "mp3",
        filesize: null,
        filesize_mb: null,
      },
      {
        format_id: "audio_mp3_320",
        quality: "MP3 320kbps (Best)",
        bitrate: 320,
        ext: "mp3",
        filesize: null,
        filesize_mb: null,
      },
    ]

    let tracks: any[] = []
    let trackCount = 0

    if (type === "playlist" || type === "album") {
      if (info.entries && Array.isArray(info.entries)) {
        tracks = info.entries.slice(0, 100).map((entry: any, index: number) => ({
          title: entry.title || `Track ${index + 1}`,
          artist: entry.artist || entry.uploader || "Unknown",
          duration: entry.duration || 0,
          url: entry.url || entry.webpage_url || url,
        }))
        trackCount = info.entries.length
      } else if (info._type === "playlist") {
        try {
          const playlistCommand = `yt-dlp --flat-playlist -J --no-warnings "${url}"`
          const { stdout: playlistStdout } = await execAsync(playlistCommand, {
            maxBuffer: 20 * 1024 * 1024,
            timeout: 60000,
          })
          const playlistInfo = JSON.parse(playlistStdout)
          if (playlistInfo.entries) {
            tracks = playlistInfo.entries.slice(0, 100).map((entry: any, index: number) => ({
              title: entry.title || `Track ${index + 1}`,
              artist: entry.artist || entry.uploader || "Unknown",
              duration: entry.duration || 0,
              url: entry.url || entry.id || url,
            }))
            trackCount = playlistInfo.entries.length
          }
        } catch (err) {
          console.log("Could not extract playlist tracks:", err)
        }
      }
    }

    return NextResponse.json({
      success: true,
      platform: platform,
      title: info.title || "Unknown",
      thumbnail: info.thumbnail,
      duration: info.duration || 0,
      artist: info.artist || info.uploader || info.creator || "Unknown",
      album: info.album || undefined,
      formats: formats,
      type: type,
      trackCount: trackCount || (tracks.length > 0 ? tracks.length : undefined),
      tracks: tracks.length > 0 ? tracks : undefined,
    })
  } catch (error: any) {
    console.error("Error fetching song info:", error)

    const errorMessage = error.message || error.stderr || ""
    if (errorMessage.includes("[DRM]") || errorMessage.includes("DRM protection")) {
      if (url) {
        const platformName = getPlatform(url) || "This platform"
        return NextResponse.json(
          {
            error: `${platformName} uses DRM (Digital Rights Management) protection and cannot be downloaded.`,
            drmProtected: true,
            platform: platformName,
            suggestions: [
              "Try YouTube Music, SoundCloud, or Bandcamp instead",
              "Use the official platform app for offline listening",
              "Look for official download options in the platform's premium features",
            ],
          },
          { status: 400 }
        )
      }
      return NextResponse.json(
        {
          error: "This platform uses DRM protection and cannot be downloaded.",
          drmProtected: true,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: error.message || "Failed to fetch song information" }, { status: 500 })
  }
}
