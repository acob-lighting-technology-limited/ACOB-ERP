"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Merge,
  Scissors,
  Minimize2,
  Image as ImageIcon,
  FileImage,
  Type,
  FileEdit,
  FileCode,
  Key,
  FileText,
  Loader2,
} from "lucide-react"

type PdfToolType =
  | "merge"
  | "split"
  | "compress"
  | "convert"
  | "images-to-pdf"
  | "extract-text"
  | "add-text"
  | "to-doc"
  | "watermark"
  | "password"
  | "ocr"

export function PdfTools() {
  const [toolType, setToolType] = useState<PdfToolType>("merge")
  const [pdfFiles, setPdfFiles] = useState<File[]>([])
  const [singlePdfFile, setSinglePdfFile] = useState<File | null>(null)
  // Object URL for the selected PDF so the operator can see the document they
  // are about to split, page-number it, and pick ranges with confidence.
  const [singlePdfPreviewUrl, setSinglePdfPreviewUrl] = useState<string | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [splitPages, setSplitPages] = useState("")
  const [convertFormat, setConvertFormat] = useState("jpg")
  const [compressionMode, setCompressionMode] = useState<"size" | "percentage">("size")
  const [targetSize, setTargetSize] = useState("")
  const [sizeUnit, setSizeUnit] = useState<"KB" | "MB" | "GB">("MB")
  const [percentage, setPercentage] = useState("50")
  const [processing, setProcessing] = useState(false)
  const [extractedText, setExtractedText] = useState("")
  const [textToAdd, setTextToAdd] = useState("")
  const [textX, setTextX] = useState("50")
  const [textY, setTextY] = useState("50")
  const [textFontSize, setTextFontSize] = useState("12")
  const [textPageNumber, setTextPageNumber] = useState("1")
  const [textColor, setTextColor] = useState("000000")
  const [textPosition, setTextPosition] = useState<"top" | "bottom" | "center" | "custom">("custom")
  const [watermarkType, setWatermarkType] = useState<"text" | "image">("text")
  const [watermarkText, setWatermarkText] = useState("")
  const [watermarkImage, setWatermarkImage] = useState<File | null>(null)
  const [watermarkPosition, setWatermarkPosition] = useState<"center" | "top" | "bottom" | "custom">("center")
  const [watermarkX, setWatermarkX] = useState("0")
  const [watermarkY, setWatermarkY] = useState("0")
  const [watermarkFontSize, setWatermarkFontSize] = useState("48")
  const [watermarkOpacity, setWatermarkOpacity] = useState("0.5")
  const [watermarkColor, setWatermarkColor] = useState("000000")
  const [passwordAction, setPasswordAction] = useState<"protect" | "remove">("protect")
  const [pdfPassword, setPdfPassword] = useState("")
  const [ocrOutputFormat, setOcrOutputFormat] = useState<"text" | "pdf">("text")
  const [ocrText, setOcrText] = useState("")

  const handlePdfFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const pdfs = files.filter((f) => f.type === "application/pdf")
    if (pdfs.length > 0) {
      setPdfFiles(pdfs)
      toast.success(`${pdfs.length} PDF file(s) selected`)
    } else {
      toast.error("Please select PDF files")
    }
  }

  const handleSinglePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === "application/pdf") {
      setSinglePdfFile(file)
      setSinglePdfPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return URL.createObjectURL(file)
      })
      toast.success("PDF file selected")
    } else {
      toast.error("Please select a PDF file")
    }
  }

  // Release the last object URL when the component goes away.
  useEffect(() => {
    return () => {
      if (singlePdfPreviewUrl) URL.revokeObjectURL(singlePdfPreviewUrl)
    }
  }, [singlePdfPreviewUrl])

  const handleImageFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const images = files.filter((f) => f.type.startsWith("image/"))
    if (images.length > 0) {
      setImageFiles(images)
      toast.success(`${images.length} image(s) selected`)
    } else {
      toast.error("Please select image files")
    }
  }

  const handleMerge = async () => {
    if (pdfFiles.length < 2) {
      toast.error("Please select at least 2 PDF files to merge")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Merging PDFs...")
    try {
      const formData = new FormData()
      pdfFiles.forEach((file, index) => {
        formData.append(`file${index}`, file)
      })
      formData.append("count", pdfFiles.length.toString())

      const response = await apiFetch("/api/pdf/merge", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Merge failed")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `merged_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("PDFs merged successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Merge failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handleSplit = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
      return
    }
    if (!splitPages.trim()) {
      toast.error("Please enter page ranges (e.g., 1-5, 10-15)")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Splitting PDF...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)
      formData.append("pages", splitPages)
      formData.append("pageRanges", splitPages)

      const response = await apiFetch("/api/pdf/split", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Split failed")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `split_${singlePdfFile.name.replace(/\.pdf$/i, "")}_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("PDF split successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Split failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handleCompress = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
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
    setProcessing(true)
    const toastId = toast.loading("Compressing PDF...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)
      formData.append("mode", compressionMode)
      if (compressionMode === "size") {
        formData.append("targetSize", targetSize)
        formData.append("sizeUnit", sizeUnit)
      } else {
        formData.append("percentage", percentage)
      }

      const response = await apiFetch("/api/pdf/compress", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Compression failed")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `compressed_${singlePdfFile.name}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("PDF compressed successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Compression failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handleConvert = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Converting PDF to images...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)
      formData.append("format", convertFormat)

      const response = await apiFetch("/api/pdf/convert", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Conversion failed")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `pdf_images_${Date.now()}.zip`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("PDF converted successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Conversion failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handleImagesToPdf = async () => {
    if (imageFiles.length === 0) {
      toast.error("Please select at least one image file")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Converting images to PDF...")
    try {
      const formData = new FormData()
      imageFiles.forEach((file, index) => {
        formData.append(`file${index}`, file)
      })
      formData.append("count", imageFiles.length.toString())

      const response = await apiFetch("/api/pdf/images-to-pdf", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Conversion failed")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `images_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("Images converted to PDF successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Conversion failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handleExtractText = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Extracting text...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)

      const response = await apiFetch("/api/pdf/extract-text", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Text extraction failed")
      }
      const data = await response.json()
      setExtractedText(data.text || "No text found in PDF")
      toast.success("Text extracted successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Text extraction failed", { id: toastId })
      setExtractedText("")
    } finally {
      setProcessing(false)
    }
  }

  const handleAddText = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
      return
    }
    if (!textToAdd.trim()) {
      toast.error("Please enter text to add")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Adding text...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)
      formData.append("text", textToAdd)
      formData.append("x", textX)
      formData.append("y", textY)
      formData.append("fontSize", textFontSize)
      formData.append("pageNumber", textPageNumber)
      formData.append("color", textColor)
      formData.append("position", textPosition)

      const response = await apiFetch("/api/pdf/add-text", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to add text")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `pdf_with_text_${Date.now()}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("Text added successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Failed to add text", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handlePdfToDoc = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Converting PDF to DOCX...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)
      formData.append("format", "docx")

      const response = await apiFetch("/api/pdf/to-doc", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Conversion failed")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${singlePdfFile.name.replace(/\.pdf$/i, "")}_${Date.now()}.docx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("PDF converted to DOCX successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Conversion failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handleWatermark = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
      return
    }
    if (watermarkType === "text" && !watermarkText) {
      toast.error("Please enter watermark text")
      return
    }
    if (watermarkType === "image" && !watermarkImage) {
      toast.error("Please select a watermark image")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Adding watermark...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)
      formData.append("watermarkType", watermarkType)
      if (watermarkType === "text") {
        formData.append("watermarkText", watermarkText)
      } else {
        formData.append("watermarkImage", watermarkImage!)
      }
      formData.append("position", watermarkPosition)
      formData.append("opacity", watermarkOpacity)
      formData.append("fontSize", watermarkFontSize)
      formData.append("color", watermarkColor)
      if (watermarkPosition === "custom") {
        formData.append("x", watermarkX)
        formData.append("y", watermarkY)
      }

      const response = await apiFetch("/api/pdf/watermark", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Watermarking failed")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `watermarked_${singlePdfFile.name}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("Watermark added successfully!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Watermarking failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handlePassword = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
      return
    }
    if (!pdfPassword) {
      toast.error("Please enter a password")
      return
    }
    setProcessing(true)
    const toastId = toast.loading(passwordAction === "protect" ? "Protecting PDF..." : "Removing password...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)
      formData.append("action", passwordAction)
      formData.append("password", pdfPassword)

      const response = await apiFetch("/api/pdf/password", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Password operation failed")
      }

      const contentType = response.headers.get("content-type") || ""
      if (contentType.includes("application/json")) {
        const data = await response.json()
        throw new Error(data.error || "Password operation failed")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${passwordAction === "protect" ? "protected" : "unprotected"}_${singlePdfFile.name}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success("Password operation complete!", { id: toastId })
    } catch (error: any) {
      toast.error(error.message || "Password operation failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  const handleOcr = async () => {
    if (!singlePdfFile) {
      toast.error("Please select a PDF file")
      return
    }
    setProcessing(true)
    const toastId = toast.loading("Performing OCR...")
    try {
      const formData = new FormData()
      formData.append("file", singlePdfFile)
      formData.append("outputFormat", ocrOutputFormat)

      const response = await apiFetch("/api/pdf/ocr", { method: "POST", body: formData })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "OCR failed")
      }

      if (ocrOutputFormat === "text") {
        const data = await response.json()
        setOcrText(data.text || "")
        toast.success("OCR Text extracted!", { id: toastId })
      } else {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `ocr_${singlePdfFile.name}`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        toast.success("OCR PDF generated successfully!", { id: toastId })
      }
    } catch (error: any) {
      toast.error(error.message || "OCR failed", { id: toastId })
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Tool Selector Buttons */}
      <div className="bg-muted flex max-w-full flex-wrap gap-2 rounded-lg p-1">
        {(
          [
            "merge",
            "split",
            "compress",
            "convert",
            "images-to-pdf",
            "extract-text",
            "add-text",
            "to-doc",
            "watermark",
            "password",
            "ocr",
          ] as PdfToolType[]
        ).map((t) => (
          <Button
            key={t}
            variant={toolType === t ? "secondary" : "ghost"}
            size="sm"
            className="px-3 text-xs capitalize"
            onClick={() => {
              setToolType(t)
              setPdfFiles([])
              setSinglePdfFile(null)
              setImageFiles([])
            }}
          >
            {t.replace("-", " ")}
          </Button>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="capitalize">{toolType.replace("-", " ")} PDF</CardTitle>
            <CardDescription>Configure options and upload PDF files.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Input upload sections based on tool type */}
            {toolType === "merge" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select multiple PDF files</label>
                  <Input type="file" accept="application/pdf" multiple onChange={handlePdfFilesChange} />
                  {pdfFiles.length > 0 && (
                    <div className="text-muted-foreground text-xs">{pdfFiles.length} file(s) selected</div>
                  )}
                </div>
                <Button className="w-full" onClick={handleMerge} disabled={pdfFiles.length < 2 || processing}>
                  {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Merge className="mr-2 h-4 w-4" />}
                  Merge PDFs
                </Button>
              </div>
            )}

            {toolType === "split" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                  {singlePdfFile && <div className="text-muted-foreground text-xs">{singlePdfFile.name}</div>}
                </div>
                {singlePdfPreviewUrl && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Preview</label>
                    <iframe
                      src={singlePdfPreviewUrl}
                      title={`Preview of ${singlePdfFile?.name || "selected PDF"}`}
                      className="h-[420px] w-full rounded-md border"
                    />
                    <p className="text-muted-foreground text-xs">
                      Scroll to find the pages you want, then enter their numbers below.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Page Ranges</label>
                  <Input
                    placeholder="e.g. 1-3, 5, 7-10"
                    value={splitPages}
                    onChange={(e) => setSplitPages(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={handleSplit}
                  disabled={!singlePdfFile || !splitPages.trim() || processing}
                >
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Scissors className="mr-2 h-4 w-4" />
                  )}
                  Split PDF
                </Button>
              </div>
            )}

            {toolType === "compress" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                </div>
                <div className="bg-muted mb-2 flex w-full rounded-lg p-1">
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
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Enter target size"
                      value={targetSize}
                      onChange={(e) => setTargetSize(e.target.value)}
                      className="flex-1"
                    />
                    <select
                      value={sizeUnit}
                      onChange={(e: any) => setSizeUnit(e.target.value)}
                      className="bg-background w-24 rounded border px-2 text-sm"
                    >
                      <option value="KB">KB</option>
                      <option value="MB">MB</option>
                    </select>
                  </div>
                ) : (
                  <Input
                    type="number"
                    placeholder="Reduction (1-99%)"
                    value={percentage}
                    onChange={(e) => setPercentage(e.target.value)}
                  />
                )}
                <Button className="w-full" onClick={handleCompress} disabled={!singlePdfFile || processing}>
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Minimize2 className="mr-2 h-4 w-4" />
                  )}
                  Compress PDF
                </Button>
              </div>
            )}

            {toolType === "convert" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Image Format</label>
                  <select
                    value={convertFormat}
                    onChange={(e) => setConvertFormat(e.target.value)}
                    className="bg-background w-full rounded border p-2 text-sm"
                  >
                    <option value="jpg">JPEG (.jpg)</option>
                    <option value="png">PNG (.png)</option>
                    <option value="webp">WebP (.webp)</option>
                  </select>
                </div>
                <Button className="w-full" onClick={handleConvert} disabled={!singlePdfFile || processing}>
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="mr-2 h-4 w-4" />
                  )}
                  Convert PDF to Images (ZIP)
                </Button>
              </div>
            )}

            {toolType === "images-to-pdf" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select Images</label>
                  <Input type="file" accept="image/*" multiple onChange={handleImageFilesChange} />
                </div>
                <Button className="w-full" onClick={handleImagesToPdf} disabled={imageFiles.length === 0 || processing}>
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileImage className="mr-2 h-4 w-4" />
                  )}
                  Create PDF from Images
                </Button>
              </div>
            )}

            {toolType === "extract-text" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                </div>
                <Button className="w-full" onClick={handleExtractText} disabled={!singlePdfFile || processing}>
                  {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Type className="mr-2 h-4 w-4" />}
                  Extract Plain Text
                </Button>
                {extractedText && (
                  <div className="mt-4 space-y-2">
                    <label className="text-sm font-medium">Extracted Content</label>
                    <Textarea value={extractedText} readOnly className="min-h-48 font-mono text-xs" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(extractedText)
                        toast.success("Copied!")
                      }}
                    >
                      Copy to Clipboard
                    </Button>
                  </div>
                )}
              </div>
            )}

            {toolType === "add-text" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Text to Overlay</label>
                  <Input
                    placeholder="Enter custom text overlay"
                    value={textToAdd}
                    onChange={(e) => setTextToAdd(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Page Number</label>
                    <Input
                      type="number"
                      min="1"
                      value={textPageNumber}
                      onChange={(e) => setTextPageNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Font Size</label>
                    <Input
                      type="number"
                      min="8"
                      value={textFontSize}
                      onChange={(e) => setTextFontSize(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Positioning Mode</label>
                  <select
                    value={textPosition}
                    onChange={(e: any) => setTextPosition(e.target.value)}
                    className="bg-background w-full rounded border p-2 text-sm"
                  >
                    <option value="top">Top Center</option>
                    <option value="center">Center</option>
                    <option value="bottom">Bottom Center</option>
                    <option value="custom">Custom (X/Y)</option>
                  </select>
                </div>
                {textPosition === "custom" && (
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      type="number"
                      placeholder="X coordinate"
                      value={textX}
                      onChange={(e) => setTextX(e.target.value)}
                    />
                    <Input
                      type="number"
                      placeholder="Y coordinate"
                      value={textY}
                      onChange={(e) => setTextY(e.target.value)}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Text Color (Hex)</label>
                  <div className="flex gap-2">
                    <Input
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value.substring(0, 6))}
                      className="flex-1"
                    />
                    <input
                      type="color"
                      value={`#${textColor}`}
                      onChange={(e) => setTextColor(e.target.value.replace("#", ""))}
                      className="h-10 w-12 cursor-pointer rounded border"
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={handleAddText}
                  disabled={!singlePdfFile || !textToAdd.trim() || processing}
                >
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileEdit className="mr-2 h-4 w-4" />
                  )}
                  Add Text Layer
                </Button>
              </div>
            )}

            {toolType === "to-doc" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                </div>
                <Button className="w-full" onClick={handlePdfToDoc} disabled={!singlePdfFile || processing}>
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileCode className="mr-2 h-4 w-4" />
                  )}
                  Convert to DOCX
                </Button>
              </div>
            )}

            {toolType === "watermark" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Watermark Source</label>
                  <select
                    value={watermarkType}
                    onChange={(e: any) => setWatermarkType(e.target.value)}
                    className="bg-background w-full rounded border p-2 text-sm"
                  >
                    <option value="text">Text Watermark</option>
                    <option value="image">Image Logo</option>
                  </select>
                </div>
                {watermarkType === "text" ? (
                  <Input
                    placeholder="CONFIDENTIAL, DRAFT, etc."
                    value={watermarkText}
                    onChange={(e) => setWatermarkText(e.target.value)}
                  />
                ) : (
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setWatermarkImage(e.target.files?.[0] || null)}
                  />
                )}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Position</label>
                  <select
                    value={watermarkPosition}
                    onChange={(e: any) => setWatermarkPosition(e.target.value)}
                    className="bg-background w-full rounded border p-2 text-sm"
                  >
                    <option value="center">Center (Recommended)</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="custom">Custom Coords</option>
                  </select>
                </div>
                {watermarkPosition === "custom" && (
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      type="number"
                      placeholder="X"
                      value={watermarkX}
                      onChange={(e) => setWatermarkX(e.target.value)}
                    />
                    <Input
                      type="number"
                      placeholder="Y"
                      value={watermarkY}
                      onChange={(e) => setWatermarkY(e.target.value)}
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Font/Logo Size</label>
                    <Input
                      type="number"
                      value={watermarkFontSize}
                      onChange={(e) => setWatermarkFontSize(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Opacity (0.1 - 1)</label>
                    <Input
                      type="number"
                      min="0.1"
                      max="1"
                      step="0.1"
                      value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(e.target.value)}
                    />
                  </div>
                </div>
                <Button className="w-full" onClick={handleWatermark} disabled={!singlePdfFile || processing}>
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Add Watermark Layer
                </Button>
              </div>
            )}

            {toolType === "password" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Action</label>
                  <select
                    value={passwordAction}
                    onChange={(e: any) => setPasswordAction(e.target.value)}
                    className="bg-background w-full rounded border p-2 text-sm"
                  >
                    <option value="protect">Add Encryption Password</option>
                    <option value="remove">Strip/Decrypt Password</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Password Key</label>
                  <Input
                    type="password"
                    placeholder="Enter security password"
                    value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={handlePassword}
                  disabled={!singlePdfFile || !pdfPassword || processing}
                >
                  {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}
                  Execute Password Security
                </Button>
              </div>
            )}

            {toolType === "ocr" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Select Scanned PDF file</label>
                  <Input type="file" accept="application/pdf" onChange={handleSinglePdfChange} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Output Format</label>
                  <select
                    value={ocrOutputFormat}
                    onChange={(e: any) => setOcrOutputFormat(e.target.value)}
                    className="bg-background w-full rounded border p-2 text-sm"
                  >
                    <option value="text">Raw Text File</option>
                    <option value="pdf">Searchable PDF Layer</option>
                  </select>
                </div>
                <Button className="w-full" onClick={handleOcr} disabled={!singlePdfFile || processing}>
                  {processing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Perform OCR Text Extraction
                </Button>
                {ocrText && ocrOutputFormat === "text" && (
                  <div className="mt-4 space-y-2">
                    <label className="text-sm font-medium">OCR Extracted Text</label>
                    <Textarea value={ocrText} readOnly className="min-h-48 font-mono text-xs" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(ocrText)
                        toast.success("Copied!")
                      }}
                    >
                      Copy OCR Text
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sidebar help */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">PDF Tools Help</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-xs leading-relaxed">
            <p>
              <strong>Merge</strong>: Combines multiple PDFs into a single continuous file. Add files in the order you
              want them merged.
            </p>
            <p>
              <strong>Split</strong>: Splits a PDF by extracting specified pages/ranges (e.g., &quot;1-3, 5, 8&quot;).
            </p>
            <p>
              <strong>Compress</strong>: Reduces PDF size by compressing images inside. If Ghostscript is installed on
              the host system, it will yield significantly higher compression rates.
            </p>
            <p>
              <strong>Images to PDF</strong>: Packs multiple image files into pages of a single PDF file.
            </p>
            <p>
              <strong>Extract Text</strong>: Parses digital text layers from a PDF directly in-memory.
            </p>
            <p>
              <strong>OCR</strong>: Performs optical character recognition on scanned/image PDFs to extract text using
              Tesseract.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
