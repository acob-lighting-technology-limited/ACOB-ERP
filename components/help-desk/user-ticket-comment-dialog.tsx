"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/patterns"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import { MessageSquare, Send } from "lucide-react"
import type { HelpDeskTicketDetailResponse } from "@/components/help-desk/help-desk-types"
import { formatWATDateTime } from "@/lib/utils/date"

function formatDateTime(dateString: string | null | undefined) {
  if (!dateString) return "-"
  return formatWATDateTime(dateString)
}

interface UserHelpDeskTicketCommentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: HelpDeskTicketDetailResponse | null
  isLoading: boolean
  loadError: string | null
  onRetry: () => Promise<void>
  newComment: string
  setNewComment: (value: string) => void
  onAddComment: () => Promise<void>
  isSaving: boolean
  feedbackMessage: string | null
  feedbackTone: "success" | "error" | null
  /** Rendered above the comment box — used for the attachments panel. */
  attachmentsSlot?: React.ReactNode
}

export function UserHelpDeskTicketCommentDialog({
  open,
  onOpenChange,
  detail,
  isLoading,
  loadError,
  onRetry,
  newComment,
  setNewComment,
  onAddComment,
  isSaving,
  feedbackMessage,
  feedbackTone,
  attachmentsSlot,
}: UserHelpDeskTicketCommentDialogProps) {
  const ticket = detail?.ticket || null
  const comments = detail?.comments || []

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add Comment"
      description="Post progress notes and updates for this ticket."
      desktopClassName="max-w-xl"
    >
      {isLoading ? (
        <div className="text-muted-foreground py-4 text-sm">Loading ticket comments...</div>
      ) : loadError ? (
        <div className="space-y-3 py-2">
          <p className="text-sm text-red-500">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void onRetry()}>
            Retry
          </Button>
        </div>
      ) : !ticket ? (
        <div className="text-muted-foreground py-4 text-sm">No ticket selected.</div>
      ) : (
        <div className="space-y-3">
          <Card className="border">
            <CardContent className="space-y-1 p-4">
              <div className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
                {ticket.ticket_number}
              </div>
              <div className="text-foreground text-base leading-tight font-semibold">{ticket.title}</div>
            </CardContent>
          </Card>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Comment</h3>
            <Textarea
              value={newComment}
              onChange={(event) => setNewComment(event.target.value)}
              placeholder="Add a comment or progress note..."
              className="min-h-[96px] text-xs"
            />
            <Button
              size="sm"
              onClick={() => void onAddComment()}
              disabled={isSaving || !newComment.trim()}
              loading={isSaving}
              className="gap-2"
            >
              <Send className="h-3.5 w-3.5" />
              Post Comment
            </Button>
            {feedbackMessage && (
              <p
                className={
                  feedbackTone === "error" ? "text-xs text-red-500" : "text-xs text-emerald-600 dark:text-emerald-400"
                }
              >
                {feedbackMessage}
              </p>
            )}
          </section>

          {attachmentsSlot ? <section className="space-y-2">{attachmentsSlot}</section> : null}

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-3.5 w-3.5" />
              Recent Comments
            </h3>
            {comments.length > 0 ? (
              <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                {comments.map((comment) => (
                  <div key={comment.id} className="border-l-2 pl-3">
                    <p className="text-muted-foreground text-xs leading-5">{comment.comment || comment.body || "-"}</p>
                    <p className="text-muted-foreground mt-1 text-[11px]">{formatDateTime(comment.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No comments yet"
                description="Comments will appear here after posting."
                icon={MessageSquare}
                className="border-0 px-0 py-2"
              />
            )}
          </section>
        </div>
      )}
    </ResponsiveModal>
  )
}
