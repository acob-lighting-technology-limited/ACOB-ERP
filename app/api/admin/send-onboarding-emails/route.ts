import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { canAccessAdminSection, resolveAdminScope } from "@/lib/admin/rbac"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import {
  sendNotificationEmailWithRetry,
  sendNotificationEmailsIndividuallyWithRetry,
} from "@/lib/notifications/email-gateway"
import { isSystemNotificationChannelEnabled } from "@/lib/notifications/delivery-policy"
import { logger } from "@/lib/logger"

const log = logger("api-send-onboarding-emails")

interface EmailBlock {
  subject: string
  recipients: string[]
  html: string
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const scope = await resolveAdminScope(supabase, user.id)
    if (!scope || !canAccessAdminSection(scope, "hr")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = (await req.json()) as {
      profileId: string
      welcome: EmailBlock
      internal: EmailBlock
    }

    const { profileId, welcome, internal } = body
    if (!profileId || !welcome || !internal) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const warnings: string[] = []

    const onboardingMailEnabled = await isSystemNotificationChannelEnabled(dataClient, "onboarding", "email")

    if (onboardingMailEnabled) {
      // Welcome email to the new employee
      if (welcome.recipients.length > 0) {
        try {
          const result = await sendNotificationEmailWithRetry({
            to: welcome.recipients,
            subject: welcome.subject,
            html: welcome.html,
          })
          if (!result.sent) {
            warnings.push(`Welcome email: ${result.reason}`)
            log.error({ reason: result.reason }, "Welcome email not sent")
          }
        } catch (err) {
          warnings.push(`Welcome email: ${err instanceof Error ? err.message : String(err)}`)
          log.error({ err }, "Welcome email send failed")
        }
      }

      // Internal notification to leads
      if (internal.recipients.length > 0) {
        try {
          const result = await sendNotificationEmailsIndividuallyWithRetry({
            to: internal.recipients,
            subject: internal.subject,
            html: internal.html,
          })
          if (!result.sent) {
            const summary = result.failedRecipients.map((f) => `${f.recipient}: ${f.reason}`).join("; ")
            warnings.push(`Internal email: ${summary}`)
            log.error({ failedRecipients: result.failedRecipients }, "Internal onboarding email partial failure")
          }
        } catch (err) {
          warnings.push(`Internal email: ${err instanceof Error ? err.message : String(err)}`)
          log.error({ err }, "Internal onboarding email send failed")
        }
      }
    }

    // In-app welcome notification for the new employee
    try {
      const { error: notifyError } = await dataClient.from("notifications").insert({
        user_id: profileId,
        type: "announcement",
        category: "system",
        priority: "high",
        title: "Welcome to ACOB",
        message: "Your account has been approved. Welcome to ACOB Lighting Technology Limited.",
        link_url: null,
      })
      if (notifyError) {
        log.error({ error: notifyError }, "Failed to create welcome in-app notification")
      }
    } catch (err) {
      log.error({ err }, "Welcome in-app notification insert failed")
    }

    log.info({ profileId, warnings }, "Onboarding emails dispatched")
    return NextResponse.json({ sent: true, warnings })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send onboarding emails"
    log.error({ error }, "POST send-onboarding-emails failed")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
