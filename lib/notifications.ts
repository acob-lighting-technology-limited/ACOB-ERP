/**
 * Notification Helper Library
 * Utility functions for creating and managing notifications
 */

import { createClient } from "@/lib/supabase/client"
import type { Json } from "@/types/database"

import { logger } from "@/lib/logger"

const log = logger("lib-notifications")

interface CreateNotificationParams {
  userId: string
  type:
    | "task_assigned"
    | "task_updated"
    | "task_completed"
    | "mention"
    | "feedback"
    | "asset_assigned"
    | "approval_request"
    | "approval_granted"
    | "approval_rejected"
    | "system"
    | "announcement"
    | "task_due_soon"
    | "task_awaiting_review"
    | "task_needs_rating"
    | "project_delayed"
  category: "tasks" | "assets" | "feedback" | "approvals" | "system" | "mentions"
  title: string
  message: string
  priority?: "low" | "normal" | "high" | "urgent"
  linkUrl?: string
  actorId?: string
  entityType?: string
  entityId?: string
  richContent?: Json
}

/**
 * Create a notification using the database function
 */
export async function createNotification(params: CreateNotificationParams) {
  const supabase = createClient()

  try {
    const { data, error } = await supabase.rpc("create_notification", {
      p_user_id: params.userId,
      p_type: params.type,
      p_category: params.category,
      p_title: params.title,
      p_message: params.message,
      p_priority: params.priority || "normal",
      p_link_url: params.linkUrl || null,
      p_actor_id: params.actorId || null,
      p_entity_type: params.entityType || null,
      p_entity_id: params.entityId || null,
      p_rich_content: params.richContent || null,
    })

    if (error) {
      log.error("RPC Error creating notification:", error)
      // Fallback to direct insertion if RPC fails
      const { data: insertData, error: insertError } = await supabase
        .from("notifications")
        .insert({
          user_id: params.userId,
          type: params.type,
          title: params.title,
          message: params.message,
          priority: params.priority || "normal",
          action_url: params.linkUrl || null,
          data: {
            category: params.category,
            actor_id: params.actorId,
            entity_type: params.entityType,
            entity_id: params.entityId,
            rich_content: params.richContent,
          },
        })
        .select()
        .single()

      if (insertError) throw insertError
      return insertData?.id
    }

    return data
  } catch (error) {
    log.error("Error creating notification:", error)
    throw error
  }
}

/**
 * Notify user about task assignment
 */
export async function notifyTaskAssigned(params: {
  userId: string
  taskId: string
  taskTitle: string
  assignedBy: string
  priority?: "low" | "medium" | "high" | "urgent"
}) {
  const priorityMap: Record<string, "low" | "normal" | "high" | "urgent"> = {
    low: "low",
    medium: "normal",
    high: "high",
    urgent: "urgent",
  }

  return createNotification({
    userId: params.userId,
    type: "task_assigned",
    category: "tasks",
    title: "New task assigned to you",
    message: `You've been assigned "${params.taskTitle}"`,
    priority: priorityMap[params.priority || "medium"],
    linkUrl: `/tasks`,
    actorId: params.assignedBy,
    entityType: "task",
    entityId: params.taskId,
  })
}

/**
 * Tell whoever must act that a task is now waiting on their decision.
 *
 * The rater is the project manager for project work and the assigning lead
 * otherwise, so this lands with the one person who can actually approve and
 * rate it rather than a broadcast nobody owns.
 */
export async function notifyTaskAwaitingReview(params: {
  userId: string
  taskId: string
  taskTitle: string
  submittedBy: string
  projectName?: string | null
}) {
  return createNotification({
    userId: params.userId,
    type: "task_awaiting_review",
    category: "tasks",
    title: "Task awaiting your review",
    message: `"${params.taskTitle}"${params.projectName ? ` (${params.projectName})` : ""} has been submitted and needs your approval and rating.`,
    priority: "high",
    linkUrl: `/admin/tasks`,
    actorId: params.submittedBy,
    entityType: "task",
    entityId: params.taskId,
  })
}

/** A deadline is close and the work is not finished yet. */
export async function notifyTaskDueSoon(params: {
  userId: string
  taskId: string
  taskTitle: string
  dueDate: string
  daysRemaining: number
}) {
  const when =
    params.daysRemaining <= 0 ? "today" : params.daysRemaining === 1 ? "tomorrow" : `in ${params.daysRemaining} days`

  return createNotification({
    userId: params.userId,
    type: "task_due_soon",
    category: "tasks",
    title: "Task deadline approaching",
    message: `"${params.taskTitle}" is due ${when} (${params.dueDate}).`,
    priority: params.daysRemaining <= 1 ? "high" : "normal",
    linkUrl: `/tasks`,
    entityType: "task",
    entityId: params.taskId,
  })
}

/** Submitted work still sitting unrated — the employee's KPI is held up by it. */
export async function notifyTaskNeedsRating(params: {
  userId: string
  taskId: string
  taskTitle: string
  waitingDays: number
}) {
  return createNotification({
    userId: params.userId,
    type: "task_needs_rating",
    category: "tasks",
    title: "Task still waiting to be rated",
    message: `"${params.taskTitle}" has been awaiting your rating for ${params.waitingDays} day${params.waitingDays === 1 ? "" : "s"}. It is held out of the assignee's KPI until you rate it.`,
    priority: "high",
    linkUrl: `/admin/tasks`,
    entityType: "task",
    entityId: params.taskId,
  })
}

/** A project has slipped far enough behind its schedule to need attention. */
export async function notifyProjectDelayed(params: {
  userId: string
  projectId: string
  projectName: string
  deliveryPct: number
  timeElapsedPct: number
  overdueCount: number
}) {
  return createNotification({
    userId: params.userId,
    type: "project_delayed",
    category: "tasks",
    title: "Project behind schedule",
    message: `"${params.projectName}" is ${params.deliveryPct}% delivered with ${params.timeElapsedPct}% of its schedule elapsed${params.overdueCount > 0 ? `, and has ${params.overdueCount} overdue task${params.overdueCount === 1 ? "" : "s"}` : ""}.`,
    priority: "high",
    linkUrl: `/admin/project`,
    entityType: "project",
    entityId: params.projectId,
  })
}

/**
 * Notify user about task update
 */
export async function notifyTaskUpdated(params: {
  userId: string
  taskId: string
  taskTitle: string
  updatedBy: string
  changeDescription: string
}) {
  return createNotification({
    userId: params.userId,
    type: "task_updated",
    category: "tasks",
    title: "Task updated",
    message: `"${params.taskTitle}" - ${params.changeDescription}`,
    priority: "normal",
    linkUrl: `/tasks`,
    actorId: params.updatedBy,
    entityType: "task",
    entityId: params.taskId,
  })
}

/**
 * Notify user about task completion
 */
export async function notifyTaskCompleted(params: {
  userId: string
  taskId: string
  taskTitle: string
  completedBy: string
}) {
  return createNotification({
    userId: params.userId,
    type: "task_completed",
    category: "tasks",
    title: "Task completed",
    message: `"${params.taskTitle}" has been marked as completed`,
    priority: "low",
    linkUrl: `/tasks`,
    actorId: params.completedBy,
    entityType: "task",
    entityId: params.taskId,
  })
}

/**
 * Notify user about asset assignment
 */
export async function notifyAssetAssigned(params: {
  userId: string
  assetId: string
  assetCode: string
  assetName: string
  assignedBy: string
}) {
  return createNotification({
    userId: params.userId,
    type: "asset_assigned",
    category: "assets",
    title: "New asset assigned to you",
    message: `${params.assetName} (${params.assetCode}) has been assigned to you`,
    priority: "normal",
    linkUrl: `/assets`,
    actorId: params.assignedBy,
    entityType: "asset",
    entityId: params.assetId,
    richContent: {
      asset_code: params.assetCode,
      asset_name: params.assetName,
      assigned_by: params.assignedBy,
    },
  })
}

/**
 * Notify admin about pending approval
 */
export async function notifyApprovalRequest(params: {
  adminId: string
  requestType: string
  requestBy: string
  requestDetails: string
  linkUrl?: string
}) {
  return createNotification({
    userId: params.adminId,
    type: "approval_request",
    category: "approvals",
    title: "Approval required",
    message: `${params.requestType}: ${params.requestDetails}`,
    priority: "high",
    linkUrl: params.linkUrl,
    actorId: params.requestBy,
    entityType: "approval",
    entityId: undefined,
  })
}

/**
 * Notify user about approval granted
 */
export async function notifyApprovalGranted(params: {
  userId: string
  approvalType: string
  approvedBy: string
  details: string
  linkUrl?: string
}) {
  return createNotification({
    userId: params.userId,
    type: "approval_granted",
    category: "approvals",
    title: "Approval granted",
    message: `Your ${params.approvalType} has been approved. ${params.details}`,
    priority: "normal",
    linkUrl: params.linkUrl,
    actorId: params.approvedBy,
    entityType: "approval",
    entityId: undefined,
  })
}

/**
 * Notify user about approval rejected
 */
export async function notifyApprovalRejected(params: {
  userId: string
  approvalType: string
  rejectedBy: string
  reason: string
  linkUrl?: string
}) {
  return createNotification({
    userId: params.userId,
    type: "approval_rejected",
    category: "approvals",
    title: "Approval rejected",
    message: `Your ${params.approvalType} has been rejected. Reason: ${params.reason}`,
    priority: "high",
    linkUrl: params.linkUrl,
    actorId: params.rejectedBy,
    entityType: "approval",
    entityId: undefined,
  })
}

/**
 * Notify user about feedback response
 */
export async function notifyFeedbackResponse(params: {
  userId: string
  feedbackId: string
  responseBy: string
  responsePreview: string
}) {
  return createNotification({
    userId: params.userId,
    type: "feedback",
    category: "feedback",
    title: "Response to your feedback",
    message: params.responsePreview,
    priority: "normal",
    linkUrl: `/feedback`,
    actorId: params.responseBy,
    entityType: "feedback",
    entityId: params.feedbackId,
  })
}

/**
 * Notify user about mention in comment/note
 */
export async function notifyMention(params: {
  userId: string
  mentionedBy: string
  context: string
  contextType: string
  linkUrl?: string
}) {
  return createNotification({
    userId: params.userId,
    type: "mention",
    category: "mentions",
    title: "Someone mentioned you",
    message: `You were mentioned in ${params.context}`,
    priority: "normal",
    linkUrl: params.linkUrl,
    actorId: params.mentionedBy,
    entityType: params.contextType,
    entityId: undefined,
  })
}

/**
 * Create system announcement
 */
export async function createSystemAnnouncement(params: {
  userIds: string[] // Array of user IDs to notify
  title: string
  message: string
  priority?: "low" | "normal" | "high" | "urgent"
  linkUrl?: string
  expiresInDays?: number
}) {
  const supabase = createClient()

  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null

  const notifications = params.userIds.map((userId) => ({
    user_id: userId,
    type: "announcement",
    category: "system",
    priority: params.priority || "normal",
    title: params.title,
    message: params.message,
    link_url: params.linkUrl || null,
    expires_at: expiresAt,
  }))

  const { data, error } = await supabase.from("notifications").insert(notifications).select()

  if (error) throw error

  return data
}

/**
 * Mark multiple notifications as read
 */
export async function markNotificationsAsRead(notificationIds: string[]) {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const { data, error } = await supabase.rpc("mark_notifications_read", {
    p_user_id: user.id,
    p_notification_ids: notificationIds,
  })

  if (error) throw error

  return data
}

/**
 * Get unread notification count
 */
export async function getUnreadCount() {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 0

  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false)
    .eq("archived", false)

  if (error) throw error

  return count || 0
}
