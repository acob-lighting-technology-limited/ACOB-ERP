import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { distanceMetres } from "@/lib/hr/attendance-utils"

export const dynamic = "force-dynamic"

type SiteRow = {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_metres: number
}

/**
 * GET /api/hr/attendance/sites/nearest?lat=X&lng=Y
 * Returns the nearest active site if the employee is within its radius.
 * Used by the remote check-in modal to display site name UI feedback.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const lat = parseFloat(request.nextUrl.searchParams.get("lat") ?? "")
  const lng = parseFloat(request.nextUrl.searchParams.get("lng") ?? "")
  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ site_name: null })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data: sites } = await dataClient
    .from("attendance_sites")
    .select("id, name, latitude, longitude, radius_metres")
    .eq("is_active", true)
    .returns<SiteRow[]>()

  let closestSite: SiteRow | null = null
  let closestDist = Infinity
  for (const site of sites ?? []) {
    const dist = distanceMetres(lat, lng, Number(site.latitude), Number(site.longitude))
    if (dist <= site.radius_metres && dist < closestDist) {
      closestDist = dist
      closestSite = site
    }
  }

  return NextResponse.json({ site_name: closestSite?.name ?? null })
}
