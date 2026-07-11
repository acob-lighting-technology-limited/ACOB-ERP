"use client"

import { useState } from "react"
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
import { EyeOff } from "lucide-react"
import type { FeedbackRecord } from "@/components/feedback/types"
import { apiFetch } from "@/lib/api-client"

interface FeedbackFormProps {
  onFeedbackSubmitted?: (feedback: FeedbackRecord) => void
  variant?: "card" | "modal"
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
          isAnonymous,
        }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; data?: FeedbackRecord } | null
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to submit feedback")
      }
      const createdFeedback = payload?.data || null

      toast.success(isAnonymous ? "Anonymous feedback submitted" : "Feedback submitted successfully!")
      form.reset({
        feedbackType: "",
        title: "",
        description: "",
      })
      setIsAnonymous(true)

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
      {/* Anonymous Toggle */}
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <EyeOff className={`h-4 w-4 ${isAnonymous ? "text-primary" : "text-muted-foreground"}`} />
          <Label htmlFor="anonymous" className="cursor-pointer">
            Submit anonymously
          </Label>
        </div>
        <Switch id="anonymous" checked={isAnonymous} onCheckedChange={setIsAnonymous} />
      </div>

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
        {isAnonymous ? "Submit Anonymously" : "Submit Feedback"}
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
