import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { TicketDetailContent } from "./ticket-detail-content"

export default async function HelpDeskTicketPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/auth/login")

  const [ticketResult, commentsResult] = await Promise.all([
    supabase.from("help_desk_tickets").select("*").eq("id", params.id).maybeSingle(),
    supabase.from("help_desk_comments").select("*").eq("ticket_id", params.id).order("created_at", { ascending: true }),
  ])

  const [eventsResult, approvalsResult] = ticketResult.data
    ? await Promise.all([
        supabase
          .from("help_desk_events")
          .select("*")
          .eq("ticket_id", params.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("help_desk_approvals")
          .select("*")
          .eq("ticket_id", params.id)
          .order("requested_at", { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }]

  const ticket = ticketResult.data

  if (!ticket) {
    redirect("/help-desk")
  }

  // User portal: only personal access (requester or assignee).
  // Admins/leads use /admin/help-desk to see tickets outside their personal scope.
  const canView = ticket.requester_id === user.id || ticket.assigned_to === user.id

  if (!canView) {
    redirect("/help-desk")
  }

  return (
    <TicketDetailContent
      ticket={ticket}
      viewerId={user.id}
      canRate={ticket.requester_id === user.id && ["resolved", "closed"].includes(String(ticket.status))}
      events={eventsResult.data || []}
      approvals={approvalsResult.data || []}
      comments={commentsResult.data || []}
    />
  )
}
