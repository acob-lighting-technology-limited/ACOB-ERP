import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"

export const dynamic = "force-dynamic"

const LocationSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().min(1),
  department: z.string().trim().optional().nullable(),
  description: z.string().trim().optional().nullable(),
  is_active: z.boolean(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike || scope.scopeMode === "lead") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const parsed = LocationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { name, type, department, description, is_active } = parsed.data

  const { data: updatedRows, error } = await db
    .from("office_locations")
    .update({
      name: name.trim(),
      type,
      department: department || null,
      description: description || null,
      is_active,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: "Update was blocked by a database policy. Check office location permissions." },
      { status: 409 }
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike || scope.scopeMode === "lead") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const db = getServiceRoleClientOrFallback(supabase)

  // Fetch the location first to get its name
  const { data: location, error: fetchError } = await db
    .from("office_locations")
    .select("id, name")
    .eq("id", id)
    .single()

  if (fetchError || !location) {
    return NextResponse.json({ error: "Office location not found" }, { status: 404 })
  }

  // Check if active employees are assigned to this location
  const { data: assignedProfiles, error: profilesError } = await db
    .from("profiles")
    .select("id, first_name, last_name, company_email, employment_status")
    .eq("office_location", location.name)

  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 })

  const activeAssigned = (assignedProfiles ?? []).filter((p) =>
    isAssignableEmploymentStatus(p.employment_status, { allowLegacyNullStatus: false })
  )

  if (activeAssigned.length > 0) {
    const names = activeAssigned
      .map((p) => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(" ")
        return name ? `${name} (${p.company_email || "no email"})` : p.company_email || "Unknown employee"
      })
      .slice(0, 3)
      .join(", ")
    const more = activeAssigned.length > 3 ? ` and ${activeAssigned.length - 3} other(s)` : ""

    return NextResponse.json(
      {
        error: `Cannot delete office location while ${activeAssigned.length} active employee${activeAssigned.length > 1 ? "s are" : " is"} assigned: ${names}${more}. Please reassign them under HR > Employees first.`,
      },
      { status: 409 }
    )
  }

  // Check if any active assets are assigned to this office location
  const { count: assetCount, error: assetsError } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("office_location", location.name)
    .eq("status", "assigned")

  if (assetsError) return NextResponse.json({ error: assetsError.message }, { status: 500 })

  if ((assetCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete office location while ${assetCount} active asset${(assetCount ?? 0) > 1 ? "s are" : " is"} assigned to it. Please reassign or return the assets first.`,
      },
      { status: 409 }
    )
  }

  const { error: deleteError } = await db.from("office_locations").delete().eq("id", id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
