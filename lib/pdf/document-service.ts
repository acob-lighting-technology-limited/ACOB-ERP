/**
 * Client for the document service (services/document-service).
 *
 * The PDF routes need ghostscript / poppler / qpdf / tesseract, none of which
 * exist on Vercel's serverless runtime. When DOCUMENT_SERVICE_URL is configured
 * the work is sent there; when it is not, callers fall back to whatever they did
 * before, so an unconfigured environment degrades exactly as it does today
 * rather than erroring in a new way.
 */
import { logger } from "@/lib/logger"

const log = logger("document-service")

export type DocumentServiceOperation = "compress" | "convert" | "encrypt" | "decrypt" | "ocr"

export interface DocumentServiceResult {
  bytes: Uint8Array
  contentType: string
  headers: Headers
}

export function isDocumentServiceConfigured(): boolean {
  return Boolean(process.env.DOCUMENT_SERVICE_URL && process.env.DOCUMENT_SERVICE_TOKEN)
}

/**
 * Run one operation. Throws on transport or service errors so callers can decide
 * between surfacing the failure and falling back.
 *
 * `password` is sent as a header, never a query parameter, to keep it out of
 * access logs and proxy traces.
 */
export async function callDocumentService(
  operation: DocumentServiceOperation,
  pdf: Uint8Array,
  options: { params?: Record<string, string | number | undefined>; password?: string; signal?: AbortSignal } = {}
): Promise<DocumentServiceResult> {
  const baseUrl = process.env.DOCUMENT_SERVICE_URL
  const token = process.env.DOCUMENT_SERVICE_TOKEN
  if (!baseUrl || !token) throw new Error("Document service is not configured")

  const url = new URL(operation, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
  for (const [key, value] of Object.entries(options.params || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/pdf",
  }
  if (options.password) headers["x-pdf-password"] = options.password

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: Buffer.from(pdf),
    signal: options.signal,
  })

  if (!response.ok) {
    let message = `Document service returned ${response.status}`
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload?.error) message = payload.error
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    log.error({ operation, status: response.status }, "Document service call failed")
    throw new Error(message)
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
    headers: response.headers,
  }
}
