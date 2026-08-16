import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { logger } from "@/lib/logger"
import { writeAuditLog } from "@/lib/audit/write-audit"
import {
  defaultMonthlyCommunicationAllowance,
  monthlyBaseFromGross,
  monthlyGrossFromBase,
} from "@/lib/hr/payroll-utils"

import { toLocalISODate } from "@/lib/utils/date"

const log = logger("api-admin-payroll-salaries")
export const dynamic = "force-dynamic"

const DEFAULT_MONTHLY_BASE = 195000

export async function GET() {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const db = getServiceRoleClientOrFallback(supabase)

    const [{ data: profiles, error: profErr }, { data: salaries, error: salErr }] = await Promise.all([
      db
        .from("profiles")
        .select("id, full_name, employee_number, department, is_department_lead, employment_status")
        .eq("employment_status", "active")
        .order("full_name", { ascending: true }),
      db.from("employee_salaries").select("*").eq("is_active", true),
    ])

    if (profErr || salErr) {
      log.error({ profErr: String(profErr), salErr: String(salErr) }, "Failed to fetch employee salaries")
      return NextResponse.json({ error: "Failed to fetch employee salaries" }, { status: 500 })
    }

    const salaryMap = new Map<string, any>((salaries || []).map((s: any) => [s.user_id, s]))

    const result = (profiles || []).map((p: any) => {
      const sal = salaryMap.get(p.id)
      const isLead = Boolean(p.is_department_lead)
      const basicSalary = sal ? Number(sal.basic_salary) : DEFAULT_MONTHLY_BASE
      return {
        user_id: p.id,
        full_name: p.full_name || "Unknown Employee",
        employee_number: p.employee_number || "N/A",
        department: p.department || "General",
        is_department_lead: isLead,
        // Base salary is the stored contract value (SSOT); gross is the same
        // relationship calculatePayroll() derives internally — see
        // lib/hr/payroll-utils.ts. Admins manage gross; base is derived from it.
        // Leads get a higher communication allowance, so their gross-to-base
        // gap is wider than a regular employee's.
        basic_salary: basicSalary,
        gross_salary: monthlyGrossFromBase(basicSalary, defaultMonthlyCommunicationAllowance(isLead) * 12),
        effective_from: sal?.effective_from || null,
        salary_id: sal?.id || null,
      }
    })

    return NextResponse.json({ data: result })
  } catch (err) {
    log.error({ err: String(err) }, "Unexpected error in GET /api/admin/payroll/salaries")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

async function saveOneSalary(
  db: any,
  userId: string,
  grossSalary: number,
  effectiveFrom: string,
  actorId: string,
  isDepartmentLead: boolean
): Promise<{ ok: true; basic_salary: number } | { ok: false; error: string }> {
  const basicSalary = monthlyBaseFromGross(grossSalary, defaultMonthlyCommunicationAllowance(isDepartmentLead) * 12)
  if (!Number.isFinite(basicSalary) || basicSalary <= 0) {
    return { ok: false, error: "Gross salary must be large enough to cover the communication allowance" }
  }

  // Deactivate previous active salary record for this user, then insert the new one.
  await db.from("employee_salaries").update({ is_active: false }).eq("user_id", userId)

  const { data: newSalary, error: insertErr } = await db
    .from("employee_salaries")
    .insert({
      user_id: userId,
      basic_salary: basicSalary,
      effective_from: effectiveFrom,
      is_active: true,
    })
    .select()
    .single()

  if (insertErr) {
    log.error({ err: String(insertErr), userId }, "Failed to insert employee salary")
    return { ok: false, error: "Failed to save employee salary" }
  }

  await writeAuditLog(
    db,
    {
      action: "update",
      entityType: "employee_salaries",
      entityId: newSalary.id,
      newValues: { basic_salary: basicSalary, gross_salary: grossSalary, effective_from: effectiveFrom },
      context: { actorId, source: "api", route: "/api/admin/payroll/salaries" },
    },
    { failOpen: true }
  )

  return { ok: true, basic_salary: basicSalary }
}

/**
 * Accepts either a single update `{ user_id, gross_salary, effective_from? }`
 * or a bulk `{ updates: [...] }` — the salary-management dialog only ever
 * submits rows the admin actually changed, so an unmodified employee never
 * gets a spurious new effective_from row.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const scope = await getRequestScope()
    if (!scope?.isAdminLike) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const db = getServiceRoleClientOrFallback(supabase)
    const today = toLocalISODate(new Date())

    if (Array.isArray(body?.updates)) {
      const updates = body.updates as Array<{ user_id: string; gross_salary: number; effective_from?: string }>
      if (updates.length === 0) {
        return NextResponse.json({ error: "No updates provided" }, { status: 400 })
      }

      const userIds = updates.map((u) => u.user_id).filter(Boolean)
      const { data: leadRows } = await db.from("profiles").select("id, is_department_lead").in("id", userIds)
      const leadMap = new Map<string, boolean>((leadRows || []).map((p: any) => [p.id, Boolean(p.is_department_lead)]))

      const results: Array<{ user_id: string; basic_salary?: number; error?: string }> = []
      for (const u of updates) {
        if (!u.user_id || typeof u.user_id !== "string") {
          results.push({ user_id: u.user_id, error: "Invalid user_id" })
          continue
        }
        const gross = Number(u.gross_salary)
        if (!Number.isFinite(gross) || gross <= 0) {
          results.push({ user_id: u.user_id, error: "Gross salary must be greater than 0" })
          continue
        }
        const saved = await saveOneSalary(
          db,
          u.user_id,
          gross,
          u.effective_from || today,
          scope.userId,
          leadMap.get(u.user_id) ?? false
        )
        results.push(
          saved.ok
            ? { user_id: u.user_id, basic_salary: saved.basic_salary }
            : { user_id: u.user_id, error: saved.error }
        )
      }

      const failures = results.filter((r) => r.error)
      return NextResponse.json({
        success: failures.length === 0,
        updated: results.length - failures.length,
        results,
      })
    }

    const { user_id, gross_salary, effective_from } = body
    if (!user_id || typeof user_id !== "string") {
      return NextResponse.json({ error: "Invalid user_id" }, { status: 400 })
    }
    const gross = Number(gross_salary)
    if (!Number.isFinite(gross) || gross <= 0) {
      return NextResponse.json({ error: "Gross salary must be greater than 0" }, { status: 400 })
    }

    const { data: profileRow } = await db.from("profiles").select("is_department_lead").eq("id", user_id).single()
    const saved = await saveOneSalary(
      db,
      user_id,
      gross,
      effective_from || today,
      scope.userId,
      Boolean(profileRow?.is_department_lead)
    )
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: { user_id, basic_salary: saved.basic_salary } })
  } catch (err) {
    log.error({ err: String(err) }, "Unexpected error in POST /api/admin/payroll/salaries")
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
