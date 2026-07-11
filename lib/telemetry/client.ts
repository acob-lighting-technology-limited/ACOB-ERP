"use client"

import { apiFetch } from "@/lib/api-client"

export interface ClientTelemetryPayload {
  source: "window.error" | "unhandledrejection" | "react.error_boundary" | "react.global_error_boundary"
  message: string
  stack?: string | null
  route?: string
  context?: Record<string, unknown>
}

export async function reportClientError(payload: ClientTelemetryPayload): Promise<void> {
  try {
    const body = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      href: typeof window !== "undefined" ? window.location.href : undefined,
    })

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" })
      const sent = navigator.sendBeacon("/api/telemetry/errors", blob)
      if (sent) return
    }

    await apiFetch("/api/telemetry/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      cache: "no-store",
    })
  } catch {
    // Never throw from telemetry client helpers.
  }
}
