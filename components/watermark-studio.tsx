"use client"

import type React from "react"
import { useState, useCallback } from "react"
import { toast } from "sonner"
import { MediaPreview } from "@/components/media-preview"
import { ImageGallery } from "@/components/image-gallery"
import { WatermarkSidebar } from "@/components/watermark/watermark-sidebar"
import { applyWatermark } from "@/components/watermark/apply-watermark"

export type Position =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "center-down-10"
  | "center-down-20"
  | "center-down-25"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"

export interface WatermarkConfig {
  position: Position
  opacity: number
  size: number
}

export interface WatermarkPreset {
  id: string
  name: string
  description: string
  config: WatermarkConfig
}

const WATERMARK_PRESETS: WatermarkPreset[] = [
  {
    id: "custom",
    name: "Custom",
    description: "Manually configure all settings",
    config: { position: "middle-right", opacity: 0.44, size: 25 },
  },
  {
    id: "website-optimized",
    name: "Website Optimized",
    description: "Perfect for website images - balanced protection & aesthetics",
    config: { position: "center-down-25", opacity: 0.44, size: 20 },
  },
  {
    id: "subtle",
    name: "Subtle Corner",
    description: "Minimal watermark in bottom-right corner",
    config: { position: "bottom-right", opacity: 0.3, size: 15 },
  },
  {
    id: "prominent",
    name: "Prominent Center",
    description: "Bold watermark for maximum protection",
    config: { position: "center", opacity: 0.5, size: 30 },
  },
]

const DEFAULT_WATERMARKS = [
  { id: "default", name: "ACOB Logo (Light)", path: "/images/acob-logo-watermark.webp" },
  { id: "dark", name: "ACOB Logo (Dark)", path: "/images/acob-logo-dark.webp" },
]

export function WatermarkStudio() {
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaType, setMediaType] = useState<"image" | "video" | null>(null)
  const [watermarks, setWatermarks] = useState(DEFAULT_WATERMARKS)
  const [selectedWatermark, setSelectedWatermark] = useState(DEFAULT_WATERMARKS[0].path)
  const [selectedPreset, setSelectedPreset] = useState<string>("website-optimized")
  const [customFileName, setCustomFileName] = useState<string>("")
  const [config, setConfig] = useState<WatermarkConfig>({ position: "center-down-25", opacity: 0.44, size: 20 })
  const [isProcessing, setIsProcessing] = useState(false)
  const [processedUrl, setProcessedUrl] = useState<string | null>(null)

  const handleMediaUpload = useCallback((files: File[], type: "image" | "video") => {
    if (type === "image") {
      setMediaFiles(files)
      setMediaFile(files[0] ?? null)
      setMediaType("image")
      setSelectedImageIndex(0)
    } else {
      const first = files[0] ?? null
      setMediaFiles(first ? [first] : [])
      setMediaFile(first)
      setMediaType(first ? "video" : null)
    }
    setProcessedUrl(null)
  }, [])

  const handleImageSelect = useCallback(
    (index: number) => {
      if (index >= 0 && index < mediaFiles.length) {
        setSelectedImageIndex(index)
        setMediaFile(mediaFiles[index])
        setProcessedUrl(null)
      }
    },
    [mediaFiles]
  )

  const handleRemoveImage = useCallback(
    (index: number) => {
      const newFiles = mediaFiles.filter((_, i) => i !== index)
      setMediaFiles(newFiles)
      if (newFiles.length === 0) {
        setMediaFile(null)
        setMediaType(null)
        setSelectedImageIndex(0)
        setProcessedUrl(null)
      } else {
        const newIndex = index >= newFiles.length ? newFiles.length - 1 : index
        setSelectedImageIndex(newIndex)
        setMediaFile(newFiles[newIndex])
        setProcessedUrl(null)
      }
      toast.success("Image removed", {
        description: `${newFiles.length} image${newFiles.length === 1 ? "" : "s"} remaining`,
      })
    },
    [mediaFiles]
  )

  const handleClearAllImages = useCallback(() => {
    setMediaFiles([])
    setMediaFile(null)
    setMediaType(null)
    setSelectedImageIndex(0)
    setProcessedUrl(null)
    toast.success("All images cleared", { description: "Upload new images to get started" })
  }, [])

  const handleWatermarkUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Invalid file", { description: "Please upload an image file for the watermark." })
      return
    }
    const url = URL.createObjectURL(file)
    setWatermarks((prev) => [...prev, { id: `custom-${Date.now()}`, name: file.name, path: url }])
    setSelectedWatermark(url)
    toast.success("Watermark added", { description: "Your custom watermark has been added to the list." })
  }, [])

  const handlePresetChange = useCallback((presetId: string) => {
    setSelectedPreset(presetId)
    const preset = WATERMARK_PRESETS.find((p) => p.id === presetId)
    if (preset) {
      setConfig(preset.config)
      toast.success("Preset applied", { description: preset.description })
    }
  }, [])

  const handleApplyWatermark = (applyToAll = false) =>
    applyWatermark({
      mediaType,
      mediaFile,
      mediaFiles,
      selectedWatermark,
      config,
      customFileName,
      applyToAll,
      onProcessedUrl: setProcessedUrl,
      onProcessingChange: setIsProcessing,
    })

  const handleDownload = () => {
    if (!processedUrl) return
    const link = document.createElement("a")
    link.href = processedUrl
    link.download = `watermarked-${mediaFile?.name || "media"}`
    link.click()
  }

  return (
    <div className="flex h-screen flex-col lg:flex-row-reverse">
      <WatermarkSidebar
        config={config}
        onConfigChange={setConfig}
        watermarks={watermarks}
        selectedWatermark={selectedWatermark}
        onWatermarkChange={setSelectedWatermark}
        onWatermarkUpload={handleWatermarkUpload}
        presets={WATERMARK_PRESETS}
        selectedPreset={selectedPreset}
        onPresetChange={handlePresetChange}
        mediaType={mediaType}
        mediaFiles={mediaFiles}
        mediaFile={mediaFile}
        customFileName={customFileName}
        onCustomFileNameChange={setCustomFileName}
        isProcessing={isProcessing}
        processedUrl={processedUrl}
        onApplyWatermark={handleApplyWatermark}
        onDownload={handleDownload}
      />
      <main className="flex-1 overflow-auto p-6">
        <div className="flex h-full flex-col gap-4">
          <div className="flex-1">
            <MediaPreview
              mediaFile={mediaFile}
              mediaType={mediaType}
              watermarkPath={selectedWatermark}
              config={config}
              processedUrl={processedUrl}
              onUpload={handleMediaUpload}
            />
          </div>
          {mediaType === "image" && mediaFiles.length > 0 && (
            <ImageGallery
              images={mediaFiles}
              selectedIndex={selectedImageIndex}
              onSelect={handleImageSelect}
              onRemove={handleRemoveImage}
              onClearAll={handleClearAllImages}
            />
          )}
        </div>
      </main>
    </div>
  )
}
