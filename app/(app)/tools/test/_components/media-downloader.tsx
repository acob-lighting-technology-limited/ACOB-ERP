"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Download,
  Loader2,
  Video,
  Instagram,
  Twitter,
  Facebook,
  Youtube,
  FileDown,
  Music,
  Disc,
  Play,
} from "lucide-react"

interface Format {
  format_id: string
  quality: string
  width?: number
  height?: number
  ext: string
  filesize: number | null
  filesize_mb: number | null
  type?: "video" | "audio"
  bitrate?: number
}

interface MediaInfo {
  success: boolean
  platform: string
  title: string
  thumbnail: string
  duration: number
  uploader?: string
  artist?: string
  album?: string
  formats: Format[]
  audioFormats?: Format[]
  type?: "song" | "playlist" | "album"
  trackCount?: number
  tracks?: Array<{
    title: string
    artist: string
    duration: number
    url: string
  }>
}

export function MediaDownloader() {
  const [mediaType, setMediaType] = useState<"video" | "song">("video")
  const [mode, setMode] = useState<"single" | "batch">("single")
  const [url, setUrl] = useState("")
  const [batchUrls, setBatchUrls] = useState("")
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [error, setError] = useState("")
  const [downloadingFormatId, setDownloadingFormatId] = useState<string | null>(null)
  const [batchDownloading, setBatchDownloading] = useState(false)
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)

  const handleFetchInfo = useCallback(
    async (urlToFetch?: string) => {
      const urlToUse = urlToFetch || url
      if (!urlToUse.trim()) {
        toast.error("Please enter a URL")
        setError("Please enter a URL")
        return
      }

      setLoading(true)
      setError("")
      setInfo(null)
      const toastId = toast.loading(`Analyzing ${mediaType}...`)

      try {
        const endpoint = mediaType === "video" ? "/api/info" : "/api/song/info"
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: urlToUse }),
        })

        const data = await response.json()

        if (!response.ok) {
          if (data.drmProtected) {
            setError(data.error)
            toast.error(data.error, {
              id: toastId,
              description: data.suggestions?.[0] || "Unsupported platform",
              duration: 6000,
            })
            return
          }
          throw new Error(data.error || "Failed to fetch metadata")
        }

        setInfo(data)
        toast.success("Loaded successfully!", { id: toastId })
      } catch (err: any) {
        const errorMsg = err.message || "Failed to fetch information"
        setError(errorMsg)
        toast.error(errorMsg, { id: toastId })
      } finally {
        setLoading(false)
      }
    },
    [mediaType, url]
  )

  useEffect(() => {
    if (mode !== "single" || !url.trim()) return

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    const urlPattern = /^https?:\/\//i
    if (!urlPattern.test(url)) return

    debounceTimer.current = setTimeout(() => {
      handleFetchInfo(url)
    }, 800)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [url, mode, mediaType, handleFetchInfo])

  const handleDownload = async (formatId?: string, trackUrl?: string) => {
    const urlToDownload = trackUrl || url
    const isAudio = formatId?.startsWith("audio_mp3_") || mediaType === "song"
    const formatType = isAudio ? "MP3" : "video"

    setDownloadingFormatId(formatId || "best")
    setError("")

    const toastId = toast.loading(`Preparing ${formatType} download...`)

    try {
      const endpoint = mediaType === "video" ? "/api/download" : "/api/song/download"
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: urlToDownload,
          format_id: formatId,
          title: info?.title,
          artist: info?.artist || info?.uploader,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Download failed")
      }

      const contentDisposition = response.headers.get("Content-Disposition")
      let filename = `${info?.title || "download"}.${isAudio ? "mp3" : "mp4"}`
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i)
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, "")
        }
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = downloadUrl
      a.download = filename
      a.style.display = "none"
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)

      toast.success("Downloaded successfully!", {
        id: toastId,
        description: `Saved: ${filename}`,
      })
    } catch (err: any) {
      const errorMsg = err.message || "Download failed"
      setError(errorMsg)
      toast.error(errorMsg, { id: toastId })
    } finally {
      setDownloadingFormatId(null)
    }
  }

  const handleBatchDownload = async () => {
    if (!batchUrls.trim() && (!info || (info.type !== "playlist" && info.type !== "album"))) {
      toast.error("Please enter URLs or select a playlist")
      return
    }

    setBatchDownloading(true)
    setError("")

    const urls =
      mode === "batch"
        ? batchUrls
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
        : info?.tracks?.map((t) => t.url) || []

    if (urls.length === 0) {
      toast.error("No valid URLs found")
      setBatchDownloading(false)
      return
    }

    const toastId = toast.loading(`Downloading ${urls.length} items... This will take a while.`)

    try {
      const endpoint = mediaType === "video" ? "/api/batch-download" : "/api/song/batch-download"
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          urls,
          playlistName: info?.title,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Batch download failed")
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = downloadUrl
      a.download = mediaType === "video" ? `videos_batch_${Date.now()}.zip` : `${info?.title || "songs"}_batch.zip`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)

      if (mode === "batch") setBatchUrls("")
      toast.success("Successfully processed batch!", { id: toastId })
    } catch (err: any) {
      const errorMsg = err.message || "Batch download failed"
      setError(errorMsg)
      toast.error(errorMsg, { id: toastId })
    } finally {
      setBatchDownloading(false)
    }
  }

  const formatDuration = (secs: number) => {
    if (!secs) return "0:00"
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m}:${s < 10 ? "0" : ""}${s}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row">
        {/* Media Select */}
        <div className="bg-muted flex self-start rounded-lg p-1">
          <Button
            variant={mediaType === "video" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setMediaType("video")
              setInfo(null)
              setUrl("")
              setError("")
            }}
          >
            <Video className="mr-2 h-4 w-4" /> Video Downloader
          </Button>
          <Button
            variant={mediaType === "song" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setMediaType("song")
              setInfo(null)
              setUrl("")
              setError("")
            }}
          >
            <Music className="mr-2 h-4 w-4" /> Song Downloader
          </Button>
        </div>

        {/* Mode Select */}
        <div className="bg-muted flex self-start rounded-lg p-1">
          <Button
            variant={mode === "single" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setMode("single")
              setInfo(null)
              setError("")
            }}
          >
            Single Downloader
          </Button>
          <Button
            variant={mode === "batch" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              setMode("batch")
              setInfo(null)
              setError("")
            }}
          >
            Batch Downloader
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{mediaType === "video" ? "Video URL" : "Song/Playlist URL"}</CardTitle>
              <CardDescription>
                {mode === "single"
                  ? "Paste a URL from any supported media platform"
                  : "Paste multiple URLs (one per line) to download as a ZIP file"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {mode === "single" ? (
                <div className="flex gap-2">
                  <Input
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleFetchInfo()}
                  />
                  <Button onClick={() => handleFetchInfo()} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <Textarea
                    placeholder="https://...\nhttps://..."
                    rows={6}
                    value={batchUrls}
                    onChange={(e) => setBatchUrls(e.target.value)}
                  />
                  <Button className="w-full" onClick={handleBatchDownload} disabled={batchDownloading}>
                    {batchDownloading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Downloading Batch...
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Download Batch as ZIP
                      </>
                    )}
                  </Button>
                </div>
              )}

              {error && (
                <p className="text-destructive bg-destructive/10 border-destructive/20 rounded-lg border p-3 text-sm">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Results Area */}
          <AnimatePresence>
            {info && mode === "single" && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-4"
              >
                <Card className="overflow-hidden">
                  <div className="flex flex-col sm:flex-row">
                    {info.thumbnail && (
                      <div className="bg-muted relative h-32 w-full sm:h-auto sm:w-48">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={info.thumbnail} alt={info.title} className="h-full w-full object-cover" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 p-6">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-semibold">
                          {info.platform}
                        </span>
                        {info.type && (
                          <span className="bg-secondary/15 text-secondary-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
                            {info.type}
                          </span>
                        )}
                      </div>
                      <h3 className="mb-1 truncate text-lg font-bold">{info.title}</h3>
                      <p className="text-muted-foreground mb-4 text-sm">
                        {info.artist || info.uploader ? `By ${info.artist || info.uploader}` : ""}
                        {info.duration ? ` • ${formatDuration(info.duration)}` : ""}
                        {info.trackCount ? ` • ${info.trackCount} tracks` : ""}
                      </p>

                      {info.type !== "playlist" && info.type !== "album" && (
                        <Button onClick={() => handleDownload()} disabled={downloadingFormatId !== null}>
                          {downloadingFormatId === "best" ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="mr-2 h-4 w-4" />
                          )}
                          Download Best Quality
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>

                {/* Video Quality options */}
                {mediaType === "video" && info.formats && info.formats.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Video Formats</CardTitle>
                    </CardHeader>
                    <CardContent className="divide-y p-0">
                      {info.formats.map((f) => (
                        <div key={f.format_id} className="flex items-center justify-between p-4">
                          <div>
                            <p className="text-sm font-medium">
                              {f.quality} ({f.ext})
                            </p>
                            {f.filesize_mb && <p className="text-muted-foreground text-xs">{f.filesize_mb} MB</p>}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadingFormatId !== null}
                            onClick={() => handleDownload(f.format_id)}
                          >
                            {downloadingFormatId === f.format_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Audio Conversion Options */}
                {info.audioFormats && info.audioFormats.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Convert to MP3</CardTitle>
                    </CardHeader>
                    <CardContent className="divide-y p-0">
                      {info.audioFormats.map((f) => (
                        <div key={f.format_id} className="flex items-center justify-between p-4">
                          <div>
                            <p className="text-sm font-medium">{f.quality}</p>
                            <p className="text-muted-foreground text-xs">High-quality MP3 audio</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadingFormatId !== null}
                            onClick={() => handleDownload(f.format_id)}
                          >
                            {downloadingFormatId === f.format_id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sidebar info */}
        <div className="space-y-4">
          {info && (info.type === "playlist" || info.type === "album") && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>Playlist Tracks</span>
                  <Button size="sm" onClick={handleBatchDownload} disabled={batchDownloading}>
                    {batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Download All"}
                  </Button>
                </CardTitle>
                <CardDescription>Showing first {info.tracks?.length || 0} tracks.</CardDescription>
              </CardHeader>
              <CardContent className="max-h-96 divide-y overflow-y-auto p-0">
                {info.tracks?.map((track, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 text-xs">
                    <div className="min-w-0 pr-2">
                      <p className="truncate font-medium">{track.title}</p>
                      <p className="text-muted-foreground truncate">
                        {track.artist} • {formatDuration(track.duration)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      disabled={downloadingFormatId !== null}
                      onClick={() => handleDownload(undefined, track.url)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supported Services</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground space-y-2 text-xs">
              <p>
                • <strong>Video</strong>: YouTube, TikTok, Instagram, Twitter/X, Facebook, Twitch, Vimeo, Dailymotion,
                Reddit, Pinterest.
              </p>
              <p>
                • <strong>Music</strong>: YouTube Music, SoundCloud, Bandcamp, Mixcloud.
              </p>
              <p>
                • <strong>DRM Warning</strong>: Spotify, Apple Music, and Amazon Music tracks cannot be downloaded
                directly due to DRM encryption.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
