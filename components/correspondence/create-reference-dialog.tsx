"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import { Lock, Plus } from "lucide-react"

interface DepartmentCodeOption {
  department_name: string
  department_code: string
}

interface CategoryOption {
  id: string
  name: string
  code: string
}

interface RequesterOption {
  id: string
  full_name: string
}

export interface CreateReferenceForm {
  department_name: string
  recipient_department_name: string
  letter_type: string
  category: string
  custom_category_name: string
  custom_category_code: string
  subject: string
  recipient_name: string
  recipient_code: string
  requester_id: string
  action_required: boolean
  due_date: string
  metadata_text: string
  attachments: File[]
}

interface CreateReferenceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: CreateReferenceForm
  onFormChange: (form: CreateReferenceForm) => void
  onSubmit: (e: React.FormEvent) => void
  isSaving: boolean
  departmentCodes: DepartmentCodeOption[]
  currentUserId: string
  currentUserName?: string
  mode?: "create" | "edit"
}

const CUSTOM_CATEGORY_SENTINEL = "__custom__"

export function CreateReferenceDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onSubmit,
  isSaving,
  departmentCodes,
  currentUserId,
  currentUserName,
  mode = "create",
}: CreateReferenceDialogProps) {
  const isEditMode = mode === "edit"
  const set = (patch: Partial<CreateReferenceForm>) => onFormChange({ ...form, ...patch })
  const isInternal = (form.letter_type || "external") === "internal"

  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [requesters, setRequesters] = useState<RequesterOption[]>([])
  const [requestersLoading, setRequestersLoading] = useState(false)

  useEffect(() => {
    fetch("/api/correspondence/categories")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setCategories(json.data as CategoryOption[])
      })
      .catch(() => {})
  }, [])

  const options = departmentCodes.map((dept) => ({
    ...dept,
    displayName: dept.department_name,
    displayCode: dept.department_code,
  }))
  const mdDepartment = options.find((dept) => dept.department_code.toUpperCase() === "MD")
  const selectedRequestDepartment = options.find((dept) => dept.department_name === form.department_name) || null

  const isCustomCategory = form.category === CUSTOM_CATEGORY_SENTINEL

  const handleRecipientCodeInput = (value: string) => {
    set({ recipient_code: value.toUpperCase().replace(/[^A-Z0-9\-]/g, "") })
  }

  const handleCustomCategoryCodeInput = (value: string) => {
    set({ custom_category_code: value.toUpperCase().replace(/[^A-Z0-9\-]/g, "") })
  }

  const handleRequesterChange = (requesterId: string) => {
    set({ requester_id: requesterId })
  }

  useEffect(() => {
    if (!isInternal) return
    const nextRecipientDepartmentName = mdDepartment?.department_name || ""
    const nextRecipientCode = mdDepartment?.department_code || ""
    const nextRecipientName = mdDepartment?.department_name || ""

    if (
      form.recipient_department_name !== nextRecipientDepartmentName ||
      form.recipient_code !== nextRecipientCode ||
      form.recipient_name !== nextRecipientName
    ) {
      set({
        recipient_department_name: nextRecipientDepartmentName,
        recipient_code: nextRecipientCode,
        recipient_name: nextRecipientName,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInternal, mdDepartment?.department_name, mdDepartment?.department_code])

  useEffect(() => {
    if (!form.department_name || isEditMode) {
      setRequesters([])
      return
    }

    setRequestersLoading(true)
    fetch(`/api/correspondence/requesters?department_name=${encodeURIComponent(form.department_name)}`)
      .then((r) => r.json())
      .then((json) => {
        const list = (json.data || []) as RequesterOption[]
        const hasCurrentUser = list.some((row) => row.id === currentUserId)
        const merged = hasCurrentUser
          ? list
          : [{ id: currentUserId, full_name: currentUserName || "Current user" }, ...list]
        setRequesters(merged)
        if (!form.requester_id) {
          set({ requester_id: currentUserId })
        }
      })
      .catch(() => {
        setRequesters([{ id: currentUserId, full_name: currentUserName || "Current user" }])
        if (!form.requester_id) {
          set({ requester_id: currentUserId })
        }
      })
      .finally(() => setRequestersLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.department_name, isEditMode, currentUserId, currentUserName])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!isEditMode && (
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Create Reference</span>
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{isEditMode ? "Edit Reference" : "Create Reference"}</DialogTitle>
            {!isEditMode && (
              <ItemInfoButton
                title="Reference workflow guide"
                summary="A reference is a tracked correspondence item. Once submitted it goes straight to the approval chain."
                details={[
                  {
                    label: "What you are creating",
                    value:
                      "This form creates a formal reference number and correspondence record for a letter, approval request, notice, or other tracked document.",
                  },
                  {
                    label: "Reference format",
                    value:
                      "References follow ACOB/{RECIPIENT_DEPT}/{REQUEST_DEPT}/{YEAR}/{NNN}. Internal recipient department is locked from configured department codes.",
                  },
                  {
                    label: "Requested by",
                    value: "Defaults to your account, but can be changed before submit.",
                  },
                ]}
              />
            )}
          </div>
          <DialogDescription>
            {isEditMode
              ? "Update the correspondence details. Department and recipient code cannot be changed."
              : "Fill the correspondence details and submit."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          {/* Letter Type */}
          <div className="space-y-2">
            <Label>Letter Type</Label>
            <Select value={form.letter_type || "external"} onValueChange={(value) => set({ letter_type: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="external">External</SelectItem>
                <SelectItem value="internal">Internal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={form.category || ""}
              onValueChange={(value) => set({ category: value, custom_category_name: "", custom_category_code: "" })}
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.code}>
                    {cat.name}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_CATEGORY_SENTINEL}>Other (custom)…</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isCustomCategory && (
            <div className="space-y-2 md:col-span-2">
              <Label>
                Custom Category Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.custom_category_name}
                onChange={(e) => set({ custom_category_name: e.target.value })}
                placeholder="e.g. Tendering"
                required={isCustomCategory}
              />
            </div>
          )}

          {/* Subject */}
          <div className="space-y-2 md:col-span-2">
            <Label>
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input value={form.subject} onChange={(e) => set({ subject: e.target.value })} required />
          </div>

          {/* Recipient Name */}
          {!isInternal ? (
            <div className="space-y-2">
              <Label>Recipient Name</Label>
              <Input
                value={form.recipient_name}
                onChange={(e) => set({ recipient_name: e.target.value })}
                placeholder="e.g. Abuja Electricity Distribution Company"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>
                Recipient Department <span className="text-destructive">*</span>
              </Label>
              <div className="text-muted-foreground bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Lock className="h-3 w-3 shrink-0" />
                {form.recipient_department_name || "Executive Management"}
              </div>
            </div>
          )}

          {/* Recipient Code */}
          <div className="space-y-2">
            <Label>
              {isInternal ? "Recipient Dept Code" : "Recipient Code"}{" "}
              {!isEditMode && <span className="text-destructive">*</span>}
            </Label>
            {isEditMode || isInternal ? (
              <div className="text-muted-foreground bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Lock className="h-3 w-3 shrink-0" />
                {form.recipient_code || "—"}
              </div>
            ) : (
              <>
                <Input
                  value={form.recipient_code}
                  onChange={(e) => handleRecipientCodeInput(e.target.value)}
                  placeholder="e.g. AEDC"
                  maxLength={12}
                  required
                />
                <p className="text-muted-foreground text-xs">Short code used in the reference number.</p>
              </>
            )}
          </div>

          {/* Request Department */}
          <div className="space-y-2">
            <Label>Request Department {!isEditMode && <span className="text-destructive">*</span>}</Label>
            {isEditMode ? (
              <div className="text-muted-foreground bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Lock className="h-3 w-3 shrink-0" />
                {form.department_name || "—"}
              </div>
            ) : (
              <Select value={form.department_name} onValueChange={(value) => set({ department_name: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((dept) => (
                    <SelectItem key={dept.department_name} value={dept.department_name}>
                      {dept.displayName} ({dept.displayCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label>Request Dept Code</Label>
            <div className="text-muted-foreground bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <Lock className="h-3 w-3 shrink-0" />
              {selectedRequestDepartment?.department_code || "—"}
            </div>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label>
              Due Date <span className="text-destructive">*</span>
            </Label>
            <Input type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} required />
          </div>

          {/* Requested by */}
          {!isEditMode && (
            <div className="space-y-2">
              <Label>Requested by</Label>
              <Select
                value={form.requester_id || currentUserId}
                onValueChange={handleRequesterChange}
                disabled={!form.department_name || requestersLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={requestersLoading ? "Loading..." : "Select requester"} />
                </SelectTrigger>
                <SelectContent>
                  {requesters.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.full_name}
                      {r.id === currentUserId ? " (You)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2 md:col-span-2">
            <Label>Notes (Optional)</Label>
            <Textarea rows={3} value={form.metadata_text} onChange={(e) => set({ metadata_text: e.target.value })} />
          </div>

          {/* Attachments — create mode only */}
          {!isEditMode && (
            <div className="space-y-2 md:col-span-2">
              <Label>Attachments (PDF)</Label>
              <Input
                type="file"
                accept="application/pdf"
                multiple
                onChange={(event) => {
                  set({ attachments: Array.from(event.target.files || []) })
                }}
              />
              <p className="text-muted-foreground text-xs">Attach one or more PDF files.</p>
            </div>
          )}

          <div className="md:col-span-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : isEditMode ? "Save Changes" : "Create Reference"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
