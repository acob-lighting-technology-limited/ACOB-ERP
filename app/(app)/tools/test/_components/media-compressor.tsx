"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, Download, Loader2, FileImage, FileVideo, Minimize2 } from "lucide-react"

export function MediaCompressor() {
  const [compressorType, setCompressorType] = useState<"image" | "video">("image")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [compressionMode, setCompressionMode] = useState<"size" | "percentage">("size")
  const [targetSize, setTargetSize] = useState("")
  const [sizeUnit, setSizeUnit] = useState<"KB" | "MB" | "GB">("MB")
  const [percentage, setPercentage] = useState("50")
  const [compressing, setCompressing] = useState(false)

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

  const handleCompress = async () => {
    const file = compressorType === "image" ? imageFile : videoFile

    if (!file) {
      toast.error(`Please select ${compressorType === "image" ? "an image" : "a video"} file`)
      return
    }

    if (compressionMode === "size" && !targetSize) {
      toast.error("Please enter target size")
      return
    }

    if (
      compressionMode === "percentage" &&
      (!percentage || parseFloat(percentage) <= 0 || parseFloat(percentage) >= 100)
    ) {
      toast.error("Please enter a valid percentage (1-99)")
      return
    }

    setCompressing(true)
    const toastId = toast.loading(`Compressing ${compressorType}...`)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("mode", compressionMode)
      if (compressionMode === "size") {
        formData.append("targetSize", targetSize)
        formData.append("sizeUnit", sizeUnit)
      } else {
        formData.append("percentage", percentage)
      }

      const endpoint = compressorType === "image" ? "/api/compress/image" : "/api/compress/video"
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Compression failed")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `compressed_${file.name}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success("Compression successful!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Compression failed", { id: toastId })
    } finally {
      setCompressing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-muted flex inline-flex self-start rounded-lg p-1">
        <Button
          variant={compressorType === "image" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            setCompressorType("image")
          }}
        >
          <FileImage className="mr-2 h-4 w-4" /> Image Compressor
        </Button>
        <Button
          variant={compressorType === "video" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            setCompressorType("video")
          }}
        >
          <FileVideo className="mr-2 h-4 w-4" /> Video Compressor
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{compressorType === "image" ? "Upload Image" : "Upload Video"}</CardTitle>
            <CardDescription>Select a file and specify the target size settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-secondary/5 border-muted hover:border-primary/50 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors">
              <Upload className="text-muted-foreground mb-2 h-8 w-8" />
              <p className="text-muted-foreground mb-4 text-sm font-medium">
                Drag and drop your file here, or click to browse.
              </p>
              <Input
                id="compress-upload"
                type="file"
                className="hidden"
                accept={compressorType === "image" ? "image/*" : "video/*"}
                onChange={compressorType === "image" ? handleImageFileChange : handleVideoFileChange}
              />
              <Button size="sm" asChild variant="outline">
                <label htmlFor="compress-upload">Browse Files</label>
              </Button>
            </div>

            {/* Selected File Details */}
            {compressorType === "image" && imageFile && (
              <div className="bg-muted flex items-center gap-3 rounded-lg p-3 text-sm">
                <FileImage className="text-primary h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{imageFile.name}</p>
                  <p className="text-muted-foreground text-xs">{(imageFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                </div>
              </div>
            )}
            {compressorType === "video" && videoFile && (
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

        {/* Compression settings */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle>Compression Settings</CardTitle>
            <CardDescription>Configure the target file size or percentage.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-4">
            <div className="bg-muted mb-2 flex inline-flex w-full self-start rounded-lg p-1">
              <Button
                variant={compressionMode === "size" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1"
                onClick={() => setCompressionMode("size")}
              >
                Target Size
              </Button>
              <Button
                variant={compressionMode === "percentage" ? "secondary" : "ghost"}
                size="sm"
                className="flex-1"
                onClick={() => setCompressionMode("percentage")}
              >
                Percentage
              </Button>
            </div>

            {compressionMode === "size" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Target Size</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Enter target size"
                    value={targetSize}
                    onChange={(e) => setTargetSize(e.target.value)}
                  />
                  <Select value={sizeUnit} onValueChange={(v: any) => setSizeUnit(v)}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue placeholder="Unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KB">KB</SelectItem>
                      <SelectItem value="MB">MB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium">Reduction Percentage (1-99%)</label>
                <div className="flex items-center gap-4">
                  <Input
                    type="range"
                    min="1"
                    max="99"
                    className="flex-1 cursor-pointer"
                    value={percentage}
                    onChange={(e) => setPercentage(e.target.value)}
                  />
                  <span className="min-w-10 text-sm font-bold">{percentage}%</span>
                </div>
              </div>
            )}
          </CardContent>
          <div className="border-t p-6">
            <Button
              className="w-full"
              onClick={handleCompress}
              disabled={compressing || (compressorType === "image" ? !imageFile : !videoFile)}
            >
              {compressing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Compressing...
                </>
              ) : (
                <>
                  <Minimize2 className="mr-2 h-4 w-4" />
                  Compress File
                </>
              )}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
