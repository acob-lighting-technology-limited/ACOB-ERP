"use client"

import { useState } from "react"
import { formatWATDate, formatWATTime } from "@/lib/utils/date"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trash2, Edit2 } from "lucide-react"
import { toast } from "sonner"
import { FeedbackEditModal } from "./feedback-edit-modal"
import { writeAuditLogClient } from "@/lib/audit/client"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { EditableFeedbackRecord } from "@/components/feedback/types"

interface UserFeedbackListProps {
  feedback: EditableFeedbackRecord[]
}

export function UserFeedbackList({ feedback }: UserFeedbackListProps) {
  const [feedbackList, setFeedbackList] = useState(feedback)
  const [selectedFeedback, setSelectedFeedback] = useState<EditableFeedbackRecord | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [isDeletingFeedback, setIsDeletingFeedback] = useState(false)

  const getTypeColor = (type: string) => {
    switch (type) {
      case "concern":
        return "bg-yellow-100 text-yellow-800"
      case "complaint":
        return "bg-red-100 text-red-800"
      case "suggestion":
        return "bg-blue-100 text-blue-800"
      case "required_item":
        return "bg-purple-100 text-purple-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-green-100 text-green-800"
      case "in_progress":
        return "bg-blue-100 text-blue-800"
      case "resolved":
        return "bg-purple-100 text-purple-800"
      case "closed":
        return "bg-gray-100 text-gray-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const handleDelete = async (id: string) => {
    const supabase = createClient()

    try {
      // Get feedback details before deleting for audit log
      const feedbackToDelete = feedbackList.find((item) => item.id === id)

      const { error } = await supabase.from("feedback").delete().eq("id", id)

      if (error) throw error

      // Log audit
      if (feedbackToDelete) {
        await writeAuditLogClient(
          supabase,
          {
            action: "delete",
            entityType: "feedback",
            entityId: id,
            oldValues: {
              feedback_type: feedbackToDelete.feedback_type,
              title: feedbackToDelete.title,
              description: feedbackToDelete.description,
              status: feedbackToDelete.status,
            },
            context: {
              source: "ui",
              route: "/feedback",
            },
          },
          { failOpen: true }
        )
      }

      setFeedbackList(feedbackList.filter((item) => item.id !== id))
      toast.success("Feedback deleted successfully!")
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete feedback"
      toast.error(message)
    }
  }

  const handleEdit = (item: EditableFeedbackRecord) => {
    setSelectedFeedback(item)
    setShowEditModal(true)
  }

  const handleSaveEdit = (updatedFeedback: EditableFeedbackRecord) => {
    setFeedbackList(feedbackList.map((item) => (item.id === updatedFeedback.id ? updatedFeedback : item)))
    setShowEditModal(false)
    setSelectedFeedback(null)
  }

  if (feedbackList.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Feedback</CardTitle>
          <CardDescription>No feedback submitted yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Submit your first feedback using the form on the left to get started.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your Feedback</CardTitle>
          <CardDescription>Total: {feedbackList.length} items</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {feedbackList.map((item) => (
            <div key={item.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-foreground font-semibold">{item.title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">{item.description}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleEdit(item)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDeleteId(item.id)}
                    aria-label="Delete feedback"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge className={getTypeColor(item.feedback_type)}>{item.feedback_type.replace("_", " ")}</Badge>
                <Badge className={getStatusColor(item.status)}>{item.status.replace("_", " ")}</Badge>
              </div>

              <p className="text-muted-foreground text-xs">
                {formatWATDate(item.created_at)} at {formatWATTime(item.created_at)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {showEditModal && selectedFeedback && (
        <FeedbackEditModal
          feedback={selectedFeedback}
          onClose={() => {
            setShowEditModal(false)
            setSelectedFeedback(null)
          }}
          onSave={handleSaveEdit}
        />
      )}

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingFeedback) setPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feedback</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this feedback? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingFeedback}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isDeletingFeedback}
              onClick={async () => {
                if (pendingDeleteId) {
                  setIsDeletingFeedback(true)
                  try {
                    await handleDelete(pendingDeleteId)
                    setPendingDeleteId(null)
                  } finally {
                    setIsDeletingFeedback(false)
                  }
                }
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
