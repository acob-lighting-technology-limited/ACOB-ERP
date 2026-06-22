"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

interface DeleteReportDialogProps {
  pendingDeleteId: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (id: string) => Promise<void>
}

export function DeleteReportDialog({ pendingDeleteId, onOpenChange, onConfirm }: DeleteReportDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  return (
    <AlertDialog
      open={pendingDeleteId !== null}
      onOpenChange={(open) => {
        if (!open && !isDeleting) {
          onOpenChange(false)
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Report</AlertDialogTitle>
          <AlertDialogDescription>Are you sure? This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            loading={isDeleting}
            onClick={async () => {
              if (pendingDeleteId) {
                setIsDeleting(true)
                try {
                  await onConfirm(pendingDeleteId)
                  onOpenChange(false)
                } finally {
                  setIsDeleting(false)
                }
              }
            }}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
