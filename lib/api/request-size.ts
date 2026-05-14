import { NextResponse } from "next/server"

const MAX_BODY_BYTES = 1 * 1024 * 1024 // 1 MB default

export function checkRequestSize(request: Request, maxBytes = MAX_BODY_BYTES): NextResponse | null {
  const contentLength = request.headers.get("content-length")
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return NextResponse.json({ error: "Request body too large", code: "PAYLOAD_TOO_LARGE" }, { status: 413 })
  }
  return null
}
