import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { sendExitNotificationEmail } from "@/lib/hr/exit-mailer"
import type { ExitedEmployee } from "@/lib/hr/exit-mailer"
import { ORG_EMAIL_SENDERS } from "@/lib/org-config"
import { logger } from "@/lib/logger"
import { DEPT_ADMIN_HR, isSameDepartment } from "@/shared/departments"

const log = logger("api-bulk-exit")

interface BulkExitEntry {
  employeeId: string
  exitDate: string
  reasonCode: string
  reasonLabel?: string
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase, user.id)
    if (!scope || !canAccessAdminSection(scope, "hr")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await request.json()) as {
      employees: BulkExitEntry[]
      sendNotification: boolean
    }

    const { employees: entries, sendNotification } = body
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: "No employees provided" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const now = new Date().toISOString()

    const results: { id: string; success: boolean; blockers?: unknown; error?: string }[] = []

    for (const entry of entries) {
      // Auto-clear all blockers so exit never silently skips.
      // Each unassignment fires existing DB/email triggers with user.id as actor.
      await Promise.all([
        // Unassign current assets — set assigned_by to the acting admin so the
        // handle_asset_return DB trigger shows the correct "authorized by" in the email.
        dataClient
          .from("asset_assignments")
          .update({ is_current: false, assigned_by: user.id, updated_at: now })
          .eq("assigned_to", entry.employeeId)
          .eq("is_current", true),
        // Clear tasks assigned to this employee
        dataClient
          .from("tasks")
          .update({ assigned_to: null })
          .eq("assigned_to", entry.employeeId)
          .neq("status", "completed"),
        // Remove task assignment rows
        dataClient.from("task_assignments").delete().eq("user_id", entry.employeeId),
        // Remove active project memberships
        dataClient
          .from("project_members")
          .update({ is_active: false })
          .eq("user_id", entry.employeeId)
          .eq("is_active", true),
        // Clear project manager role
        dataClient
          .from("projects")
          .update({ project_manager_id: null })
          .eq("project_manager_id", entry.employeeId)
          .in("status", ["planning", "active", "on_hold"]),
      ])

      const { error: updateError } = await dataClient
        .from("profiles")
        .update({
          employment_status: "exited",
          role: "visitor",
          is_admin: false,
          is_department_lead: false,
          lead_departments: [],
          admin_routes: [],
          separation_date: entry.exitDate || null,
          separation_reason: entry.reasonCode || null,
          status_changed_at: now,
          status_changed_by: user.id,
        })
        .eq("id", entry.employeeId)

      if (updateError) {
        results.push({ id: entry.employeeId, success: false, error: updateError.message })
      } else {
        results.push({ id: entry.employeeId, success: true })
      }
    }

    const succeededIds = results.filter((r) => r.success).map((r) => r.id)
    const failedCount = results.filter((r) => !r.success).length

    // Send combined notification if requested and at least one succeeded
    if (sendNotification && succeededIds.length > 0) {
      const { data: exitedProfiles } = await dataClient
        .from("profiles")
        .select("id, first_name, last_name, department")
        .in("id", succeededIds)

      const exitedEmployees: ExitedEmployee[] = (exitedProfiles || []).map((p) => {
        const entry = entries.find((e) => e.employeeId === p.id)
        return {
          fullName: `${p.first_name} ${p.last_name}`.trim(),
          firstName: p.first_name as string,
          department: (p.department as string) || "N/A",
          exitDate: entry?.exitDate,
        }
      })

      // Dept lead — use first employee's dept if all same, else skip
      const depts = [...new Set(exitedEmployees.map((e) => e.department))]
      let deptLeadEmail: string | undefined
      if (depts.length === 1 && depts[0] !== "N/A") {
        const { data: deptLeads } = await dataClient
          .from("profiles")
          .select("company_email")
          .eq("is_department_lead", true)
          .contains("lead_departments", [depts[0]])
          .eq("employment_status", "active")
          .limit(1)
        deptLeadEmail = deptLeads?.[0]?.company_email ?? undefined
      }

      // Admin and HR lead — also fetch their lead_departments to build the sender display name
      const { data: candidateHrLeads } = await dataClient
        .from("profiles")
        .select("first_name, last_name, designation, company_email, department, lead_departments")
        .eq("is_department_lead", true)
        .eq("employment_status", "active")
      const hrLead = (candidateHrLeads || []).find(
        (p) =>
          isSameDepartment(p.department, DEPT_ADMIN_HR) ||
          (p.lead_departments || []).some((d: string) => isSameDepartment(d, DEPT_ADMIN_HR))
      )
      // Exit notices send under the single org identity like every other
      // automated mail; replies route to the HR mailbox via ORG_MAIL_ROUTING.
      const exitEmailSender = ORG_EMAIL_SENDERS.system

      // All active staff — include additional_email so no one is missed
      const { data: activeStaff } = await dataClient
        .from("profiles")
        .select("id, company_email, additional_email")
        .eq("employment_status", "active")
        .not("company_email", "is", null)

      const recipients = Array.from(
        new Set(
          (activeStaff || []).flatMap((p: { company_email: string | null; additional_email?: string | null }) =>
            [p.company_email, p.additional_email].filter((e): e is string => Boolean(e))
          )
        )
      )

      const staffIds = (activeStaff || []).map((p: { id: string }) => p.id).filter(Boolean)

      if (recipients.length > 0) {
        await sendExitNotificationEmail({
          employees: exitedEmployees,
          recipients,
          deptLeadEmail,
          hrLeadName: hrLead ? `${hrLead.first_name} ${hrLead.last_name}`.trim() : undefined,
          hrLeadDesignation: hrLead?.designation ?? undefined,
          hrLeadEmail: hrLead?.company_email ?? undefined,
          from: exitEmailSender,
        })
      }

      const isBulk = exitedEmployees.length > 1
      const names = exitedEmployees.map((e) => e.fullName).join(", ")

      if (staffIds.length > 0) {
        const rows = staffIds.map((userId: string) => ({
          user_id: userId,
          type: "announcement",
          category: "system",
          priority: "high",
          title: "Staff Exit Notification",
          message: isBulk
            ? `${exitedEmployees.length} staff members have exited ACOB Lighting Technology Limited.`
            : `${exitedEmployees[0].fullName} (${exitedEmployees[0].department}) is no longer a member of staff.`,
          link_url: null as string | null,
        }))
        const { error: notifyError } = await dataClient.from("notifications").insert(rows)
        if (notifyError) {
          log.error({ error: notifyError }, "Failed to insert bulk exit in-app notifications")
        }
      }

      log.info({ names, succeededIds, recipientCount: recipients.length }, "Bulk exit notification sent")
    }

    return NextResponse.json({
      succeeded: succeededIds.length,
      failed: failedCount,
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk exit failed"
    log.error({ error }, "POST bulk-exit failed")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
