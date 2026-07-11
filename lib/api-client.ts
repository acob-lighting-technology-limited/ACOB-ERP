"use client"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Drop-in replacement for fetch() against same-origin API routes. Injects the
 * x-csrf-token header (read from the csrf_token cookie set by middleware) on
 * state-changing requests, so the server's double-submit check can be enforced.
 *
 * Use this instead of the global fetch() for any client-side call to /api/*
 * that isn't a plain GET.
 */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || "GET").toUpperCase()

  if (!MUTATING_METHODS.has(method)) {
    return fetch(input, init)
  }

  const csrfToken = readCsrfCookie()
  if (!csrfToken) {
    return fetch(input, init)
  }

  const headers = new Headers(init.headers)
  headers.set("x-csrf-token", csrfToken)

  return fetch(input, { ...init, headers })
}
