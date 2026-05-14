import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope, canAccessAdminSection } from "@/lib/admin/rbac"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const ExportSchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  fields: z.array(z.string()).optional(),
  department: z.string().optional(),
})

const SAFE_FIELDS = [
  "employee_number",
  "first_name",
  "last_name",
  "company_email",
  "department",
  "designation",
  "employment_status",
  "office_location",
  "phone_number",
  "employment_date",
]

const SENSITIVE_FIELDS = ["bank_name", "bank_account_number", "bank_account_name"]
type EmployeeExportRow = Record<string, unknown>

async function getDepartmentIdByName(
  departmentName: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data: department } = await supabase.from("departments").select("id").eq("name", departmentName).maybeSingle()
  return department?.id ?? null
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(`admin-employees-export:${getClientId(req)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope || !canAccessAdminSection(scope, "hr")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = ExportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { format, fields, department } = parsed.data
  const requestedFields = fields ?? SAFE_FIELDS
  const hasSensitiveFields = requestedFields.some((field) => SENSITIVE_FIELDS.includes(field))

  if (hasSensitiveFields && scope.role !== "super_admin" && scope.role !== "developer") {
    return NextResponse.json({ error: "Insufficient permissions to export sensitive fields" }, { status: 403 })
  }

  const selectFields = Array.from(new Set([...requestedFields, "department", "department_id"])).join(", ")
  let query = supabase.from("profiles").select(selectFields)

  if (department) {
    const departmentId = await getDepartmentIdByName(department, supabase)
    query = departmentId ? query.eq("department_id", departmentId) : query.eq("department", department)
  } else if (scope.managedDepartmentIds.length > 0) {
    query = query.in("department_id", scope.managedDepartmentIds)
  } else if (scope.managedDepartments.length > 0) {
    query = query.in("department", scope.managedDepartments)
  }

  const { data: employees, error } = await query.order("last_name")

  if (error) {
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 })
  }

  await writeAuditLog(
    supabase,
    {
      action: "export",
      entityType: "employee",
      entityId: "bulk",
      context: {
        actorId: user.id,
        source: "api",
        route: "/api/admin/employees/export",
      },
      newValues: {
        format,
        fields: requestedFields,
        department: department ?? "all",
        record_count: employees?.length ?? 0,
        includes_sensitive: hasSensitiveFields,
      },
      metadata: {
        is_critical: hasSensitiveFields,
      },
    },
    { failOpen: true }
  )

  if (format === "csv") {
    const header = requestedFields.join(",")
    const rows = (employees || []).map((employee) =>
      requestedFields
        .map((field) => {
          const value = (employee as unknown as EmployeeExportRow)[field]
          const str = value == null ? "" : String(value)
          return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str
        })
        .join(",")
    )
    const csv = [header, ...rows].join("\n")

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="employees-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  return NextResponse.json({ data: employees, fields: requestedFields })
}
