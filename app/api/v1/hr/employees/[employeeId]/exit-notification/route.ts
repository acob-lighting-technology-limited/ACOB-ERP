import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { sendExitNotificationEmail } from "@/lib/hr/exit-mailer"
import { logger } from "@/lib/logger"
import { DEPT_ADMIN_HR, isSameDepartment } from "@/shared/departments"

const log = logger("api-exit-notification")

type RouteContext = { params: Promise<{ employeeId: string }> }

export async function POST(_: Request, { params }: RouteContext) {
  const { employeeId } = await params
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

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const { data: employee } = await dataClient
      .from("profiles")
      .select("first_name, last_name, department, company_email")
      .eq("id", employeeId)
      .single()

    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 })

    const fullName = `${employee.first_name} ${employee.last_name}`.trim()
    const firstName = (employee.first_name as string) || fullName
    const department = (employee.department as string) || "N/A"

    // Dept lead for HOD mailto link
    let deptLeadEmail: string | undefined
    if (department && department !== "N/A") {
      const { data: deptLeads } = await dataClient
        .from("profiles")
        .select("company_email, department, lead_departments")
        .eq("is_department_lead", true)
        .eq("employment_status", "active")
      const matchedDeptLead = (deptLeads || []).find(
        (p) =>
          isSameDepartment(p.department, department) ||
          (p.lead_departments || []).some((d: string) => isSameDepartment(d, department))
      )
      deptLeadEmail = matchedDeptLead?.company_email ?? undefined
    }

    // Admin and HR lead for mailto link + "Prepared by" footer
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

    // All active staff — emails for email blast, ids for in-app
    const { data: activeStaff } = await dataClient
      .from("profiles")
      .select("id, company_email")
      .eq("employment_status", "active")
      .not("company_email", "is", null)

    const recipients = (activeStaff || [])
      .map((p: { company_email: string | null }) => p.company_email)
      .filter((e): e is string => Boolean(e))

    const staffIds = (activeStaff || []).map((p: { id: string }) => p.id).filter(Boolean)

    if (recipients.length > 0) {
      await sendExitNotificationEmail({
        employees: [{ fullName, firstName, department }],
        recipients,
        deptLeadEmail,
        hrLeadName: hrLead ? `${hrLead.first_name} ${hrLead.last_name}`.trim() : undefined,
        hrLeadDesignation: hrLead?.designation ?? undefined,
        hrLeadEmail: hrLead?.company_email ?? undefined,
      })
    }

    // In-app notifications for all active staff
    if (staffIds.length > 0) {
      const rows = staffIds.map((userId: string) => ({
        user_id: userId,
        type: "announcement",
        category: "system",
        priority: "high",
        title: "Staff Exit Notification",
        message: `${fullName} (${department}) is no longer a member of staff of ACOB Lighting Technology Limited.`,
        link_url: null as string | null,
      }))
      const { error: notifyError } = await dataClient.from("notifications").insert(rows)
      if (notifyError) {
        log.error({ error: notifyError }, "Failed to insert exit in-app notifications")
      }
    }

    log.info(
      { employeeId, fullName, emailCount: recipients.length, inAppCount: staffIds.length },
      "Exit notification dispatched"
    )
    return NextResponse.json({ sent: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send notification"
    log.error({ error, employeeId }, "POST exit-notification failed")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
