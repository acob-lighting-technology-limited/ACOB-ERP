"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { EyeOff, ShieldCheck } from "lucide-react"
import type { FeedbackRecord } from "@/components/feedback/types"
import { apiFetch } from "@/lib/api-client"
import { logger } from "@/lib/logger"

const log = logger("feedback-form")

/** Sentinel for the default "general feedback to management" target. */
const GENERAL_TARGET = "general"

interface EligibleLead {
  id: string
  first_name: string | null
  last_name: string | null
  designation: string | null
  department: string | null
}

interface FeedbackFormProps {
  onFeedbackSubmitted?: (feedback: FeedbackRecord) => void
  variant?: "card" | "modal"
}

function leadLabel(lead: EligibleLead): string {
  const name = `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "Department Lead"
  return lead.designation ? `${name} — ${lead.designation}` : name
}

const FeedbackFormSchema = z.object({
  feedbackType: z.string().min(1, "Feedback type is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
})

type FeedbackFormValues = z.infer<typeof FeedbackFormSchema>

export function FeedbackForm({ onFeedbackSubmitted, variant = "card" }: FeedbackFormProps) {
  const form = useForm<FeedbackFormValues>({
    resolver: zodResolver(FeedbackFormSchema),
    defaultValues: {
      feedbackType: "",
      title: "",
      description: "",
    },
  })
  const [isAnonymous, setIsAnonymous] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [leads, setLeads] = useState<EligibleLead[]>([])
  const [target, setTarget] = useState<string>(GENERAL_TARGET)

  const isLeadFeedback = target !== GENERAL_TARGET

  // Only the lead(s) of the user's own department are returned here — the server
  // resolves eligibility, so this list is also the authorization boundary.
  useEffect(() => {
    let cancelled = false
    const loadLeads = async () => {
      try {
        const response = await apiFetch("/api/feedback/my-leads", { cache: "no-store" })
        if (!response.ok) return
        const payload = (await response.json().catch(() => null)) as { data?: EligibleLead[] } | null
        if (!cancelled) setLeads(payload?.data || [])
      } catch (error) {
        log.error({ err: String(error) }, "Failed to load eligible leads")
      }
    }
    void loadLeads()
    return () => {
      cancelled = true
    }
  }, [])

  const onSubmit = form.handleSubmit(async (data) => {
    setIsLoading(true)

    try {
      const response = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackType: data.feedbackType,
          title: data.title,
          description: data.description,
          isAnonymous: isLeadFeedback ? true : isAnonymous,
          targetLeadId: isLeadFeedback ? target : null,
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        data?: FeedbackRecord | null
        leadFeedback?: boolean
      } | null
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to submit feedback")
      }
      const createdFeedback = payload?.data || null

      toast.success(
        payload?.leadFeedback
          ? "Anonymous feedback sent to HR. It is not linked to you in any way."
          : isAnonymous
            ? "Anonymous feedback submitted"
            : "Feedback submitted successfully!"
      )
      form.reset({
        feedbackType: "",
        title: "",
        description: "",
      })
      setIsAnonymous(true)
      setTarget(GENERAL_TARGET)

      if (onFeedbackSubmitted && createdFeedback) {
        onFeedbackSubmitted(createdFeedback)
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to submit feedback"
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  })

  const formContent = (
    <form onSubmit={onSubmit} className="space-y-4">
      {leads.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="feedbackTarget">Who is this about?</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id="feedbackTarget">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GENERAL_TARGET}>General — management</SelectItem>
              {leads.map((lead) => (
                <SelectItem key={lead.id} value={lead.id}>
                  {leadLabel(lead)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">You can only give feedback about your own department lead.</p>
        </div>
      )}

      {/* Anonymous Toggle — forced on (and locked) for lead feedback */}
      {isLeadFeedback ? (
        <div className="bg-muted/40 flex items-start gap-2 rounded-lg border p-3">
          <ShieldCheck className="text-primary mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Always anonymous</p>
            <p className="text-muted-foreground text-xs">
              Your identity is never stored and only the date is recorded, not the time — so this cannot be traced back
              to you. Your lead never sees it; only HR does. Because nothing links it to you, it will not appear in your
              feedback list and cannot be edited or deleted after submission.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <EyeOff className={`h-4 w-4 ${isAnonymous ? "text-primary" : "text-muted-foreground"}`} />
            <Label htmlFor="anonymous" className="cursor-pointer">
              Submit anonymously
            </Label>
          </div>
          <Switch id="anonymous" checked={isAnonymous} onCheckedChange={setIsAnonymous} />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="feedbackType">Feedback Type *</Label>
        <Select value={form.watch("feedbackType")} onValueChange={(value) => form.setValue("feedbackType", value)}>
          <SelectTrigger id="feedbackType">
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="concern">Concern</SelectItem>
            <SelectItem value="complaint">Complaint</SelectItem>
            <SelectItem value="suggestion">Suggestion</SelectItem>
            <SelectItem value="required_item">Required Item</SelectItem>
          </SelectContent>
        </Select>
        {form.formState.errors.feedbackType && (
          <p className="text-destructive text-sm">{form.formState.errors.feedbackType.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input id="title" {...form.register("title")} placeholder="Brief title of your feedback" />
        {form.formState.errors.title && (
          <p className="text-destructive text-sm">{form.formState.errors.title.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          {...form.register("description")}
          placeholder="Provide more details about your feedback..."
          rows={4}
        />
      </div>

      <Button type="submit" loading={isLoading} className={variant === "modal" ? "w-full" : "w-full"}>
        {isAnonymous || isLeadFeedback ? "Submit Anonymously" : "Submit Feedback"}
      </Button>
    </form>
  )

  if (variant === "modal") {
    return formContent
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit Feedback</CardTitle>
        <CardDescription>Share your thoughts with us</CardDescription>
      </CardHeader>
      <CardContent>{formContent}</CardContent>
    </Card>
  )
}
