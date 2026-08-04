import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

const SupplierSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  contact_person: z.string().trim().optional().nullable(),
  is_active: z.boolean(),
})

// `?options=1` returns a lightweight active-suppliers list for the PO form dialog.
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getServiceRoleClientOrFallback(supabase)
  const options = request.nextUrl.searchParams.get("options") === "1"

  if (options) {
    const { data, error } = await db.from("suppliers").select("id, name, code").eq("is_active", true).order("name")
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data ?? [] })
  }

  const { data, error } = await db.from("suppliers").select("*").order("name")
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ data: [] })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const parsed = SupplierSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 })
  }
  const db = getServiceRoleClientOrFallback(supabase)
  const { name, code, email, phone, address, contact_person, is_active } = parsed.data
  const { error } = await db.from("suppliers").insert({
    name,
    code,
    email: email || null,
    phone: phone || null,
    address: address || null,
    contact_person: contact_person || null,
    is_active,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
