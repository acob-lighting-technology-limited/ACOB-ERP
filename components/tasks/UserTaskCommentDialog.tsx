"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/patterns"
import { ResponsiveModal } from "@/components/ui/patterns/responsive-modal"
import { MessageSquare, Send } from "lucide-react"
import type { Task } from "@/types/task"
import { formatWATDateTime } from "@/lib/utils/date"

interface TaskUpdate {
  id: string
  content?: string
  update_type: string
  created_at: string
  user?: {
    first_name: string
    last_name: string
  }
}

function formatDateTime(dateString: string) {
  return formatWATDateTime(dateString, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface UserTaskCommentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedTask: Task | null
  taskUpdates: TaskUpdate[]
  newComment: string
  setNewComment: (value: string) => void
  isSaving: boolean
  onAddComment: () => Promise<void>
}

export function UserTaskCommentDialog({
  open,
  onOpenChange,
  selectedTask,
  taskUpdates,
  newComment,
  setNewComment,
  isSaving,
  onAddComment,
}: UserTaskCommentDialogProps) {
  const commentUpdates = taskUpdates.filter((update) => update.update_type === "comment")

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add Comment"
      description="Post progress notes and updates for this task."
      desktopClassName="max-w-xl"
    >
      {selectedTask && (
        <div className="space-y-3">
          <Card className="border">
            <CardContent className="space-y-1 p-4">
              {selectedTask.work_item_number && (
                <div className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">
                  {selectedTask.work_item_number}
                </div>
              )}
              <div className="text-foreground text-base leading-tight font-semibold">{selectedTask.title}</div>
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
            <Button size="sm" onClick={onAddComment} disabled={isSaving || !newComment.trim()} className="gap-2">
              <Send className="h-3.5 w-3.5" />
              Post Comment
            </Button>
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquare className="h-3.5 w-3.5" />
              Recent Comments
            </h3>
            {commentUpdates.length > 0 ? (
              <div className="max-h-52 space-y-3 overflow-y-auto pr-1">
                {commentUpdates.map((update) => (
                  <div key={update.id} className="border-l-2 pl-3">
                    {update.user && (
                      <p className="text-foreground text-xs font-medium">
                        {update.user.first_name} {update.user.last_name}
                      </p>
                    )}
                    <p className="text-muted-foreground text-xs leading-5">{update.content}</p>
                    <p className="text-muted-foreground mt-1 text-[11px]">{formatDateTime(update.created_at)}</p>
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
