"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loader2, Save } from "lucide-react"
import { AttendancePolicy } from "@/lib/org-config"
import { grossDayHoursFor, netDayHoursFor } from "@/lib/hr/attendance-ssot"
import { apiFetch } from "@/lib/api-client"

interface AttendanceFormProps {
  initialPolicy: AttendancePolicy
}

export function AttendanceForm({ initialPolicy }: AttendanceFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [formData, setFormData] = useState<AttendancePolicy>(initialPolicy)

  // Shown back to the admin so the effect of a change is obvious before saving.
  const grossDayHours = grossDayHoursFor(formData)
  const netDayHours = netDayHoursFor(formData)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validate times
    const [sh, sm] = formData.startTime.split(":").map(Number)
    const [eh, em] = formData.endTime.split(":").map(Number)
    const [lh, lm] = formData.lateCutoff.split(":").map(Number)

    if (lh * 60 + lm < sh * 60 + sm) {
      toast.error("Grace cutoff time must be after the workday start time.")
      return
    }

    if (eh * 60 + em <= sh * 60 + sm) {
      toast.error("Workday end time must be after the workday start time.")
      return
    }

    startTransition(async () => {
      try {
        const response = await apiFetch("/api/admin/settings/attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...formData,
            incompletePenalty: Number(formData.incompletePenalty),
            lunchMinutes: Number(formData.lunchMinutes),
            lunchQualifyingHours: Number(formData.lunchQualifyingHours),
          }),
        })

        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error || "Failed to update configuration")
        }

        toast.success("Attendance policy updated successfully.")
        router.refresh()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "An unexpected error occurred"
        toast.error(message)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card className="border-2 shadow-lg">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight">Workday & Penalties Configuration</CardTitle>
          <CardDescription>
            Configure official business hours, grace periods, and credit deductions for incomplete days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="startTime">Workday Start Time (HH:MM)</Label>
              <Input
                id="startTime"
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                required
                className="w-full font-medium"
              />
              <p className="text-muted-foreground text-[11px]">Official opening hour. Default is 08:00 AM.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lateCutoff">Lateness Grace Cutoff (HH:MM)</Label>
              <Input
                id="lateCutoff"
                type="time"
                value={formData.lateCutoff}
                onChange={(e) => setFormData({ ...formData, lateCutoff: e.target.value })}
                required
                className="w-full font-medium"
              />
              <p className="text-muted-foreground text-[11px]">
                Clock-ins after this time are marked Late. Default is 08:20 AM.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="endTime">Workday End Time (HH:MM)</Label>
              <Input
                id="endTime"
                type="time"
                value={formData.endTime}
                onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                required
                className="w-full font-medium"
              />
              <p className="text-muted-foreground text-[11px]">Official closing hour. Default is 05:00 PM.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="incompletePenalty">Incomplete Punch Penalty (Hours)</Label>
              <Input
                id="incompletePenalty"
                type="number"
                step="0.5"
                min="0"
                max="9"
                value={formData.incompletePenalty}
                onChange={(e) => setFormData({ ...formData, incompletePenalty: Number(e.target.value) })}
                required
                className="w-full font-medium"
              />
              <p className="text-muted-foreground text-[11px]">
                Hours charged when an employee misses a punch, on top of the side that was recorded. Default is 1.0.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lunchMinutes">Lunch Break (Minutes)</Label>
              <Input
                id="lunchMinutes"
                type="number"
                step="5"
                min="0"
                max="240"
                value={formData.lunchMinutes}
                onChange={(e) => setFormData({ ...formData, lunchMinutes: Number(e.target.value) })}
                required
                className="w-full font-medium"
              />
              <p className="text-muted-foreground text-[11px]">
                Unpaid break deducted from a qualifying day. Default is 30 minutes.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lunchQualifyingHours">Lunch Qualifying Day (Hours)</Label>
              <Input
                id="lunchQualifyingHours"
                type="number"
                step="0.5"
                min="0"
                max="24"
                value={formData.lunchQualifyingHours}
                onChange={(e) => setFormData({ ...formData, lunchQualifyingHours: Number(e.target.value) })}
                required
                className="w-full font-medium"
              />
              <p className="text-muted-foreground text-[11px]">
                Shortest day that earns the lunch break. Default is 5 hours.
              </p>
            </div>
          </div>

          <div className="bg-muted/40 rounded-lg border p-4">
            <p className="text-muted-foreground text-[11px]">
              A full working day is{" "}
              <span className="text-foreground font-semibold">{netDayHours.toFixed(2)} hours</span> —{" "}
              {grossDayHours.toFixed(2)}h from {formData.startTime} to {formData.endTime}, less the{" "}
              {formData.lunchMinutes}-minute lunch. Every penalty in the system is capped at this figure, and arriving
              after {formData.lateCutoff} costs one hour per hour-bracket.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="emailNotificationsEnabled" className="text-sm font-semibold">
                Email Notifications
              </Label>
              <p className="text-muted-foreground text-[11px]">
                When on, manual attendance alterations and LWP/AWP appeal decisions email the affected employee and the
                Admin &amp; HR lead.
              </p>
            </div>
            <Switch
              id="emailNotificationsEnabled"
              checked={formData.emailNotificationsEnabled}
              onCheckedChange={(checked) => setFormData({ ...formData, emailNotificationsEnabled: checked })}
            />
          </div>
        </CardContent>
        <CardFooter className="border-muted flex justify-end border-t pt-6">
          <Button type="submit" disabled={isPending} className="flex items-center gap-2 px-6 font-semibold">
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving Policy...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
