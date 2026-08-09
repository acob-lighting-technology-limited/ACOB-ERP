"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiFetch } from "@/lib/api-client"
import { Upload, Download, Loader2, FileImage, FileVideo, RefreshCw } from "lucide-react"

const IMAGE_FORMATS = [
  { value: "jpg", label: "JPEG (.jpg)" },
  { value: "png", label: "PNG (.png)" },
  { value: "webp", label: "WebP (.webp)" },
  { value: "gif", label: "GIF (.gif)" },
  { value: "bmp", label: "BMP (.bmp)" },
  { value: "tiff", label: "TIFF (.tiff)" },
  { value: "ico", label: "ICO (.ico)" },
]

const VIDEO_FORMATS = [
  { value: "mp4", label: "MP4 (.mp4)" },
  { value: "webm", label: "WebM (.webm)" },
  { value: "mkv", label: "MKV (.mkv)" },
  { value: "avi", label: "AVI (.avi)" },
  { value: "mov", label: "MOV (.mov)" },
  { value: "flv", label: "FLV (.flv)" },
  { value: "wmv", label: "WMV (.wmv)" },
  { value: "m4v", label: "M4V (.m4v)" },
]

export function MediaConverter() {
  const [converterType, setConverterType] = useState<"image" | "video">("image")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [imageFormat, setImageFormat] = useState("jpg")
  const [videoFormat, setVideoFormat] = useState("mp4")
  const [converting, setConverting] = useState(false)

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.type.startsWith("image/")) {
        setImageFile(file)
        toast.success("Image selected")
      } else {
        toast.error("Please select an image file")
      }
    }
  }

  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.type.startsWith("video/")) {
        setVideoFile(file)
        toast.success("Video selected")
      } else {
        toast.error("Please select a video file")
      }
    }
  }

  const handleConvert = async () => {
    const file = converterType === "image" ? imageFile : videoFile
    const format = converterType === "image" ? imageFormat : videoFormat

    if (!file) {
      toast.error(`Please select ${converterType === "image" ? "an image" : "a video"} file`)
      return
    }

    setConverting(true)
    const toastId = toast.loading(`Converting ${converterType}...`)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("format", format)

      const endpoint = converterType === "image" ? "/api/convert/image" : "/api/convert/video"
      const response = await apiFetch(endpoint, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Conversion failed")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${file.name.substring(0, file.name.lastIndexOf(".")) || file.name}.${format}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success("Conversion successful!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Conversion failed", { id: toastId })
    } finally {
      setConverting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-muted flex inline-flex self-start rounded-lg p-1">
        <Button
          variant={converterType === "image" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            setConverterType("image")
          }}
        >
          <FileImage className="mr-2 h-4 w-4" /> Image Converter
        </Button>
        <Button
          variant={converterType === "video" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            setConverterType("video")
          }}
        >
          <FileVideo className="mr-2 h-4 w-4" /> Video Converter
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{converterType === "image" ? "Upload Image" : "Upload Video"}</CardTitle>
            <CardDescription>Select a file and specify the target format to convert.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-secondary/5 border-muted hover:border-primary/50 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors">
              <Upload className="text-muted-foreground mb-2 h-8 w-8" />
              <p className="text-muted-foreground mb-4 text-sm font-medium">
                Drag and drop your file here, or click to browse.
              </p>
              <Input
                id="file-upload"
                type="file"
                className="hidden"
                accept={converterType === "image" ? "image/*" : "video/*"}
                onChange={converterType === "image" ? handleImageFileChange : handleVideoFileChange}
              />
              <Button size="sm" asChild variant="outline">
                <label htmlFor="file-upload">Browse Files</label>
              </Button>
            </div>

            {/* Selected File Details */}
            {converterType === "image" && imageFile && (
              <div className="bg-muted flex items-center gap-3 rounded-lg p-3 text-sm">
                <FileImage className="text-primary h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{imageFile.name}</p>
                  <p className="text-muted-foreground text-xs">{(imageFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>
              </div>
            )}
            {converterType === "video" && videoFile && (
              <div className="bg-muted flex items-center gap-3 rounded-lg p-3 text-sm">
                <FileVideo className="text-primary h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{videoFile.name}</p>
                  <p className="text-muted-foreground text-xs">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversion settings */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle>Conversion Settings</CardTitle>
            <CardDescription>Configure the target formatting options.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Format</label>
              <Select
                value={converterType === "image" ? imageFormat : videoFormat}
                onValueChange={converterType === "image" ? setImageFormat : setVideoFormat}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select output format" />
                </SelectTrigger>
                <SelectContent>
                  {(converterType === "image" ? IMAGE_FORMATS : VIDEO_FORMATS).map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
          <div className="border-t p-6">
            <Button
              className="w-full"
              onClick={handleConvert}
              disabled={converting || (converterType === "image" ? !imageFile : !videoFile)}
            >
              {converting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Converting...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Convert File
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
