/**
 * Lightweight User-Agent parser for the Network Activity table.
 *
 * Deliberately simple regex matching for the common desktop/mobile browsers
 * and OSes we expect to see on the office network — no npm dependency. Falls
 * through to `null`/`null` for anything unrecognized (app-specific UAs like
 * `Mozilla/5.0 (compatible; WAChat/1.2; +http://www.whatsapp.com/contact)`
 * are fine to leave unparsed rather than over-engineered).
 */

export interface ParsedUserAgent {
  browser: string | null
  os: string | null
}

/**
 * Order matters: more specific/derivative browsers must be checked before
 * the engines they're built on (Edge and Opera both include "Chrome" in
 * their UA string; Chrome itself must be checked after both).
 */
function detectBrowser(ua: string): string | null {
  if (/EdgA?\//i.test(ua)) return "Edge"
  if (/OPR\/|Opera\//i.test(ua)) return "Opera"
  if (/Firefox\//i.test(ua)) return "Firefox"
  if (/CriOS\//i.test(ua)) return "Chrome" // Chrome on iOS
  if (/Chrome\//i.test(ua)) return "Chrome"
  if (/FxiOS\//i.test(ua)) return "Firefox" // Firefox on iOS
  if (/Version\/.+Safari\//i.test(ua) || /Safari\//i.test(ua)) return "Safari"
  if (/MSIE |Trident\//i.test(ua)) return "Internet Explorer"
  return null
}

function detectOS(ua: string): string | null {
  if (/Windows NT/i.test(ua)) return "Windows"
  if (/Mac OS X|Macintosh/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return "macOS"
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS"
  if (/Android/i.test(ua)) return "Android"
  if (/Linux/i.test(ua)) return "Linux"
  return null
}

/**
 * Parses a raw User-Agent string into a best-effort `{ browser, os }` pair.
 * Returns `null` for a field (or both) when it can't be recognized — never
 * throws, never guesses beyond the simple regex rules above.
 */
export function parseUserAgent(ua: string | null): ParsedUserAgent {
  if (!ua || !ua.trim()) return { browser: null, os: null }
  return {
    browser: detectBrowser(ua),
    os: detectOS(ua),
  }
}
