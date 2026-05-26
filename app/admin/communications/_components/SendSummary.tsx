"use client"

import { formatWATDateTime } from "@/lib/utils/date"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Send, Users, Loader2, CheckCircle2, AlertCircle, Clock, Video, BookOpen, FileText, Repeat } from "lucide-react"
import { formatDateNice, capitalize } from "./composer-utils"

type ReminderType = "meeting" | "knowledge_sharing" | "admin_broadcast"
type SendTiming = "now" | "scheduled" | "recurring"

interface SendSummaryProps {
  reminderType: ReminderType
  meetingDate: string
  meetingTime: string
  sessionDate: string
  sessionTime: string
  broadcastDepartment: string
  broadcastSubject: string
  broadcastAttachmentCount: number
  selectedMeetingPreparedByName: string | null
  selectedBroadcastPreparedByName: string | null
  selectedPresenterName: string | null
  knowledgeDepartment: string
  resolvedRecipients: string[]
  sendTiming: SendTiming
  scheduledDate: string
  scheduledTime: string
  recurringDay: string
  recurringTime: string
  isSending: boolean
  onSend: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendResult: any
}

export function SendSummary({
  reminderType,
  meetingDate,
  meetingTime,
  sessionDate,
  sessionTime,
  broadcastDepartment,
  broadcastSubject,
  broadcastAttachmentCount,
  selectedMeetingPreparedByName,
  selectedBroadcastPreparedByName,
  selectedPresenterName,
  knowledgeDepartment,
  resolvedRecipients,
  sendTiming,
  scheduledDate,
  scheduledTime,
  recurringDay,
  recurringTime,
  isSending,
  onSend,
  sendResult,
}: SendSummaryProps) {
  return (
    <aside className="space-y-6 lg:sticky lg:top-[120px] lg:max-h-[calc(100vh-136px)] lg:self-start lg:overflow-y-auto lg:pr-1">
      <Card className="border-orange-200 dark:border-orange-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Type */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground shrink-0">Type</span>
              <Badge variant="outline" className="gap-1">
                {reminderType === "meeting" ? (
                  <>
                    <Video className="h-3 w-3" /> Meeting
                  </>
                ) : reminderType === "knowledge_sharing" ? (
                  <>
                    <BookOpen className="h-3 w-3" /> Knowledge Sharing
                  </>
                ) : (
                  <>
                    <FileText className="h-3 w-3" /> Admin Broadcast
                  </>
                )}
              </Badge>
            </div>
            {reminderType !== "admin_broadcast" ? (
              <>
                <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0">Date</span>
                  <Badge className="max-w-[72%] truncate">
                    {reminderType === "meeting"
                      ? meetingDate
                        ? formatDateNice(meetingDate)
                        : "Not set"
                      : sessionDate
                        ? formatDateNice(sessionDate)
                        : "Not set"}
                  </Badge>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0">Time</span>
                  <Badge variant="secondary" className="max-w-[72%] truncate">
                    {reminderType === "meeting" ? meetingTime : sessionTime}
                  </Badge>
                </div>
                {reminderType === "meeting" && (
                  <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground shrink-0">Prepared by</span>
                    <Badge variant="outline" className="max-w-[68%] truncate">
                      {selectedMeetingPreparedByName || "Not set"}
                    </Badge>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0">Department</span>
                  <Badge variant="outline" className="max-w-[68%] truncate">
                    {broadcastDepartment}
                  </Badge>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0">Prepared by</span>
                  <Badge variant="outline" className="max-w-[68%] truncate">
                    {selectedBroadcastPreparedByName || "Not set"}
                  </Badge>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0">Subject</span>
                  <Badge variant="secondary" className="max-w-[68%] truncate">
                    {broadcastSubject.trim() || "Not set"}
                  </Badge>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0">Attachments</span>
                  <Badge variant="secondary" className="max-w-[68%] truncate">
                    {broadcastAttachmentCount}
                  </Badge>
                </div>
              </>
            )}
            {reminderType === "meeting" && selectedPresenterName && (
              <div className="flex min-w-0 items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground shrink-0">Knowledge Sharing</span>
                <Badge variant="secondary" className="max-w-[70%] truncate">
                  {selectedPresenterName} ({knowledgeDepartment !== "none" ? knowledgeDepartment : "N/A"})
                </Badge>
              </div>
            )}
          </div>

          <div className="border-t" />

          {/* Recipients */}
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">Recipients</div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-orange-600" />
              <span className="text-2xl font-bold">{resolvedRecipients.length}</span>
              <span className="text-muted-foreground text-sm">email(s)</span>
            </div>
            {resolvedRecipients.length > 0 && (
              <div className="mt-2 max-h-[160px] space-y-0.5 overflow-y-auto rounded-md border p-2 text-xs">
                {resolvedRecipients.map((email) => (
                  <div key={email} className="truncate">
                    {email}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t" />

          {/* Delivery */}
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs font-medium tracking-wider uppercase">Delivery</div>
            <div className="flex items-center gap-2 text-sm">
              {sendTiming === "now" ? (
                <>
                  <Send className="h-4 w-4 text-orange-600" />
                  <span>Immediately</span>
                </>
              ) : sendTiming === "recurring" ? (
                <>
                  <Repeat className="h-4 w-4 text-orange-600" />
                  <span>
                    Every {capitalize(recurringDay)} at {recurringTime}
                  </span>
                </>
              ) : (
                <>
                  <Clock className="h-4 w-4 text-orange-600" />
                  <span>
                    {scheduledDate
                      ? formatWATDateTime(`${scheduledDate}T${scheduledTime}`, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })
                      : "Not set"}
                  </span>
                </>
              )}
            </div>
          </div>

          <Button
            className="mt-4 w-full bg-orange-600 text-white hover:bg-orange-700"
            size="lg"
            disabled={isSending || resolvedRecipients.length === 0}
            onClick={onSend}
          >
            {isSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : sendTiming === "scheduled" ? (
              <>
                <Clock className="mr-2 h-4 w-4" />
                Schedule Send
              </>
            ) : sendTiming === "recurring" ? (
              <>
                <Repeat className="mr-2 h-4 w-4" />
                Save Recurring
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Now
              </>
            )}
          </Button>

          {resolvedRecipients.length === 0 && (
            <p className="text-destructive text-center text-xs">
              <AlertCircle className="mr-1 inline h-3 w-3" />
              No recipients selected
            </p>
          )}
        </CardContent>
      </Card>

      {/* Send Results */}
      {sendResult?.results && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Send Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] space-y-1 overflow-y-auto">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {sendResult.results.map((r: any, i: number) => (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${
                    r.success ? "bg-green-50 dark:bg-green-950/20" : "bg-red-50 dark:bg-red-950/20"
                  }`}
                >
                  <span className="truncate">{r.to}</span>
                  {r.success ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </aside>
  )
}
