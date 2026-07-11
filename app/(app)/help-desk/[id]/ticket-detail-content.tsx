"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { formatWATDateTime } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

type Ticket = {
  id: string
  ticket_number: string
  title: string
  description?: string | null
  status: string
  priority: string
  service_department?: string | null
  category?: string | null
  sla_target_at?: string | null
  created_at?: string | null
  requester_id?: string | null
  assigned_to?: string | null
  requester_name?: string | null
  assigned_to_name?: string | null
  csat_rating?: number | null
  csat_feedback?: string | null
}

export function TicketDetailContent({
  ticket,
  viewerId,
  canRate,
  events,
  approvals,
  comments,
}: {
  ticket: Ticket | null
  viewerId: string
  canRate: boolean
  events: Array<{
    id: string
    event_type?: string | null
    old_status?: string | null
    new_status?: string | null
    created_at?: string | null
  }>
  approvals: Array<{ id: string; approval_stage?: string | null; status?: string | null; requested_at?: string | null }>
  comments: Array<{ id: string; comment?: string | null; body?: string | null; created_at?: string | null }>
}) {
  const [newComment, setNewComment] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [rating, setRating] = useState(ticket?.csat_rating ? String(ticket.csat_rating) : "")
  const [feedback, setFeedback] = useState(ticket?.csat_feedback || "")
  const [isSubmittingRating, setIsSubmittingRating] = useState(false)

  async function addComment() {
    if (!ticket || !newComment.trim()) return
    setIsSaving(true)
    try {
      const response = await apiFetch(`/api/help-desk/tickets/${ticket.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: newComment }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to add comment")
      toast.success("Comment added")
      window.location.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add comment")
    } finally {
      setIsSaving(false)
    }
  }

  async function submitRating() {
    if (!ticket || !rating) return
    setIsSubmittingRating(true)
    try {
      const response = await apiFetch(`/api/help-desk/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csat_rating: Number(rating),
          csat_feedback: feedback.trim() || null,
        }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to submit rating")
      toast.success("Thanks for your feedback")
      window.location.reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit rating")
    } finally {
      setIsSubmittingRating(false)
    }
  }

  if (!ticket) return <div className="p-6">Ticket not found.</div>

  const slaRemaining = ticket.sla_target_at ? new Date(ticket.sla_target_at).getTime() - Date.now() : null

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="space-y-2">
        <Link href="/help-desk" className="text-sm text-slate-500 hover:underline">
          Back to Help Desk
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-sm font-semibold">{ticket.ticket_number}</div>
          <Badge>{ticket.status.replaceAll("_", " ")}</Badge>
          <Badge variant="outline">{ticket.priority}</Badge>
        </div>
        <h1 className="text-3xl font-bold">{ticket.title}</h1>
        {slaRemaining !== null ? (
          <div className={`text-sm ${slaRemaining < 0 ? "text-red-600" : "text-slate-500"}`}>
            SLA {slaRemaining < 0 ? "breached" : "remaining"} {Math.abs(Math.round(slaRemaining / (1000 * 60 * 60)))}h
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>{ticket.description || "No description provided."}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {events.map((event) => (
                <div key={event.id} className="border-b pb-3 last:border-0">
                  <div className="font-medium">{event.event_type?.replaceAll("_", " ") || "Event"}</div>
                  <div className="text-sm text-slate-500">
                    {(event.old_status || "-").replaceAll("_", " ")} to {(event.new_status || "-").replaceAll("_", " ")}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={newComment}
                onChange={(event) => setNewComment(event.target.value)}
                placeholder="Add a comment"
              />
              <Button onClick={addComment} disabled={isSaving || !newComment.trim()}>
                Add Comment
              </Button>
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-lg border p-3">
                  <div>{comment.comment || comment.body || "-"}</div>
                  <div className="text-xs text-slate-500">
                    {comment.created_at ? formatWATDateTime(comment.created_at) : ""}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          {ticket.category?.toLowerCase().includes("procurement") ? (
            <Card>
              <CardHeader>
                <CardTitle>Approval Chain</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {approvals.map((approval) => (
                  <div key={approval.id} className="flex items-center justify-between rounded border p-3">
                    <div>{approval.approval_stage || "Stage"}</div>
                    <Badge variant="outline">{approval.status || "pending"}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Ticket Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>Requester: {ticket.requester_name || (ticket.requester_id === viewerId ? "You" : "-")}</div>
              <div>Assigned To: {ticket.assigned_to_name || (ticket.assigned_to === viewerId ? "You" : "-")}</div>
              <div>Department: {ticket.service_department || "-"}</div>
              <div>Category: {ticket.category || "-"}</div>
              <div>SLA Target: {ticket.sla_target_at ? formatWATDateTime(ticket.sla_target_at) : "-"}</div>
              <div>Created: {ticket.created_at ? formatWATDateTime(ticket.created_at) : "-"}</div>
            </CardContent>
          </Card>
          {canRate ? (
            <Card>
              <CardHeader>
                <CardTitle>Service Rating</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  value={rating}
                  onChange={(event) => setRating(event.target.value)}
                  className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">Select a rating</option>
                  <option value="1">1 - Poor</option>
                  <option value="2">2 - Fair</option>
                  <option value="3">3 - Good</option>
                  <option value="4">4 - Very Good</option>
                  <option value="5">5 - Excellent</option>
                </select>
                <Textarea
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  placeholder="Optional feedback about how the ticket was handled"
                />
                <Button onClick={submitRating} disabled={!rating || isSubmittingRating}>
                  {isSubmittingRating ? "Submitting..." : "Submit Rating"}
                </Button>
              </CardContent>
            </Card>
          ) : ticket.csat_rating ? (
            <Card>
              <CardHeader>
                <CardTitle>Service Rating</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>Rating: {ticket.csat_rating}/5</div>
                {ticket.csat_feedback ? <div>{ticket.csat_feedback}</div> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
