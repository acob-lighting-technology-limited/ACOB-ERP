import { logger } from "@/lib/logger"

const log = logger("graph-client")

/**
 * App-only Microsoft Graph client (client-credentials flow), reusing the same
 * Azure app registration as the OneDrive integration. Kept separate from
 * `lib/onedrive` because meeting-artifact automation needs calendar + online
 * meeting scopes, not drive scopes, and we don't want to widen OneDriveService.
 */

type GraphTokenCache = {
  token: string
  expiresAt: number
}

type AzureTokenResponse = {
  access_token: string
  expires_in: number
}

let cachedToken: GraphTokenCache | null = null

function getConfig() {
  return {
    tenantId: process.env.AZURE_TENANT_ID || "",
    clientId: process.env.AZURE_CLIENT_ID || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
  }
}

export function isGraphConfigured(): boolean {
  const { tenantId, clientId, clientSecret } = getConfig()
  return Boolean(tenantId && clientId && clientSecret)
}

async function getGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const { tenantId, clientId, clientSecret } = getConfig()
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph is not configured (missing AZURE_* env vars)")
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  })

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Failed to acquire Graph token: ${detail}`)
  }

  const data: AzureTokenResponse = await response.json()
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return data.access_token
}

/** GET a Graph v1.0 endpoint and parse JSON, with one transient retry. */
export async function graphGet<T>(endpoint: string): Promise<T> {
  const token = await getGraphToken()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })

    if (response.ok) {
      return response.json() as Promise<T>
    }

    const detail = await response.text()
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      continue
    }

    log.error({ status: response.status, endpoint }, "Graph GET failed")
    throw new Error(`Graph API error (${response.status}): ${detail}`)
  }

  throw new Error("Graph GET failed after retry")
}
