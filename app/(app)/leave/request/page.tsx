"use client"

import { useMemo, useState } from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FormFieldGroup } from "@/components/ui/patterns"
import { toLocalISODate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

type LeaveTypeOption = {
  id: string
  name: string
  max_days?: number | null
  eligibility_status?: "eligible" | "not_eligible" | "missing_evidence"
  eligibility_reason?: string | null
}

async function fetchLeaveTypes(): Promise<LeaveTypeOption[]> {
  const response = await apiFetch("/api/hr/leave/types")
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "Failed to load leave types")
  return payload.data || []
}

async function fetchRelievers(): Promise<{ value: string; label: string }[]> {
  const response = await apiFetch("/api/hr/leave/relievers")
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || "Failed to load relievers")
  return payload.data || []
}

function clampDays(nextValue: number, maxDays?: number | null) {
  const normalized = Number.isFinite(nextValue) && nextValue > 0 ? Math.floor(nextValue) : 1
  if (maxDays && maxDays > 0) {
    return Math.min(normalized, maxDays)
  }
  return normalized
}

export default function LeaveRequestPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    leave_type_id: "",
    start_date: "",
    days_count: 1,
    reliever_identifier: "",
    reason: "",
    handover_note: "",
  })

  const { data: leaveTypes = [], isLoading: loadingTypes } = useQuery({
    queryKey: QUERY_KEYS.leaveTypes(),
    queryFn: fetchLeaveTypes,
  })

  const { data: relieverOptions = [] } = useQuery({
    queryKey: ["leave-relievers"],
    queryFn: fetchRelievers,
  })

  const selectedLeaveType = useMemo(
    () => leaveTypes.find((leaveType) => leaveType.id === formData.leave_type_id),
    [leaveTypes, formData.leave_type_id]
  )
  const allowedDays = selectedLeaveType?.max_days || undefined

  const previewEnd = (() => {
    if (!formData.start_date || !formData.days_count) return ""
    const end = new Date(`${formData.start_date}T00:00:00.000Z`)
    end.setUTCDate(end.getUTCDate() + Number(formData.days_count) - 1)
    return toLocalISODate(end)
  })()

  const previewResume = (() => {
    if (!previewEnd) return ""
    const resume = new Date(`${previewEnd}T00:00:00.000Z`)
    resume.setUTCDate(resume.getUTCDate() + 1)
    return toLocalISODate(resume)
  })()

  const { mutate: submitRequest, isPending: loading } = useMutation({
    mutationFn: async (body: typeof formData) => {
      const response = await apiFetch("/api/hr/leave/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to submit leave request")
      return payload
    },
    onSuccess: () => {
      toast.success("Leave request submitted")
      router.push("/leave")
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "An error occurred")
    },
  })

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    submitRequest(formData)
  }

  return (
    <PageWrapper maxWidth="form">
      <PageHeader
        title="Submit Leave Request"
        description="Reliever approval is required before supervisor and HR review."
        backLink={{ href: "/leave", label: "Back to leave management" }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Leave Request Form</CardTitle>
          <CardDescription>Provide all required details so your approval flow can start immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <FormFieldGroup label="Leave Type">
              <Select
                value={formData.leave_type_id}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    leave_type_id: value,
                    days_count: clampDays(
                      prev.days_count,
                      leaveTypes.find((leaveType) => leaveType.id === value)?.max_days
                    ),
                  }))
                }
                disabled={loadingTypes}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingTypes ? "Loading leave types..." : "Select leave type"} />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((leaveType) => (
                    <SelectItem
                      key={leaveType.id}
                      value={leaveType.id}
                      disabled={leaveType.eligibility_status === "not_eligible"}
                    >
                      {leaveType.name}
                      {leaveType.max_days ? ` (${leaveType.max_days} days)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedLeaveType?.max_days ? (
                <p className="text-muted-foreground text-xs">
                  Maximum allowed for this leave: {selectedLeaveType.max_days} day(s)
                </p>
              ) : null}
              {selectedLeaveType?.eligibility_reason && (
                <p className="text-muted-foreground text-xs">{selectedLeaveType.eligibility_reason}</p>
              )}
            </FormFieldGroup>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormFieldGroup label="Start Date">
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData((prev) => ({ ...prev, start_date: e.target.value }))}
                />
              </FormFieldGroup>
              <FormFieldGroup label="Days">
                <Input
                  type="number"
                  min={1}
                  max={allowedDays}
                  value={formData.days_count}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      days_count: clampDays(Number(e.target.value || 1), allowedDays),
                    }))
                  }
                />
              </FormFieldGroup>
            </div>

            <div className="rounded border p-3 text-sm">
              <p>Computed End Date: {previewEnd || "-"}</p>
              <p>Computed Resume Date: {previewResume || "-"}</p>
            </div>

            <FormFieldGroup label="Reliever">
              <SearchableSelect
                value={formData.reliever_identifier}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, reliever_identifier: value }))}
                options={relieverOptions}
                placeholder="Select reliever from your department"
                searchPlaceholder="Search your department..."
              />
            </FormFieldGroup>

            <FormFieldGroup label="Reason">
              <Textarea
                value={formData.reason}
                onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
                rows={3}
              />
            </FormFieldGroup>

            <FormFieldGroup label="Handover Note">
              <Textarea
                value={formData.handover_note}
                onChange={(e) => setFormData((prev) => ({ ...prev, handover_note: e.target.value }))}
                rows={3}
              />
            </FormFieldGroup>

            <Button type="submit" disabled={loading || loadingTypes}>
              {loading ? "Submitting..." : "Submit"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </PageWrapper>
  )
}
