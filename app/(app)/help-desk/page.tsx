import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { HelpDeskContent } from "./help-desk-content"
import type { HelpDeskTicket } from "@/components/help-desk/help-desk-types"

import { logger } from "@/lib/logger"

const log = logger("dashboard-help-desk")

type DepartmentRow = {
  name: string | null
}

type CommentCountRow = {
  ticket_id: string | null
}

type HelpDeskPageData =
  | {
      redirectTo: "/auth/login"
    }
  | {
      userId: string
      userDepartment: string | null
      canReviewPendingApprovals: boolean
      initialDepartments: string[]
      tickets: HelpDeskTicket[]
      loadError: string | null
    }

async function getData() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { redirectTo: "/auth/login" as const }
  }

  const { data: profile } = await dataClient
    .from("profiles")
    .select("department, is_department_lead, role")
    .eq("id", user.id)
    .maybeSingle()

  // User portal: only personal tickets (requester, assignee, or created_by).
  // Admins and leads use /admin/help-desk to see scoped admin data and queue/department tickets.
  const { data: personalTickets, error: personalError } = await dataClient
    .from("help_desk_tickets")
    .select("*")
    .or(`requester_id.eq.${user.id},assigned_to.eq.${user.id},created_by.eq.${user.id}`)
    .order("created_at", { ascending: false })

  const departmentError = null
  const mergedTickets = Array.from(
    new Map((personalTickets || []).map((ticket) => [ticket.id, ticket])).values()
  ) as HelpDeskTicket[]

  const goalIds = Array.from(
    new Set(
      mergedTickets
        .map((ticket) => String((ticket as { goal_id?: string | null }).goal_id || "").trim())
        .filter(Boolean)
    )
  )
  const { data: goalsData } =
    goalIds.length > 0
      ? await dataClient.from("goals_objectives").select("id, title").in("id", goalIds)
      : { data: [] as Array<{ id: string; title: string }> }
  const goalTitleById = new Map(
    ((goalsData as Array<{ id: string; title: string }> | null) || []).map((goal) => [goal.id, goal.title])
  )

  const ticketIds = mergedTickets.map((ticket) => ticket.id)
  const { data: commentRows } =
    ticketIds.length > 0
      ? await dataClient.from("help_desk_comments").select("ticket_id").in("ticket_id", ticketIds)
      : { data: [] }
  const commentCountMap = new Map<string, number>()
  for (const row of (commentRows as CommentCountRow[] | null) || []) {
    const ticketId = String(row.ticket_id || "")
    if (!ticketId) continue
    commentCountMap.set(ticketId, (commentCountMap.get(ticketId) || 0) + 1)
  }

  const { data: departmentRows } = await dataClient
    .from("departments")
    .select("name")
    .eq("is_active", true)
    .order("name", { ascending: true })

  if (personalError || departmentError) {
    log.error("Error loading help desk tickets:", personalError || departmentError)
  }

  return {
    userId: user.id,
    userDepartment: profile?.department || null,
    canReviewPendingApprovals: Boolean(
      profile?.is_department_lead || ["developer", "admin", "super_admin"].includes(String(profile?.role || ""))
    ),
    initialDepartments: ((departmentRows as DepartmentRow[] | null) || [])
      .map((row) => String(row.name || "").trim())
      .filter(Boolean),
    tickets: mergedTickets.map((ticket) => ({
      ...ticket,
      comment_count: commentCountMap.get(ticket.id) || 0,
      goal_title: (ticket as { goal_id?: string | null }).goal_id
        ? goalTitleById.get(String((ticket as { goal_id?: string | null }).goal_id || "")) || null
        : null,
    })),
    loadError:
      personalError || departmentError
        ? `Failed to load help desk tickets: ${(personalError || departmentError)?.message}`
        : null,
  } satisfies HelpDeskPageData
}

export default async function PortalHelpDeskPage() {
  const data = (await getData()) as HelpDeskPageData

  if ("redirectTo" in data) {
    redirect(data.redirectTo || "/auth/login")
  }

  return (
    <HelpDeskContent
      userId={data.userId}
      userDepartment={data.userDepartment}
      canReviewPendingApprovals={data.canReviewPendingApprovals}
      initialDepartments={data.initialDepartments || []}
      initialTickets={data.tickets}
      initialError={data.loadError}
    />
  )
}
