"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock, Send, Repeat, Trash2 } from "lucide-react"
import { toLocalISODate } from "@/lib/utils/date"

type SendTiming = "now" | "scheduled" | "recurring"

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schedule = Record<string, any>

interface SchedulingOptionsProps {
  sendTiming: SendTiming
  setSendTiming: (t: SendTiming) => void
  scheduledDate: string
  setScheduledDate: (d: string) => void
  scheduledTime: string
  setScheduledTime: (t: string) => void
  recurringDay: string
  setRecurringDay: (d: string) => void
  recurringTime: string
  setRecurringTime: (t: string) => void
  activeSchedules: Schedule[]
  deactivateSchedule: (id: string) => void
}

export function SchedulingOptions({
  sendTiming,
  setSendTiming,
  scheduledDate,
  setScheduledDate,
  scheduledTime,
  setScheduledTime,
  recurringDay,
  setRecurringDay,
  recurringTime,
  setRecurringTime,
  activeSchedules,
  deactivateSchedule,
}: SchedulingOptionsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock className="h-5 w-5 text-orange-600" />
          Delivery Timing
        </CardTitle>
        <CardDescription>Send now, schedule once, or set up recurring weekly delivery</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setSendTiming("now")}
            className={`flex min-w-[150px] flex-1 items-center gap-3 rounded-lg border-2 p-4 transition-all ${
              sendTiming === "now"
                ? "border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-950/30"
                : "hover:border-muted-foreground/30 bg-muted/30 border-transparent"
            }`}
          >
            <Send className={`h-5 w-5 ${sendTiming === "now" ? "text-green-600" : "text-muted-foreground"}`} />
            <div className="text-left">
              <div className={`font-semibold ${sendTiming === "now" ? "text-green-700 dark:text-green-400" : ""}`}>
                Send Immediately
              </div>
              <div className="text-muted-foreground text-xs">Email will be sent right away</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setSendTiming("scheduled")}
            className={`flex min-w-[150px] flex-1 items-center gap-3 rounded-lg border-2 p-4 transition-all ${
              sendTiming === "scheduled"
                ? "border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-950/30"
                : "hover:border-muted-foreground/30 bg-muted/30 border-transparent"
            }`}
          >
            <Clock className={`h-5 w-5 ${sendTiming === "scheduled" ? "text-green-600" : "text-muted-foreground"}`} />
            <div className="text-left">
              <div
                className={`font-semibold ${sendTiming === "scheduled" ? "text-green-700 dark:text-green-400" : ""}`}
              >
                Schedule
              </div>
              <div className="text-muted-foreground text-xs">One-time, pick a date &amp; time</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setSendTiming("recurring")}
            className={`flex min-w-[150px] flex-1 items-center gap-3 rounded-lg border-2 p-4 transition-all ${
              sendTiming === "recurring"
                ? "border-green-600 bg-green-50 dark:border-green-500 dark:bg-green-950/30"
                : "hover:border-muted-foreground/30 bg-muted/30 border-transparent"
            }`}
          >
            <Repeat className={`h-5 w-5 ${sendTiming === "recurring" ? "text-green-600" : "text-muted-foreground"}`} />
            <div className="text-left">
              <div
                className={`font-semibold ${sendTiming === "recurring" ? "text-green-700 dark:text-green-400" : ""}`}
              >
                Recurring
              </div>
              <div className="text-muted-foreground text-xs">Automatic every week (server-side)</div>
            </div>
          </button>
        </div>

        {sendTiming === "scheduled" && (
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label htmlFor="sched-date">Date</Label>
              <Input
                id="sched-date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={toLocalISODate()}
                className="w-[180px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sched-time">Time</Label>
              <Input
                id="sched-time"
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-[140px]"
              />
            </div>
          </div>
        )}

        {sendTiming === "recurring" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label htmlFor="recurring-day">Day of Week</Label>
                <Select value={recurringDay} onValueChange={setRecurringDay}>
                  <SelectTrigger id="recurring-day" className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => (
                      <SelectItem key={d} value={d}>
                        {capitalize(d)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="recurring-time">Time</Label>
                <Input
                  id="recurring-time"
                  type="time"
                  value={recurringTime}
                  onChange={(e) => setRecurringTime(e.target.value)}
                  className="w-[140px]"
                />
              </div>
            </div>
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Repeat className="h-3.5 w-3.5" />
              Runs server-side — no need to keep your computer on. The meeting week is auto-calculated each time.
            </p>
          </div>
        )}

        {/* Active Schedules */}
        {activeSchedules.length > 0 && (
          <div className="space-y-2 border-t pt-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">Active Schedules</div>
            {activeSchedules.map((s) => (
              <div key={s.id} className="bg-muted/40 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  {s.schedule_type === "recurring" ? (
                    <Repeat className="h-4 w-4 text-green-600" />
                  ) : (
                    <Clock className="h-4 w-4 text-orange-600" />
                  )}
                  <span>
                    {s.schedule_type === "recurring"
                      ? `Every ${capitalize(s.send_day || "monday")} at ${s.send_time || "09:00"}`
                      : `One-time: W${s.meeting_week} — ${new Date(s.next_run_at).toLocaleString("en-GB", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {(s.recipients as string[])?.length || 0} recipients
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive h-7 w-7 p-0"
                  onClick={() => deactivateSchedule(s.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
