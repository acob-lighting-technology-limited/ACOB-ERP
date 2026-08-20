/**
 * Leave attachments are stored in the SharePoint document library, and the
 * stored URL is the SharePoint web URL. Staff have no permissions on that
 * library, so linking it directly lands them on SharePoint's "You need access"
 * page. Route those links through the app instead, which streams the file with
 * the application credentials after checking leave access.
 */

export function isSharePointUrl(url: string | null | undefined): boolean {
  const value = String(url || "").trim()
  if (!value) return false

  try {
    const host = new URL(value).hostname.toLowerCase()
    return host.endsWith("sharepoint.com") || host.endsWith("sharepoint-df.com") || host.endsWith("1drv.ms")
  } catch {
    return false
  }
}

export function leaveHandoverHref(leaveRequestId: string, url: string | null | undefined): string {
  return isSharePointUrl(url) ? `/api/hr/leave/requests/${leaveRequestId}/handover/download` : String(url || "")
}

export function leaveEvidenceHref(evidenceId: string, url: string | null | undefined): string {
  return isSharePointUrl(url) ? `/api/hr/leave/evidence/${evidenceId}/download` : String(url || "")
}
