"use client"

import { useMemo, useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { PageLoader, QueryError } from "@/components/ui/query-states"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"

type PolicyRow = {
  notification_key: string
  in_app_enabled: boolean
  email_enabled: boolean
  in_app_mandatory: boolean
  email_mandatory: boolean
  updated_by?: string | null
  updated_at?: string | null
}

const MODULE_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  help_desk: "Help Desk",
  leave: "Leave",
  assets: "Assets",
  meetings: "Meetings",
  communications: "Communications",
  reports: "Reports",
  system: "System",
}

async function fetchMailPolicies(): Promise<PolicyRow[]> {
  const response = await apiFetch("/api/admin/settings/mail", { cache: "no-store" })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || "Failed to load mail policies")
  return Array.isArray(payload.policies)
    ? payload.policies.map((row: Partial<PolicyRow> & { notification_key: string }) => ({
        ...row,
        in_app_enabled: row.in_app_enabled !== false,
        email_enabled: row.email_enabled !== false,
        in_app_mandatory: row.in_app_mandatory === true,
        email_mandatory: row.email_mandatory === true,
      }))
    : []
}

export function MailPolicySettings() {
  const queryClient = useQueryClient()
  const [policies, setPolicies] = useState<PolicyRow[]>([])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["mail-policies"],
    queryFn: fetchMailPolicies,
  })

  // Sync local state when data loads
  useEffect(() => {
    if (data) setPolicies(data)
  }, [data])

  const { mutate: savePoliciesMutate, isPending: saving } = useMutation({
    mutationFn: async (body: { policies: PolicyRow[] }) => {
      const response = await apiFetch("/api/admin/settings/mail", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "Failed to save mail policies")
      return payload
    },
    onSuccess: () => {
      toast.success("Mail policies updated")
      queryClient.invalidateQueries({ queryKey: ["mail-policies"] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save mail policies")
    },
  })

  function updatePolicy(
    key: string,
    field: "in_app_enabled" | "email_enabled" | "in_app_mandatory" | "email_mandatory",
    value: boolean
  ) {
    setPolicies((prev) =>
      prev.map((row) => {
        if (row.notification_key !== key) return row
        const next = { ...row, [field]: value }

        if (field === "in_app_enabled" && value === false) {
          next.in_app_mandatory = false
        }
        if (field === "email_enabled" && value === false) {
          next.email_mandatory = false
        }
        if (field === "in_app_mandatory" && value === true) {
          next.in_app_enabled = true
        }
        if (field === "email_mandatory" && value === true) {
          next.email_enabled = true
        }
        return next
      })
    )
  }

  function savePolicies() {
    savePoliciesMutate({ policies })
  }

  const rows = useMemo(
    () =>
      [...policies].sort((a, b) => {
        const la = MODULE_LABELS[a.notification_key] || a.notification_key
        const lb = MODULE_LABELS[b.notification_key] || b.notification_key
        return la.localeCompare(lb)
      }),
    [policies]
  )

  if (isLoading) return <PageLoader />
  if (isError) return <QueryError message="Could not load mail policies." onRetry={refetch} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={savePolicies} disabled={saving}>
          {saving ? "Saving..." : "Save Mail Policies"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="text-muted-foreground grid grid-cols-10 border-b px-4 py-3 text-xs font-semibold tracking-wide uppercase">
            <div className="col-span-2">Notification Module</div>
            <div className="col-span-2 text-center">In-App</div>
            <div className="col-span-3 text-center">In-App Mandatory</div>
            <div className="col-span-1 text-center">Email</div>
            <div className="col-span-2 text-center">Email Mandatory</div>
          </div>

          {rows.map((row) => (
            <div
              key={row.notification_key}
              className="grid grid-cols-10 items-center border-b px-4 py-3 last:border-b-0"
            >
              <div className="col-span-2 text-sm font-medium">
                {MODULE_LABELS[row.notification_key] || row.notification_key}
              </div>
              <div className="col-span-2 flex justify-center">
                <Switch
                  checked={row.in_app_enabled}
                  onCheckedChange={(checked) => updatePolicy(row.notification_key, "in_app_enabled", checked)}
                />
              </div>
              <div className="col-span-3 flex justify-center">
                <Switch
                  checked={row.in_app_mandatory}
                  disabled={!row.in_app_enabled}
                  onCheckedChange={(checked) => updatePolicy(row.notification_key, "in_app_mandatory", checked)}
                />
              </div>
              <div className="col-span-1 flex justify-center">
                <Switch
                  checked={row.email_enabled}
                  onCheckedChange={(checked) => updatePolicy(row.notification_key, "email_enabled", checked)}
                />
              </div>
              <div className="col-span-2 flex justify-center">
                <Switch
                  checked={row.email_mandatory}
                  disabled={!row.email_enabled}
                  onCheckedChange={(checked) => updatePolicy(row.notification_key, "email_mandatory", checked)}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
