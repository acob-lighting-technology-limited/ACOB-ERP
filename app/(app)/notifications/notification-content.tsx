"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab, RowAction } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Bell,
  AlertCircle,
  CheckCircle,
  Info,
  CheckCheck,
  Package,
  AlertTriangle,
  Clock,
  Star,
  ChevronRight,
  RefreshCw,
  Mail,
  Megaphone,
  Trash2,
  Settings,
  MessageSquare,
  FileText,
  User,
  Calendar,
  FileBarChart,
} from "lucide-react"
import type { Notification } from "./page"

import { logger } from "@/lib/logger"

const log = logger("notification-notification-content")

type NotificationType = Notification["type"]

const TYPE_ICONS: Record<string, typeof Info> = {
  task_assigned: User,
  task_updated: AlertCircle,
  task_completed: CheckCircle,
  mention: MessageSquare,
  feedback: MessageSquare,
  asset_assigned: Package,
  approval_request: FileText,
  approval_granted: CheckCircle,
  system: Info,
  announcement: Megaphone,
  task_due_soon: Clock,
  task_awaiting_review: FileText,
  task_needs_rating: Star,
  task_blocked: AlertTriangle,
  project_delayed: AlertTriangle,
}

const TYPE_CARD_BG: Record<string, string> = {
  task_assigned: "bg-blue-50/50 dark:bg-blue-950/10",
  task_updated: "bg-amber-50/50 dark:bg-amber-950/10",
  task_completed: "bg-emerald-50/50 dark:bg-emerald-950/10",
  mention: "bg-violet-50/50 dark:bg-violet-950/10",
  feedback: "bg-violet-50/50 dark:bg-violet-950/10",
  asset_assigned: "bg-cyan-50/50 dark:bg-cyan-950/10",
  approval_request: "bg-orange-50/50 dark:bg-orange-950/10",
  approval_granted: "bg-emerald-50/50 dark:bg-emerald-950/10",
  system: "bg-slate-50/50 dark:bg-slate-950/10",
  announcement: "bg-red-50/50 dark:bg-red-950/10",
  task_due_soon: "bg-amber-50/50 dark:bg-amber-950/10",
  task_awaiting_review: "bg-orange-50/50 dark:bg-orange-950/10",
  task_needs_rating: "bg-orange-50/50 dark:bg-orange-950/10",
  task_blocked: "bg-red-50/50 dark:bg-red-950/10",
  project_delayed: "bg-red-50/50 dark:bg-red-950/10",
}

const PRIORITY_BADGE_CLASS: Record<string, string> = {
  urgent: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  normal: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  low: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
}

function getPriorityBadgeClass(priority: string | null | undefined): string {
  return (
    PRIORITY_BADGE_CLASS[String(priority || "").toLowerCase()] || "border-muted-foreground/30 text-muted-foreground"
  )
}

interface NotificationContentProps {
  initialNotifications: Notification[]
  userId: string
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return "Just now"
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours} hour${hours > 1 ? "s" : ""} ago`
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days} day${days > 1 ? "s" : ""} ago`
  }
  return formatWATDate(date, { month: "short", day: "numeric", year: "numeric" })
}

export function NotificationContent({ initialNotifications, userId }: NotificationContentProps) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("all")

  useEffect(() => {
    setNotifications(initialNotifications)
  }, [initialNotifications])

  useEffect(() => {
    const subscription = supabase
      .channel("user_notifications")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setNotifications((prev) => [payload.new as Notification, ...prev])
            return
          }
          if (payload.eventType === "UPDATE") {
            setNotifications((prev) => prev.map((n) => (n.id === payload.new.id ? (payload.new as Notification) : n)))
            return
          }
          if (payload.eventType === "DELETE") {
            setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id))
          }
        }
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [supabase, userId])

  const markAsRead = useCallback(
    async (notificationId: string) => {
      try {
        const { error } = await supabase
          .from("notifications")
          .update({ read: true, read_at: new Date().toISOString() })
          .eq("id", notificationId)
        if (error) throw error
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, read: true, read_at: new Date().toISOString() } : n))
        )
      } catch (error: unknown) {
        log.error("Error marking notification read:", error)
        toast.error("Failed to mark as read")
      }
    },
    [supabase]
  )

  const markAsUnread = useCallback(
    async (notificationId: string) => {
      try {
        const { error } = await supabase
          .from("notifications")
          .update({ read: false, read_at: null })
          .eq("id", notificationId)
        if (error) throw error
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, read: false, read_at: undefined } : n))
        )
      } catch (error: unknown) {
        log.error("Error marking notification unread:", error)
        toast.error("Failed to mark as unread")
      }
    },
    [supabase]
  )

  const markAllAsRead = useCallback(async () => {
    try {
      const { error } = await supabase.rpc("mark_notifications_read", {
        p_user_id: userId,
        p_notification_ids: null,
      })
      if (error) throw error
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read: true, read_at: n.read_at ?? new Date().toISOString() }))
      )
      toast.success("All notifications marked as read")
    } catch (error: unknown) {
      log.error("Error marking all notifications read:", error)
      toast.error("Failed to mark all as read")
    }
  }, [supabase, userId])

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      try {
        const { error } = await supabase.from("notifications").delete().eq("id", notificationId)
        if (error) throw error
        setNotifications((prev) => prev.filter((n) => n.id !== notificationId))
        toast.success("Notification deleted")
      } catch (error: unknown) {
        log.error("Error deleting notification:", error)
        toast.error("Failed to delete notification")
      }
    },
    [supabase]
  )

  const openNotification = useCallback(
    async (notification: Notification) => {
      if (!notification.read) {
        await markAsRead(notification.id)
      }
      if (notification.action_url) {
        router.push(notification.action_url)
      }
    },
    [markAsRead, router]
  )

  const counts = useMemo(() => {
    return {
      all: notifications.length,
      unread: notifications.filter((n) => !n.read).length,
      critical: notifications.filter((n) => n.priority === "high" || n.priority === "urgent").length,
      approvals: notifications.filter((n) => n.category === "approvals").length,
      tasks: notifications.filter((n) => n.category === "tasks").length,
      assets: notifications.filter((n) => n.category === "assets").length,
      feedback: notifications.filter((n) => n.category === "feedback").length,
      mentions: notifications.filter((n) => n.category === "mentions").length,
      meetings: notifications.filter((n) => n.category === "meetings").length,
      communications: notifications.filter((n) => n.category === "communications").length,
      reports: notifications.filter((n) => n.category === "reports").length,
    }
  }, [notifications])

  const tabs: DataTableTab[] = useMemo(
    () => [
      { key: "all", label: `All(${counts.all})`, icon: Bell },
      { key: "unread", label: `Unread(${counts.unread})`, icon: Clock },
      { key: "critical", label: `Critical(${counts.critical})`, icon: AlertTriangle },
      { key: "approvals", label: `Approvals(${counts.approvals})`, icon: CheckCircle },
      { key: "tasks", label: `Tasks(${counts.tasks})`, icon: User },
      { key: "meetings", label: `Meetings(${counts.meetings})`, icon: Calendar },
      { key: "communications", label: `Communications(${counts.communications})`, icon: Mail },
      { key: "reports", label: `Reports(${counts.reports})`, icon: FileBarChart },
      { key: "assets", label: `Assets(${counts.assets})`, icon: Package },
      { key: "feedback", label: `Feedback(${counts.feedback})`, icon: Mail },
      { key: "mentions", label: `Mentions(${counts.mentions})`, icon: MessageSquare },
    ],
    [counts]
  )

  const filteredData = useMemo(() => {
    return notifications.filter((n) => {
      if (activeTab === "all") return true
      if (activeTab === "unread") return !n.read
      if (activeTab === "critical") return n.priority === "high" || n.priority === "urgent"
      return n.category === activeTab
    })
  }, [activeTab, notifications])

  const columns: DataTableColumn<Notification>[] = useMemo(
    () => [
      {
        key: "read",
        label: "",
        accessor: (n) => (n.read ? "read" : "unread"),
        width: "70px",
        render: (n) =>
          n.read ? null : (
            <Badge variant="default" className="capitalize">
              New
            </Badge>
          ),
      },
      {
        key: "title",
        label: "Notification",
        sortable: true,
        resizable: true,
        initialWidth: 420,
        accessor: (n) => n.title,
        render: (n) => (
          <div className="flex flex-col">
            <span className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</span>
            <span className="text-muted-foreground line-clamp-1 text-xs">{n.message}</span>
          </div>
        ),
      },
      {
        key: "category",
        label: "Category",
        sortable: true,
        accessor: (n) => n.category,
        render: (n) => (
          <Badge variant="outline" className="capitalize">
            {n.category}
          </Badge>
        ),
        hideOnMobile: true,
      },
      {
        key: "priority",
        label: "Priority",
        sortable: true,
        accessor: (n) => n.priority,
        render: (n) => (
          <Badge variant="outline" className={cn("capitalize", getPriorityBadgeClass(n.priority))}>
            {n.priority}
          </Badge>
        ),
        hideOnMobile: true,
      },
      {
        key: "timestamp",
        label: "Time",
        sortable: true,
        accessor: (n) => n.created_at,
        render: (n) => (
          <span className="text-muted-foreground text-xs whitespace-nowrap">{formatRelativeTime(n.created_at)}</span>
        ),
        hideOnMobile: true,
      },
    ],
    []
  )

  const filters: DataTableFilter<Notification>[] = useMemo(
    () => [
      {
        key: "priority",
        label: "Priority",
        options: [
          { value: "urgent", label: "Urgent" },
          { value: "high", label: "High" },
          { value: "normal", label: "Normal" },
          { value: "low", label: "Low" },
        ],
      },
      {
        key: "category",
        label: "Category",
        options: Array.from(new Set(notifications.map((n) => n.category).filter(Boolean))).map((category) => ({
          value: category,
          label: category,
        })),
      },
      {
        key: "read",
        label: "Read State",
        options: [
          { value: "true", label: "Read" },
          { value: "false", label: "Unread" },
        ],
        mode: "custom",
        filterFn: (row, selected) => selected.includes(String(row.read)),
      },
    ],
    [notifications]
  )

  const rowActions = useMemo<RowAction<Notification>[]>(
    () => [
      {
        label: "Open",
        icon: ChevronRight,
        onClick: (n) => openNotification(n),
        hidden: (n) => !n.action_url,
      },
      {
        label: "Mark Read",
        icon: CheckCheck,
        onClick: (n) => void markAsRead(n.id),
        hidden: (n) => n.read,
      },
      {
        label: "Mark Unread",
        icon: Clock,
        onClick: (n) => void markAsUnread(n.id),
        hidden: (n) => !n.read,
      },
      {
        label: "Delete",
        icon: Trash2,
        variant: "destructive",
        onClick: (n) => void deleteNotification(n.id),
      },
    ],
    [deleteNotification, markAsRead, markAsUnread, openNotification]
  )

  const refreshNotifications = useCallback(() => {
    setIsLoading(true)
    router.refresh()
    setTimeout(() => {
      setIsLoading(false)
      toast.success("Notifications refreshed")
    }, 900)
  }, [router])

  return (
    <DataTablePage
      title="Notifications"
      description="Stay updated with your tasks, assets, approvals, and mentions."
      icon={Bell}
      backLink={{ href: "/profile", label: "Back to Dashboard" }}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      spacing="tight"
      actions={
        <div className="flex gap-1.5">
          <Link href="/notifications/settings">
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={refreshNotifications} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4 sm:mr-2", isLoading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void markAllAsRead()} disabled={counts.unread === 0}>
            <CheckCheck className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Mark all read</span>
          </Button>
        </div>
      }
    >
      <DataTable<Notification>
        data={filteredData}
        columns={columns}
        getRowId={(n) => n.id}
        searchPlaceholder="Search title, message, actor..."
        searchFn={(n, q) => `${n.title} ${n.message} ${n.actor_name || ""} ${n.category}`.toLowerCase().includes(q)}
        filters={filters}
        isLoading={isLoading}
        rowActions={rowActions}
        pagination={{ pageSize: 50 }}
        stickyToolbar
        viewToggle
        contactsView
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (n) =>
            !n.read && (n.priority === "urgent" || n.priority === "high") ? "bg-rose-500" : undefined,
          leading: (n) => {
            const Icon = TYPE_ICONS[n.type as NotificationType] || Info
            return (
              <span className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <Icon className="h-4 w-4" />
              </span>
            )
          },
          title: (n) => n.title,
          subtitle: (n) => n.message,
          trailing: (n) =>
            !n.read ? (
              <Badge variant="default" className="text-[10px]">
                New
              </Badge>
            ) : (
              <span className="text-muted-foreground text-[10px] whitespace-nowrap">
                {formatRelativeTime(n.created_at)}
              </span>
            ),
          detail: {
            title: (n) => n.title,
            subtitle: (n) => <span className="text-muted-foreground text-xs">{formatRelativeTime(n.created_at)}</span>,
            badges: (n) => (
              <>
                {!n.read && (
                  <Badge variant="default" className="text-[10px]">
                    New
                  </Badge>
                )}
                <Badge variant="outline" className={cn("text-[10px] capitalize", getPriorityBadgeClass(n.priority))}>
                  {n.priority}
                </Badge>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {n.category}
                </Badge>
              </>
            ),
            fields: (n) => [
              { icon: Bell, label: "Message", value: n.message },
              ...(n.actor_name ? [{ icon: User, label: "From", value: n.actor_name }] : []),
              { icon: Calendar, label: "Received", value: formatWATDate(n.created_at) },
            ],
            actions: (n) => [
              ...(n.action_url
                ? [
                    {
                      label: "Open",
                      icon: ChevronRight,
                      variant: "default" as const,
                      onClick: () => void openNotification(n),
                    },
                  ]
                : []),
              ...(n.read
                ? [
                    {
                      label: "Mark unread",
                      icon: Clock,
                      variant: "outline" as const,
                      onClick: () => void markAsUnread(n.id),
                    },
                  ]
                : [
                    {
                      label: "Mark read",
                      icon: CheckCheck,
                      variant: "outline" as const,
                      onClick: () => void markAsRead(n.id),
                    },
                  ]),
              {
                label: "Delete",
                icon: Trash2,
                variant: "destructive" as const,
                onClick: () => void deleteNotification(n.id),
              },
            ],
          },
        }}
        cardRenderer={(n) => {
          const iconKey = n.type as NotificationType
          const Icon = TYPE_ICONS[iconKey] || Info
          const typeBg = TYPE_CARD_BG[iconKey] || "bg-slate-50/50 dark:bg-slate-950/10"
          return (
            <div
              className={cn(
                "group hover:border-primary relative flex cursor-pointer flex-col gap-3 rounded-xl border-2 p-4 transition-all",
                typeBg,
                n.read && "opacity-70"
              )}
              onClick={() => void openNotification(n)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="bg-background flex h-9 w-9 shrink-0 items-center justify-center rounded-full border">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex flex-1 flex-col truncate">
                  <span className={cn("truncate text-sm", !n.read && "font-bold")}>{n.title}</span>
                  <span className="text-muted-foreground mt-1 line-clamp-2 text-xs">{n.message}</span>
                </div>
                {n.action_url && (
                  <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
                )}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex gap-2">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {n.category}
                  </Badge>
                  {!n.read && (
                    <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                      New
                    </Badge>
                  )}
                </div>
                <span className="text-muted-foreground text-[10px]">{formatRelativeTime(n.created_at)}</span>
              </div>
            </div>
          )
        }}
        urlSync
      />
    </DataTablePage>
  )
}
