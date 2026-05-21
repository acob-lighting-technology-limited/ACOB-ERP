"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Camera, CheckCircle2, AlertCircle, Loader2, MapPin, RefreshCcw, ShieldCheck, ShieldX } from "lucide-react"
import { toast } from "sonner"

type Step = "camera" | "location" | "confirm"
type Mode = "clock-in" | "clock-out"

interface Props {
  open: boolean
  mode: Mode
  onClose: () => void
  onSuccess: () => void
}

interface LocationState {
  lat: number | null
  lng: number | null
  siteMatched: string | null
  loading: boolean
  error: string | null
}

export function RemoteCheckinModal({ open, mode, onClose, onSuccess }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [step, setStep] = useState<Step>("camera")
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [faceStatus, setFaceStatus] = useState<"pending" | "verified" | "flagged" | null>(null)

  const [locationState, setLocationState] = useState<LocationState>({
    lat: null,
    lng: null,
    siteMatched: null,
    loading: false,
    error: null,
  })

  const title = mode === "clock-in" ? "Remote Clock In" : "Remote Clock Out"
  const endpoint = mode === "clock-in" ? "/api/hr/attendance/remote-clock-in" : "/api/hr/attendance/remote-clock-out"

  // ── Camera management ────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (err) {
      setCameraError("Camera access denied. Please allow camera access to use remote check-in.")
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    if (open && step === "camera") {
      startCamera()
    } else {
      stopCamera()
    }
    return () => {
      stopCamera()
    }
  }, [open, step, startCamera, stopCamera])

  useEffect(() => {
    if (!open) {
      // Reset all state on close
      setStep("camera")
      setCapturedBlob(null)
      setCapturedDataUrl(null)
      setCameraError(null)
      setSubmitting(false)
      setFaceStatus(null)
      setLocationState({ lat: null, lng: null, siteMatched: null, loading: false, error: null })
    }
  }, [open])

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        setCapturedBlob(blob)
        setCapturedDataUrl(canvas.toDataURL("image/jpeg"))
        stopCamera()
        setStep("location")
        getLocation()
      },
      "image/jpeg",
      0.85
    )
  }

  function retake() {
    setCapturedBlob(null)
    setCapturedDataUrl(null)
    setLocationState({ lat: null, lng: null, siteMatched: null, loading: false, error: null })
    setStep("camera")
  }

  // ── Location management ──────────────────────────────────────────────────────
  function getLocation() {
    if (!navigator.geolocation) {
      setLocationState((s) => ({ ...s, error: "Geolocation is not supported by your browser." }))
      setStep("confirm")
      return
    }
    setLocationState({ lat: null, lng: null, siteMatched: null, loading: true, error: null })
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        // Ask the server which site (if any) we're near
        try {
          const res = await fetch(`/api/hr/attendance/sites/nearest?lat=${lat}&lng=${lng}`)
          const data = res.ok ? await res.json() : {}
          setLocationState({
            lat,
            lng,
            siteMatched: data.site_name ?? null,
            loading: false,
            error: null,
          })
        } catch {
          setLocationState({ lat, lng, siteMatched: null, loading: false, error: null })
        }
        setStep("confirm")
      },
      () => {
        setLocationState({
          lat: null,
          lng: null,
          siteMatched: null,
          loading: false,
          error: "Location access denied. Your check-in will be flagged for HR review.",
        })
        setStep("confirm")
      },
      { timeout: 15_000, enableHighAccuracy: true }
    )
  }

  // ── Submission ────────────────────────────────────────────────────────────────
  async function submit() {
    if (!capturedBlob) return
    setSubmitting(true)
    setFaceStatus("pending")

    const fd = new FormData()
    fd.append("selfie", capturedBlob, "selfie.jpg")
    fd.append("latitude", String(locationState.lat ?? 0))
    fd.append("longitude", String(locationState.lng ?? 0))

    try {
      const res = await fetch(endpoint, { method: "POST", body: fd })
      const data = await res.json()

      if (!res.ok) {
        setFaceStatus(null)
        setSubmitting(false)
        if (res.status === 422) {
          toast.error(data.error || "Face verification failed. Please retake your selfie.")
        } else {
          toast.error(data.error || "Check-in failed. Please try again.")
        }
        return
      }

      setFaceStatus(data.face_verified ? "verified" : "flagged")
      await new Promise((r) => setTimeout(r, 1200)) // brief pause so user sees the result

      if (data.review_required) {
        toast.warning(
          data.face_verified
            ? "Clocked in — location not verified. HR will review your check-in."
            : "Clocked in — face and/or location flagged for HR review.",
          { duration: 6000 }
        )
      } else {
        toast.success(mode === "clock-in" ? "Clocked in successfully!" : "Clocked out successfully!")
      }
      onSuccess()
      onClose()
    } catch {
      toast.error("Network error. Please try again.")
      setFaceStatus(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !submitting) onClose()
      }}
    >
      <DialogContent className="max-w-sm overflow-hidden p-0">
        <DialogHeader className="p-5 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {step === "camera" && "Take a selfie facing the camera to verify your identity."}
            {step === "location" && "Getting your location…"}
            {step === "confirm" && "Review your selfie and location, then confirm."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: Camera ── */}
        {step === "camera" && (
          <div className="space-y-4 p-5">
            {cameraError ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
                <AlertCircle className="h-8 w-8 text-red-500" />
                <p className="text-sm text-red-700">{cameraError}</p>
                <Button variant="outline" size="sm" onClick={startCamera}>
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Try again
                </Button>
              </div>
            ) : (
              <>
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full scale-x-[-1] object-cover"
                  />
                  {/* Face guide oval */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-48 w-36 rounded-full border-2 border-dashed border-white/60" />
                  </div>
                </div>
                <canvas ref={canvasRef} className="hidden" />
                <Button className="w-full" size="lg" onClick={capture}>
                  <Camera className="mr-2 h-5 w-5" />
                  Capture
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Location ── */}
        {step === "location" && (
          <div className="flex flex-col items-center gap-4 p-8">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
            <p className="text-muted-foreground text-sm">Getting your location…</p>
          </div>
        )}

        {/* ── Step 3: Confirm ── */}
        {step === "confirm" && (
          <div className="space-y-4 p-5">
            {/* Selfie thumbnail */}
            {capturedDataUrl && (
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturedDataUrl} alt="Your selfie" className="h-full w-full scale-x-[-1] object-cover" />
                {faceStatus === "pending" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <div className="flex flex-col items-center gap-2 text-white">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span className="text-sm">Verifying identity…</span>
                    </div>
                  </div>
                )}
                {faceStatus === "verified" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-green-900/40">
                    <ShieldCheck className="h-12 w-12 text-green-400" />
                  </div>
                )}
                {faceStatus === "flagged" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-amber-900/40">
                    <ShieldX className="h-12 w-12 text-amber-400" />
                  </div>
                )}
              </div>
            )}

            {/* Location status */}
            <div className="flex items-start gap-2 rounded-xl border p-3">
              <MapPin
                className={`mt-0.5 h-4 w-4 shrink-0 ${locationState.siteMatched ? "text-green-600" : "text-amber-500"}`}
              />
              <div className="text-sm">
                {locationState.loading ? (
                  <span className="text-muted-foreground">Getting location…</span>
                ) : locationState.error ? (
                  <span className="text-amber-700">{locationState.error}</span>
                ) : locationState.siteMatched ? (
                  <span className="font-medium text-green-700">✅ You are at: {locationState.siteMatched}</span>
                ) : locationState.lat !== null ? (
                  <span className="text-amber-700">
                    ⚠️ Location not matched to a registered site — your check-in will be reviewed by HR.
                  </span>
                ) : (
                  <span className="text-muted-foreground">Location unavailable</span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={retake} disabled={submitting}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Retake
              </Button>
              <Button className="flex-1" onClick={submit} disabled={submitting || locationState.loading}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Confirm {mode === "clock-in" ? "Clock In" : "Clock Out"}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
