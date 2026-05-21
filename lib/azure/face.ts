/**
 * Azure Face API helper
 *
 * Requires two env vars:
 *   AZURE_FACE_API_KEY      – subscription key from Azure portal
 *   AZURE_FACE_API_ENDPOINT – e.g. https://<region>.api.cognitive.microsoft.com/
 *
 * Free tier: 30,000 transactions / month — sufficient for ACOB's scale.
 *
 * Face IDs returned by detect() expire after 24 hours and are never stored.
 */

const API_KEY = process.env.AZURE_FACE_API_KEY ?? ""
const ENDPOINT = (process.env.AZURE_FACE_API_ENDPOINT ?? "").replace(/\/$/, "")

function faceHeaders(): HeadersInit {
  return {
    "Ocp-Apim-Subscription-Key": API_KEY,
    "Content-Type": "application/octet-stream",
  }
}

/**
 * Detect a single face in an image buffer and return its temporary faceId.
 * Returns `null` when no face is detected or multiple faces are found.
 */
export async function detectFaceId(imageBuffer: Buffer): Promise<string | null> {
  if (!API_KEY || !ENDPOINT) {
    throw new Error("Azure Face API is not configured. Set AZURE_FACE_API_KEY and AZURE_FACE_API_ENDPOINT.")
  }

  const url = `${ENDPOINT}/face/v1.0/detect?returnFaceId=true&detectionModel=detection_03`

  const response = await fetch(url, {
    method: "POST",
    headers: faceHeaders(),
    body: imageBuffer as unknown as BodyInit,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Azure Face detect failed (${response.status}): ${text}`)
  }

  const faces = (await response.json()) as Array<{ faceId: string }>

  if (!faces || faces.length === 0) return null
  if (faces.length > 1) return null // ambiguous — reject

  return faces[0].faceId
}

/**
 * Verify whether two face IDs belong to the same person.
 * Returns `{ isIdentical, confidence }` where confidence is 0.0 – 1.0.
 *
 * Confidence thresholds used by callers:
 *   ≥ 0.80 → auto-approved (face_verified = true)
 *   0.60 – 0.79 → saved but flagged for HR review (face_verified = false)
 *   < 0.60 → rejected — employee must retake selfie
 */
export async function verifyFaces(
  faceId1: string,
  faceId2: string
): Promise<{ isIdentical: boolean; confidence: number }> {
  if (!API_KEY || !ENDPOINT) {
    throw new Error("Azure Face API is not configured. Set AZURE_FACE_API_KEY and AZURE_FACE_API_ENDPOINT.")
  }

  const url = `${ENDPOINT}/face/v1.0/verify`

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ faceId1, faceId2 }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Azure Face verify failed (${response.status}): ${text}`)
  }

  const result = (await response.json()) as { isIdentical: boolean; confidence: number }
  return result
}

/**
 * Convenience: detect + verify in one call.
 * Downloads the reference image from a URL and detects the face,
 * then compares it against the selfie face ID.
 * Returns `null` if either image yields no detectable face.
 */
export async function matchSelfieToReference(
  selfieBuffer: Buffer,
  referenceImageUrl: string
): Promise<{ isIdentical: boolean; confidence: number } | null> {
  // Fetch reference image
  const refResponse = await fetch(referenceImageUrl)
  if (!refResponse.ok) {
    throw new Error(`Failed to fetch reference image: ${refResponse.status}`)
  }
  const refBuffer = Buffer.from(await refResponse.arrayBuffer())

  const [selfieFaceId, refFaceId] = await Promise.all([detectFaceId(selfieBuffer), detectFaceId(refBuffer)])

  if (!selfieFaceId || !refFaceId) return null

  return verifyFaces(selfieFaceId, refFaceId)
}
