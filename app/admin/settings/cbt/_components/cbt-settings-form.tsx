"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Clock, Brain, Save, Shield, UserCheck, Users, X } from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import type { CbtSettings } from "@/lib/cbt-config"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"

export type ProfileOption = {
  id: string
  full_name: string | null
  company_email: string | null
  department: string | null
  role: string | null
}

interface CbtSettingsFormProps {
  initialSettings: CbtSettings
  profiles: ProfileOption[]
}

const AVAILABLE_ROLES = [
  { key: "admin", label: "Admin", description: "Users with standard Admin role" },
  { key: "department_lead", label: "Department Lead", description: "Designated leads of departments" },
  { key: "employee", label: "Employee", description: "Regular staff members" },
  { key: "visitor", label: "Visitor", description: "Guest/Visitor accounts" },
]

export function CbtSettingsForm({ initialSettings, profiles }: CbtSettingsFormProps) {
  const router = useRouter()
  const [form, setForm] = useState<CbtSettings>({
    ...initialSettings,
    allowed_roles: initialSettings.allowed_roles || [],
    allowed_user_ids: initialSettings.allowed_user_ids || [],
  })
  const [saving, setSaving] = useState(false)

  const timePerQ = form.time_per_question_seconds || 45
  const questionCount = form.total_questions_count || 10
  const totalSeconds = timePerQ * questionCount
  const totalMinutesFormatted = (totalSeconds / 60).toFixed(1).replace(/\.0$/, "")

  const selectedUserIds = useMemo(() => new Set(form.allowed_user_ids || []), [form.allowed_user_ids])
  const selectedRoles = useMemo(() => new Set(form.allowed_roles || []), [form.allowed_roles])

  const selectedProfiles = useMemo(() => {
    return profiles.filter((p) => selectedUserIds.has(p.id))
  }, [profiles, selectedUserIds])

  const staffOptions = useMemo(() => {
    return profiles.map((p) => {
      const details = [p.company_email, p.department, p.role ? `role: ${p.role}` : null].filter(Boolean).join(" • ")
      const label = `${p.full_name || "Unnamed Staff"}${details ? ` (${details})` : ""}`
      return {
        value: p.id,
        label,
      }
    })
  }, [profiles])

  const toggleRole = (roleKey: string) => {
    setForm((prev) => {
      const currentRoles = new Set(prev.allowed_roles || [])
      if (currentRoles.has(roleKey)) {
        currentRoles.delete(roleKey)
      } else {
        currentRoles.add(roleKey)
      }
      return { ...prev, allowed_roles: Array.from(currentRoles) }
    })
  }

  const removeUser = (userId: string) => {
    setForm((prev) => ({
      ...prev,
      allowed_user_ids: (prev.allowed_user_ids || []).filter((id) => id !== userId),
    }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await apiFetch("/api/admin/settings/cbt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to save CBT settings")

      toast.success("CBT Assessment Settings updated successfully")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving CBT settings")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Brain className="text-primary h-5 w-5" />
            CBT Assessment Configuration
          </CardTitle>
          <CardDescription>
            Configure default total questions per test session, duration multiplier per question, and candidate question
            response visibility.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="total_questions_count" className="font-semibold">
                Number of Questions per Test
              </Label>
              <Input
                id="total_questions_count"
                type="number"
                min={1}
                max={100}
                value={form.total_questions_count || ""}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    total_questions_count: e.target.value === "" ? 0 : parseInt(e.target.value) || 0,
                  }))
                }
                className="[appearance:textfield] font-mono [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <p className="text-muted-foreground text-xs">
                Default number of questions randomly selected for each CBT candidate session (default: 10).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="time_per_question_seconds" className="font-semibold">
                Time Allowed per Question (seconds)
              </Label>
              <Input
                id="time_per_question_seconds"
                type="number"
                min={5}
                max={600}
                value={form.time_per_question_seconds || ""}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    time_per_question_seconds: e.target.value === "" ? 0 : parseInt(e.target.value) || 0,
                  }))
                }
                className="[appearance:textfield] font-mono [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <p className="text-muted-foreground text-xs">
                Seconds allocated per question to compute the total exam countdown duration (default: 45 seconds).
              </p>
            </div>
          </div>

          <div className="bg-muted/30 border-border/60 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Label htmlFor="show_detailed_responses" className="text-foreground cursor-pointer text-sm font-semibold">
                Show Detailed Question Responses to Candidates
              </Label>
              <p className="text-muted-foreground text-xs leading-relaxed">
                When turned off, candidate score detail breakdowns in PMS CBT will withhold individual question prompts,
                choices, correct options, and explanations. Enable this toggle when ready to show full question response
                analysis to candidates for completed cycles.
              </p>
            </div>
            <Switch
              id="show_detailed_responses"
              checked={form.show_detailed_responses ?? false}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, show_detailed_responses: checked }))}
            />
          </div>

          <div className="border-primary/20 bg-primary/5 space-y-2 rounded-xl border p-4">
            <div className="text-primary flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4" />
              Calculated Exam Duration Summary
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <span className="text-muted-foreground block text-xs">Questions:</span>
                <span className="font-mono text-base font-bold">{questionCount}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">Time / Question:</span>
                <span className="font-mono text-base font-bold">{timePerQ} seconds</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">Total Exam Timer:</span>
                <span className="text-primary font-mono text-base font-bold">
                  {totalMinutesFormatted} mins ({totalSeconds}s)
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Shield className="text-primary h-5 w-5" />
            CBT Access & Permissions
          </CardTitle>
          <CardDescription>
            Grant access to view and manage CBT scores and questions (/cbt). Super Admin and Developer roles always
            retain access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-base font-semibold">
                <Users className="text-muted-foreground h-4 w-4" />
                Role-Based Access
              </Label>
              <Badge variant="outline" className="text-xs font-normal">
                Super Admin & Devs ALWAYS allowed
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              Select additional user roles or positions that should have access to CBT overview and management.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {AVAILABLE_ROLES.map((r) => {
                const checked = selectedRoles.has(r.key)
                return (
                  <div
                    key={r.key}
                    onClick={() => toggleRole(r.key)}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                      checked ? "border-primary/50 bg-primary/5" : "border-border/60 bg-muted/20 hover:bg-muted/40"
                    }`}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleRole(r.key)} className="mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold">{r.label}</p>
                      <p className="text-muted-foreground text-xs">{r.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <Label className="flex items-center gap-2 text-base font-semibold">
              <UserCheck className="text-muted-foreground h-4 w-4" />
              Individual Staff Member Grants
            </Label>
            <p className="text-muted-foreground text-xs">
              Grant CBT access to specific individuals regardless of their role.
            </p>

            {selectedProfiles.length > 0 && (
              <div className="flex flex-wrap gap-2 pb-2">
                {selectedProfiles.map((p) => (
                  <Badge key={p.id} variant="secondary" className="gap-1 px-2.5 py-1 text-xs font-medium">
                    <span>{p.full_name || p.company_email}</span>
                    {p.department && <span className="text-muted-foreground">({p.department})</span>}
                    <button
                      type="button"
                      onClick={() => removeUser(p.id)}
                      className="hover:bg-muted ml-1 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            <SearchableMultiSelect
              label="Staff Members"
              icon={<UserCheck className="text-muted-foreground h-4 w-4" />}
              values={form.allowed_user_ids || []}
              options={staffOptions}
              onChange={(newIds) => setForm((prev) => ({ ...prev, allowed_user_ids: newIds }))}
              placeholder="Select staff members to grant CBT access..."
              searchPlaceholder="Search staff by name, email, department, or role..."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={saving} className="min-w-[160px]">
          <Save className="mr-2 h-4 w-4" />
          Save CBT Settings
        </Button>
      </div>
    </form>
  )
}
