import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { z } from "zod"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const UpdateProfileSchema = z.object({
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  other_names: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  designation: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  additional_phone: z.string().nullable().optional(),
  residential_address: z.string().nullable().optional(),
  office_location: z.string().nullable().optional(),
  bank_name: z.string().nullable().optional(),
  bank_account_number: z.string().nullable().optional(),
  bank_account_name: z.string().nullable().optional(),
  date_of_birth: z.string().nullable().optional(),
  employment_date: z.string().nullable().optional(),
})

export async function PATCH(request: Request) {
  const rl = await rateLimit(`profile-update:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const body = await request.json()
    const parsed = UpdateProfileSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }
    const data = parsed.data
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const payload = {
      id: user.id,
      first_name: data.first_name ?? null,
      last_name: data.last_name ?? null,
      other_names: data.other_names ?? null,
      department: data.department ?? null,
      designation: data.designation ?? null,
      phone_number: data.phone_number ?? null,
      additional_phone: data.additional_phone ?? null,
      residential_address: data.residential_address ?? null,
      office_location: data.office_location ?? null,
      bank_name: data.bank_name ?? null,
      bank_account_number: data.bank_account_number ?? null,
      bank_account_name: data.bank_account_name ?? null,
      date_of_birth: data.date_of_birth ?? null,
      employment_date: data.employment_date ?? null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "update",
        entityType: "profile",
        entityId: user.id,
        newValues: payload,
        context: { actorId: user.id, source: "api", route: "/api/profile/update" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST kept for backwards compat — prefer PATCH
export async function POST(request: Request) {
  const rl = await rateLimit(`profile-update:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  return PATCH(request)
}
