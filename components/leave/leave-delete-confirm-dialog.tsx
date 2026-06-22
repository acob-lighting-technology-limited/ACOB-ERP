"use client"

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
import type { LeaveRequest } from "@/app/(app)/leave/page"

interface LeaveDeleteConfirmDialogProps {
  request: LeaveRequest | null
  onOpenChange: (open: boolean) => void
  onConfirm: (request: LeaveRequest) => Promise<void>
  isDeleting?: boolean
}

export function LeaveDeleteConfirmDialog({
  request,
  onOpenChange,
  onConfirm,
  isDeleting = false,
}: LeaveDeleteConfirmDialogProps) {
  return (
    <AlertDialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open && !isDeleting) onOpenChange(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Leave Request</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this leave request? This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isDeleting || !request}
            loading={isDeleting}
            onClick={() => {
              if (request) {
                void onConfirm(request)
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
