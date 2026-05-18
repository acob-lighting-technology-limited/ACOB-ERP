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
  currentUserName: string
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

  useEffect(() => {
    if (!form.department_name) {
      setRequesters([])
      set({ requester_id: "" })
      return
    }
    setRequestersLoading(true)
    // Clear requester immediately when department changes
    set({ requester_id: "" })
    fetch(`/api/correspondence/requesters?department_name=${encodeURIComponent(form.department_name)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          const list = json.data as RequesterOption[]
          setRequesters(list)
          // Auto-select current user only if they belong to this department
          const currentUserInDept = list.some((r) => r.id === currentUserId)
          if (currentUserInDept) {
            set({ requester_id: currentUserId })
          }
        }
      })
      .catch(() => {})
      .finally(() => setRequestersLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.department_name])

  const options = departmentCodes.map((dept) => ({
    ...dept,
    displayName: dept.department_name,
    displayCode: dept.department_code,
  }))

  const isCustomCategory = form.category === CUSTOM_CATEGORY_SENTINEL

  const handleRequesterChange = (requesterId: string) => {
    set({ requester_id: requesterId })
  }

  const handleRecipientCodeInput = (value: string) => {
    set({ recipient_code: value.toUpperCase().replace(/[^A-Z0-9\-]/g, "") })
  }

  const handleCustomCategoryCodeInput = (value: string) => {
    set({ custom_category_code: value.toUpperCase().replace(/[^A-Z0-9\-]/g, "") })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!isEditMode && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create Reference
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
                      "References follow the format ACOB/{DEPT}/{RECIPIENT}/{YEAR}/{NNN} — e.g. ACOB/MD/AEDC/2026/001. Category is for classification only and does not appear in the reference number.",
                  },
                  {
                    label: "Requested by",
                    value: "Select the department first, then pick the person who is requesting the letter.",
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
          <div className="space-y-2">
            <Label>Recipient Name</Label>
            <Input
              value={form.recipient_name}
              onChange={(e) => set({ recipient_name: e.target.value })}
              placeholder="e.g. Abuja Electricity Distribution Company"
            />
          </div>

          {/* Recipient Code */}
          <div className="space-y-2">
            <Label>Recipient Code {!isEditMode && <span className="text-destructive">*</span>}</Label>
            {isEditMode ? (
              <div className="text-muted-foreground bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Lock className="h-3 w-3 shrink-0" />
                {form.recipient_code}
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

          {/* Department */}
          <div className="space-y-2">
            <Label>Department {!isEditMode && <span className="text-destructive">*</span>}</Label>
            {isEditMode ? (
              <div className="text-muted-foreground bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Lock className="h-3 w-3 shrink-0" />
                {form.department_name}
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

          {/* Requested by — create mode only */}
          {!isEditMode && (
            <div className="space-y-2">
              <Label>Requested by</Label>
              <Select
                value={form.requester_id || ""}
                onValueChange={handleRequesterChange}
                disabled={!form.department_name || requestersLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={requestersLoading ? "Loading..." : "Select person"} />
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
              <p className="text-muted-foreground text-xs">
                {!form.department_name ? "Select a department first." : "Person who is requesting the letter."}
              </p>
            </div>
          )}

          {/* Due Date */}
          <div className="space-y-2">
            <Label>
              Due Date <span className="text-destructive">*</span>
            </Label>
            <Input type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} required />
          </div>

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
