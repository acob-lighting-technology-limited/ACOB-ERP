"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Clock, Brain, Save } from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import type { CbtSettings } from "@/lib/cbt-config"

interface CbtSettingsFormProps {
  initialSettings: CbtSettings
}

export function CbtSettingsForm({ initialSettings }: CbtSettingsFormProps) {
  const router = useRouter()
  const [form, setForm] = useState<CbtSettings>(initialSettings)
  const [saving, setSaving] = useState(false)

  const timePerQ = form.time_per_question_seconds || 45
  const questionCount = form.total_questions_count || 10
  const totalSeconds = timePerQ * questionCount
  const totalMinutesFormatted = (totalSeconds / 60).toFixed(1).replace(/\.0$/, "")

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

          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={saving} className="min-w-[140px]">
              <Save className="mr-2 h-4 w-4" />
              Save CBT Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
