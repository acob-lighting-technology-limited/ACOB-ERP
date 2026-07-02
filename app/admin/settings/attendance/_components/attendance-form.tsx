"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Save } from "lucide-react"
import { AttendancePolicy } from "@/lib/org-config"

interface AttendanceFormProps {
  initialPolicy: AttendancePolicy
}

export function AttendanceForm({ initialPolicy }: AttendanceFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [formData, setFormData] = useState<AttendancePolicy>(initialPolicy)

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
        const response = await fetch("/api/admin/settings/attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...formData,
            incompletePenalty: Number(formData.incompletePenalty),
            totalCredits: Number(formData.totalCredits),
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
              <p className="text-[11px] text-muted-foreground">Official opening hour. Default is 08:00 AM.</p>
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
              <p className="text-[11px] text-muted-foreground">Clock-ins after this time are marked Late. Default is 08:20 AM.</p>
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
              <p className="text-[11px] text-muted-foreground">Official closing hour. Default is 05:00 PM.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="incompletePenalty">Incomplete Punch Penalty (Credits)</Label>
              <Input
                id="incompletePenalty"
                type="number"
                step="0.1"
                min="0"
                max="9"
                value={formData.incompletePenalty}
                onChange={(e) => setFormData({ ...formData, incompletePenalty: Number(e.target.value) })}
                required
                className="w-full font-medium"
              />
              <p className="text-[11px] text-muted-foreground">Deduction applied when an employee misses clock-out. Default is 1.0.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="totalCredits">Total Credit Pool (Credits)</Label>
              <Input
                id="totalCredits"
                type="number"
                min="1"
                max="24"
                value={formData.totalCredits}
                onChange={(e) => setFormData({ ...formData, totalCredits: Number(e.target.value) })}
                required
                className="w-full font-medium"
              />
              <p className="text-[11px] text-muted-foreground">Total credit budget for a full workday. Default is 10.</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end pt-6 border-t border-muted">
          <Button type="submit" disabled={isPending} className="px-6 font-semibold flex items-center gap-2">
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
