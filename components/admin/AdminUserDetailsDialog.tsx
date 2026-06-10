"use client"

import { formatWATDateTime, formatDateOfBirth } from "@/lib/utils/date"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"
import { formatName } from "@/lib/utils"

function properCase(s: string | null | undefined): string {
  if (!s) return ""
  return s
    .toString()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

function getTypeColor(type: string): string {
  switch (type) {
    case "concern":
      return "bg-yellow-500"
    case "complaint":
      return "bg-red-500"
    case "suggestion":
      return "bg-blue-500"
    case "required_item":
      return "bg-purple-500"
    default:
      return "bg-gray-300"
  }
}

interface AdminUserDetailsDialogProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any | null
  open: boolean
  onClose: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  feedbackByUserId: Record<string, any[]>
}

export function AdminUserDetailsDialog({ user, open, onClose, feedbackByUserId }: AdminUserDetailsDialogProps) {
  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Employee Details</DialogTitle>
          <DialogDescription>Full profile and recent feedback</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          {/* Profile card */}
          <div className="rounded-lg border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>First Name</Label>
                <div className="mt-1 font-medium">{formatName(user.first_name)}</div>
              </div>
              <div>
                <Label>Last Name</Label>
                <div className="mt-1 font-medium">{formatName(user.last_name)}</div>
              </div>
              <div className="sm:col-span-2">
                <Label>Email</Label>
                <div className="mt-1 font-medium break-all">{(user.company_email || "").toLowerCase()}</div>
              </div>
              <div>
                <Label>Department</Label>
                <div className="mt-1">{properCase(user.department)}</div>
              </div>
              <div>
                <Label>Phone</Label>
                <div className="mt-1">{user.phone_number}</div>
              </div>
              <div className="sm:col-span-2">
                <Label>Address</Label>
                <div className="mt-1">{properCase(user.residential_address)}</div>
              </div>
              <div>
                <Label>Office Location</Label>
                <div className="mt-1">{properCase(user.office_location)}</div>
              </div>
              <div>
                <Label>Bank</Label>
                <div className="mt-1">
                  {properCase(user.bank_name)} {user.bank_account_number}
                </div>
              </div>
              <div>
                <Label>Account Name</Label>
                <div className="mt-1">{properCase(user.bank_account_name)}</div>
              </div>
              <div>
                <Label>DOB</Label>
                <div className="mt-1">{formatDateOfBirth(user.date_of_birth, user.birthday) || ""}</div>
              </div>
              <div>
                <Label>Employment Date</Label>
                <div className="mt-1">{user.employment_date || ""}</div>
              </div>
            </div>
          </div>

          {/* Feedback card */}
          <div className="rounded-lg border p-4">
            <div className="mb-2 font-semibold">Recent Feedback</div>
            <div className="space-y-2">
              {(feedbackByUserId[user.id] || []).slice(0, 5).map((fb) => (
                <div key={fb.id} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${getTypeColor(fb.feedback_type)}`} />
                    <span className="font-medium">{fb.feedback_type}</span>
                    <span className="text-muted-foreground ml-auto text-xs">{formatWATDateTime(fb.created_at)}</span>
                  </div>
                  <div className="mt-1 font-medium">{fb.title}</div>
                  <div className="text-muted-foreground">{fb.description}</div>
                </div>
              ))}
              {(!feedbackByUserId[user.id] || feedbackByUserId[user.id].length === 0) && (
                <div className="text-muted-foreground text-sm">No feedback yet</div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const lines = [
                  `Name: ${formatName(user.first_name)} ${formatName(user.last_name)}`,
                  `Email: ${(user.company_email || "").toLowerCase()}`,
                  `Department: ${properCase(user.department)}`,
                  `Phone: ${user.phone_number || ""}`,
                  `Address: ${properCase(user.residential_address)}`,
                  `Office Location: ${properCase(user.office_location)}`,
                  `Bank: ${properCase(user.bank_name)} ${user.bank_account_number || ""}`,
                  `Account Name: ${properCase(user.bank_account_name)}`,
                  `DOB: ${formatDateOfBirth(user.date_of_birth, user.birthday) || ""}`,
                  `Employment: ${user.employment_date || ""}`,
                ]
                navigator.clipboard.writeText(lines.join("\n"))
                toast.success("Copied full data")
              }}
            >
              Copy Full Data
            </Button>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
