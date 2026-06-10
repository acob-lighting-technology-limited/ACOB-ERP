import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { normalizeDepartmentName, normalizeDepartmentList } from "@/shared/departments"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"
const log = logger("directory")

// Company directory: contact fields every employee is allowed to see. Deliberately
// excludes sensitive HR data (DOB, salary, employee number, leave, attendance, etc.).
const DIRECTORY_COLUMNS =
  "id, first_name, last_name, full_name, company_email, additional_email, phone_number, additional_phone, department, designation, office_location, is_department_lead, lead_departments, employment_status"

type DirectoryRow = {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  company_email: string | null
  additional_email: string | null
  phone_number: string | null
  additional_phone: string | null
  department: string | null
  designation: string | null
  office_location: string | null
  is_department_lead: boolean | null
  lead_departments: string[] | null
  employment_status: string | null
}

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`directory:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 })

  // Any authenticated employee may view the directory — it is intentionally org-wide.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data, error } = await dataClient
    .from("profiles")
    .select(DIRECTORY_COLUMNS)
    .order("first_name", { ascending: true })

  if (error) {
    log.error({ err: error.message }, "Failed to fetch directory")
    return NextResponse.json({ error: "Failed to load directory" }, { status: 500 })
  }

  // Hide people who have left, and normalise department names so renamed
  // departments (e.g. "Technical Extension" → "Project") show their canonical name.
  const rows = ((data as unknown as DirectoryRow[] | null) ?? [])
    .filter((r) => r.employment_status !== "exited")
    .map((r) => ({
      ...r,
      department: r.department ? normalizeDepartmentName(r.department) : r.department,
      lead_departments: r.lead_departments?.length ? normalizeDepartmentList(r.lead_departments) : r.lead_departments,
    }))

  return NextResponse.json({ data: rows })
}
