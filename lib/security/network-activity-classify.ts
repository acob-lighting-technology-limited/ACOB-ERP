/**
 * Domain classification for the Network Activity table.
 *
 * Derived from a real 167-row export where ~140 rows were pure automated
 * background noise (certificate/CRL checks, OS connectivity pings, update
 * traffic) that drowned out the small number of rows reflecting what a
 * person actually browsed. This module buckets each row into one of three
 * categories so the UI can hide noise by default (without deleting data)
 * and surface genuinely unusual entries for security review.
 */

// ---------------------------------------------------------------------------
// Category type
// ---------------------------------------------------------------------------

export type NetworkActivityCategory = "normal" | "review" | "system_noise"

// ---------------------------------------------------------------------------
// system_noise — curated domain suffix list
// ---------------------------------------------------------------------------

/** Certificate/CRL/OCSP infrastructure. */
const CERTIFICATE_INFRA_DOMAINS = ["digicert.com", "lencr.org", "pki.goog"]

/** OS/app "am I online" connectivity checks. */
const CONNECTIVITY_CHECK_DOMAINS = [
  "msftconnecttest.com",
  "msftncsi.com",
  "captive.apple.com",
  "netcts.cdn-apple.com",
  "updates-http.cdn-apple.com",
  "static.ess.apple.com",
  "connectivitycheck.gstatic.com",
]

/** OS/app update infrastructure. */
const UPDATE_INFRA_DOMAINS = [
  "windowsupdate.com",
  "go.microsoft.com",
  "c2r.ts.cdn.office.net",
  "delivery.mp.microsoft.com",
  "update.googleapis.com",
  "clientservices.googleapis.com",
  "edgedl.me.gvt1.com",
  "play.googleapis.com",
  "clients2.google.com",
  "clients3.google.com",
  "acroipm2.adobe.com",
]

/** Utility / link-local endpoints — not domains, but matched the same way. */
const UTILITY_DOMAINS = ["169.254.169.254", "icanhazip.com"]

/** Full curated system-noise list, derived directly from the analyzed export. */
export const SYSTEM_NOISE_DOMAINS: readonly string[] = [
  ...CERTIFICATE_INFRA_DOMAINS,
  ...CONNECTIVITY_CHECK_DOMAINS,
  ...UPDATE_INFRA_DOMAINS,
  ...UTILITY_DOMAINS,
]

// ---------------------------------------------------------------------------
// review — tunneling/proxy services worth a second look
// ---------------------------------------------------------------------------

export const TUNNELING_PROXY_DOMAINS: readonly string[] = [
  "pagekite.me",
  "ngrok.io",
  "ngrok-free.app",
  "ngrok.app",
  "serveo.net",
  "localtunnel.me",
  "localhost.run",
]

// ---------------------------------------------------------------------------
// Domain-suffix matching helper — shared by both category checks
// ---------------------------------------------------------------------------

/**
 * True when `domain` exactly equals `suffix`, or is a subdomain of it
 * (e.g. "x1.c.lencr.org" matches "lencr.org"). Case-insensitive.
 */
function matchesDomainSuffix(domain: string, suffix: string): boolean {
  const d = domain.toLowerCase()
  const s = suffix.toLowerCase()
  return d === s || d.endsWith(`.${s}`)
}

/** True when `domain` exactly matches, or is a subdomain of, any entry in `list`. */
function matchesAnySuffix(domain: string, list: readonly string[]): boolean {
  return list.some((suffix) => matchesDomainSuffix(domain, suffix))
}

// ---------------------------------------------------------------------------
// Raw IP detection
// ---------------------------------------------------------------------------

/** Matches an IPv4 address, optionally followed by ":<port>". */
const IPV4_WITH_OPTIONAL_PORT_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/

/** Private / link-local IPv4 ranges — local device chatter, not real "visited" signal. */
function isPrivateRangeIPv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16
  return false
}

interface IPv4Match {
  isIPv4: boolean
  isPrivate: boolean
}

/** Parses `domain` as an IPv4 address (optionally with :port). Not an IP → isIPv4: false. */
function parseIPv4(domain: string): IPv4Match {
  const match = IPV4_WITH_OPTIONAL_PORT_RE.exec(domain.trim())
  if (!match) return { isIPv4: false, isPrivate: false }
  const octets = [match[1], match[2], match[3], match[4]].map((n) => Number(n))
  if (octets.some((n) => n > 255)) return { isIPv4: false, isPrivate: false }
  return { isIPv4: true, isPrivate: isPrivateRangeIPv4(octets) }
}

// ---------------------------------------------------------------------------
// classifyNetworkActivity
// ---------------------------------------------------------------------------

/**
 * Classify a network activity row's domain into one of three categories:
 * - "system_noise" — automated background traffic (cert checks, OS pings,
 *   update infra, or a private-range raw IP). Hidden from the default view.
 * - "review"       — a public raw IP, or a known tunneling/proxy service.
 *   Shown by default, but visually flagged as worth a second look.
 * - "normal"       — everything else: real signal, actual sites/apps visited.
 */
export function classifyNetworkActivity(domain: string): NetworkActivityCategory {
  const value = (domain || "").trim()
  if (!value) return "normal"

  const ip = parseIPv4(value)
  if (ip.isIPv4) return ip.isPrivate ? "system_noise" : "review"

  if (matchesAnySuffix(value, SYSTEM_NOISE_DOMAINS)) return "system_noise"
  if (matchesAnySuffix(value, TUNNELING_PROXY_DOMAINS)) return "review"

  return "normal"
}

// ---------------------------------------------------------------------------
// UI/export label helpers
// ---------------------------------------------------------------------------

export const NETWORK_ACTIVITY_CATEGORY_LABELS: Record<NetworkActivityCategory, string> = {
  normal: "Normal",
  review: "Review",
  system_noise: "System",
}

export function networkActivityCategoryLabel(category: NetworkActivityCategory): string {
  return NETWORK_ACTIVITY_CATEGORY_LABELS[category]
}
