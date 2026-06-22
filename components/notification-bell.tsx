"use client"

import { useEffect, useRef, useState } from "react"
import { logger } from "@/lib/logger"
import { formatWATDate } from "@/lib/utils/date"

const log = logger("notification-bell")
import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Bell,
  CheckCheck,
  Search,
  Settings,
  AlertCircle,
  CheckCircle,
  Info,
  User,
  Package,
  MessageSquare,
  FileText,
  AlertTriangle,
  ChevronRight,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { QUERY_KEYS } from "@/lib/query-keys"

interface Notification {
  id: string
  user_id: string
  type: string
  category: string
  priority: string
  title: string
  message: string
  data?: unknown
  action_url?: string | null
  actor_name?: string
  actor_avatar?: string
  read: boolean
  read_at?: string
  created_at: string
}

interface NotificationBellProps {
  isAdmin?: boolean
}

// Notification type icons
const typeIcons = {
  task_assigned: User,
  task_updated: AlertCircle,
  task_completed: CheckCircle,
  mention: MessageSquare,
  feedback: MessageSquare,
  asset_assigned: Package,
  approval_request: FileText,
  approval_granted: CheckCircle,
  system: Settings,
  announcement: AlertTriangle,
}

// Category icons
// Priority colors
const priorityColors = {
  low: "text-gray-500",
  normal: "text-blue-500",
  high: "text-orange-500",
  urgent: "text-red-500",
}

// Format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return "Just now"
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes}m ago`
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours}h ago`
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days}d ago`
  }
  if (diffInSeconds < 2592000) {
    const weeks = Math.floor(diffInSeconds / 604800)
    return `${weeks}w ago`
  }

  return formatWATDate(date, { month: "short", day: "numeric" })
}

// Get initials from name
function getInitials(name?: string): string {
  if (!name) return "?"
  const parts = name.split(" ")
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
}

export function NotificationBell({ isAdmin = false }: NotificationBellProps) {
  const router = useRouter()
  const [supabase] = useState<SupabaseClient>(() => createClient())
  const queryClient = useQueryClient()

  // State
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [isDeletingNotification, setIsDeletingNotification] = useState(false)

  // Real-time subscription ref
  const subscriptionRef = useRef<RealtimeChannel | null>(null)

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: QUERY_KEYS.notificationBell(),
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return []

      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50)

      if (error) throw new Error(error.message)
      return data || []
    },
  })

  // Setup real-time subscription
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notificationBell() })

    // Subscribe to real-time updates
    const setupSubscription = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      subscriptionRef.current = supabase
        .channel("notifications")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            // Invalidate query to refetch updated notifications
            queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notificationBell() })

            // Show toast for new notification
            if (payload.eventType === "INSERT") {
              toast.info(payload.new.title, {
                description: payload.new.message,
                action: payload.new.action_url
                  ? {
                      label: "View",
                      onClick: () => router.push(payload.new.action_url),
                    }
                  : undefined,
              })
            }
          }
        )
        .subscribe()
    }

    setupSubscription()

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
      }
    }
  }, [queryClient, router, supabase])

  // Refresh when dropdown opens
  useEffect(() => {
    if (isOpen) {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notificationBell() })
    }
  }, [isOpen, queryClient])

  // Mark as read
  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read: true, read_at: new Date().toISOString() })
        .eq("id", notificationId)

      if (error) throw error

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notificationBell() })
    } catch (error: unknown) {
      log.error("Error marking as read:", error)
    }
  }

  // Mark all as read
  const markAllAsRead = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { error } = await supabase.rpc("mark_notifications_read", {
        p_user_id: user.id,
        p_notification_ids: null,
      })

      if (error) throw error

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notificationBell() })
      toast.success("All notifications marked as read")
    } catch (error: unknown) {
      log.error("Error marking all as read:", error)
      toast.error("Failed to mark all as read")
    }
  }

  // Delete notification
  const deleteNotification = async (notificationId: string) => {
    try {
      const { error } = await supabase.from("notifications").delete().eq("id", notificationId)

      if (error) throw error

      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notificationBell() })
    } catch (error: unknown) {
      log.error("Error deleting notification:", error)
      toast.error("Failed to delete notification")
    }
  }

  // Handle notification click
  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read if not already
    if (!notification.read) {
      await markAsRead(notification.id)
    }

    // Navigate if there's a link
    if (notification.action_url) {
      setIsOpen(false)
      router.push(notification.action_url)
    }
  }

  // Filter notifications
  const filteredNotifications = notifications.filter((n) => {
    // Tab filter
    if (activeTab === "unread" && n.read) return false
    if (activeTab !== "all" && activeTab !== "unread" && n.category !== activeTab) return false

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        n.title.toLowerCase().includes(query) ||
        n.message.toLowerCase().includes(query) ||
        n.actor_name?.toLowerCase().includes(query)
      )
    }

    return true
  })

  // Calculate counts
  const unreadCount = notifications.filter((n) => !n.read).length
  const categoryCounts = {
    all: notifications.length,
    unread: unreadCount,
    tasks: notifications.filter((n) => n.category === "tasks").length,
    assets: notifications.filter((n) => n.category === "assets").length,
    feedback: notifications.filter((n) => n.category === "feedback").length,
    approvals: notifications.filter((n) => n.category === "approvals").length,
    mentions: notifications.filter((n) => n.category === "mentions").length,
    system: notifications.filter((n) => n.category === "system").length,
  }

  if (isLoading) {
    return null
  }

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            className="hover:bg-muted relative h-10 w-10 rounded-full transition-colors"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <Badge
                variant="destructive"
                className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center p-0 text-[10px] font-bold"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="w-[calc(100vw-2rem)] border-2 p-0 shadow-xl sm:w-[460px]"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Header */}
          <div className="bg-muted/30 flex items-center justify-between border-b p-3">
            <div className="flex items-center gap-2">
              <Bell className="text-foreground h-5 w-5" />
              <h3 className="text-base font-semibold">Notifications</h3>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="px-2 text-xs font-semibold">
                  {unreadCount} new
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={markAllAsRead}>
                  <CheckCheck className="mr-1 h-4 w-4" />
                  Mark all read
                </Button>
              )}

              <Link href={isAdmin ? "/admin/notifications" : "/notifications"}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Notification settings"
                  className="h-8 w-8"
                  onClick={() => setIsOpen(false)}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Search */}
          <div className="border-b p-2.5">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search notifications..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-9"
              />
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="h-auto w-full justify-start rounded-none border-b bg-transparent p-0">
              <TabsTrigger
                value="all"
                className="data-[state=active]:border-primary rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                All{" "}
                {categoryCounts.all > 0 && (
                  <Badge variant="secondary" className="ml-2 px-1.5 text-xs">
                    {categoryCounts.all}
                  </Badge>
                )}
              </TabsTrigger>

              <TabsTrigger
                value="unread"
                className="data-[state=active]:border-primary rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                Unread{" "}
                {categoryCounts.unread > 0 && (
                  <Badge variant="destructive" className="ml-2 px-1.5 text-xs">
                    {categoryCounts.unread}
                  </Badge>
                )}
              </TabsTrigger>

              {categoryCounts.mentions > 0 && (
                <TabsTrigger
                  value="mentions"
                  className="data-[state=active]:border-primary rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  <MessageSquare className="mr-1 h-4 w-4" />
                  Mentions{" "}
                  {categoryCounts.mentions > 0 && (
                    <Badge variant="secondary" className="ml-2 px-1.5 text-xs">
                      {categoryCounts.mentions}
                    </Badge>
                  )}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value={activeTab} className="mt-0">
              <ScrollArea className="h-[430px]">
                {filteredNotifications.length > 0 ? (
                  <div className="divide-y">
                    {filteredNotifications.map((notification) => {
                      const Icon = typeIcons[notification.type as keyof typeof typeIcons] || Info

                      return (
                        <div
                          key={notification.id}
                          className={cn(
                            "group hover:bg-muted/30 relative cursor-pointer px-3 py-2.5 transition-all",
                            !notification.read && "bg-blue-50/30 dark:bg-blue-950/10"
                          )}
                          onClick={() => handleNotificationClick(notification)}
                        >
                          <div className="flex gap-2.5">
                            {/* Actor Avatar or Icon */}
                            {notification.actor_avatar || notification.actor_name ? (
                              <Avatar className="h-8 w-8 shrink-0">
                                {notification.actor_avatar && (
                                  <AvatarImage src={notification.actor_avatar} alt={notification.actor_name} />
                                )}
                                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                                  {getInitials(notification.actor_name)}
                                </AvatarFallback>
                              </Avatar>
                            ) : (
                              <div
                                className={cn(
                                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                                  "bg-muted",
                                  priorityColors[notification.priority as keyof typeof priorityColors]
                                )}
                              >
                                <Icon className="h-4 w-4" />
                              </div>
                            )}

                            {/* Content */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1">
                                  <p className={cn("text-sm leading-tight", !notification.read && "font-semibold")}>
                                    {notification.title}
                                  </p>
                                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
                                    {notification.message}
                                  </p>

                                  {/* Link indicator */}
                                  {notification.action_url && (
                                    <div className="text-primary mt-0.5 flex items-center gap-1 text-xs font-medium">
                                      View details
                                      <ChevronRight className="h-3 w-3" />
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                                    {formatRelativeTime(notification.created_at)}
                                  </span>
                                </div>
                              </div>

                              {/* Action buttons (hidden, show on hover) */}
                              <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                {!notification.read && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[11px]"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      markAsRead(notification.id)
                                    }}
                                  >
                                    <CheckCheck className="mr-1 h-3 w-3" />
                                    Mark read
                                  </Button>
                                )}

                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10 h-6 px-2 text-[11px]"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setPendingDeleteId(notification.id)
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center px-4 py-16">
                    <div className="bg-muted mb-4 rounded-full p-4">
                      <Bell className="text-muted-foreground h-12 w-12 opacity-50" />
                    </div>
                    <p className="text-foreground mb-1 text-sm font-semibold">
                      {searchQuery ? "No matching notifications" : "No notifications"}
                    </p>
                    <p className="text-muted-foreground max-w-sm text-center text-xs">
                      {searchQuery
                        ? "Try adjusting your search terms"
                        : "You're all caught up! We'll notify you when something important happens."}
                    </p>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>

          {/* Footer */}
          <DropdownMenuSeparator className="my-0" />
          <div className="bg-muted/20 p-3">
            <Link
              href={isAdmin ? "/admin/notifications" : "/notifications"}
              onClick={() => setIsOpen(false)}
              className="text-primary block w-full py-1 text-center text-xs font-medium hover:underline"
            >
              View all notifications →
            </Link>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingNotification) setPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete notification</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this notification? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingNotification}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              loading={isDeletingNotification}
              onClick={async () => {
                if (pendingDeleteId) {
                  setIsDeletingNotification(true)
                  try {
                    await deleteNotification(pendingDeleteId)
                    setPendingDeleteId(null)
                  } finally {
                    setIsDeletingNotification(false)
                  }
                }
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
