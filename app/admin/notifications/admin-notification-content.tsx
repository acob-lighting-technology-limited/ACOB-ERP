"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  Bell,
  AlertCircle,
  CheckCircle,
  Info,
  CheckCheck,
  User,
  Package,
  AlertTriangle,
  Clock,
  ChevronRight,
  CreditCard,
  CalendarClock,
  RefreshCw,
  Mail,
  Megaphone,
} from "lucide-react"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab, RowAction } from "@/components/ui/data-table"

export interface DynamicNotification {
  id: string
  type: "info" | "warning" | "success" | "error"
  category: string
  title: string
  message: string
  timestamp: string
  link?: string
  linkText?: string
  read: boolean
  priority: "low" | "normal" | "high" | "urgent"
}

// Type icons
const typeIcons = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle,
  error: AlertCircle,
}

// Type colors
const typeColors = {
  info: "bg-blue-50/50 dark:bg-blue-950/10",
  warning: "bg-yellow-50/50 dark:bg-yellow-950/10",
  success: "bg-green-50/50 dark:bg-green-950/10",
  error: "bg-red-50/50 dark:bg-red-950/10",
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

interface AdminNotificationContentProps {
  initialNotifications: DynamicNotification[]
}

export function AdminNotificationContent({ initialNotifications }: AdminNotificationContentProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<DynamicNotification[]>(initialNotifications)
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("all")
  const [readIds, setReadIds] = useState<Set<string>>(
    () => new Set(initialNotifications.filter((n) => n.read).map((n) => n.id))
  )

  useEffect(() => {
    setNotifications(initialNotifications)
    setReadIds(new Set(initialNotifications.filter((n) => n.read).map((n) => n.id)))
  }, [initialNotifications])

  const categoryCounts = useMemo(() => {
    return {
      all: notifications.length,
      unread: notifications.filter((n) => !readIds.has(n.id)).length,
      users: notifications.filter((n) => n.category === "users").length,
      tasks: notifications.filter((n) => n.category === "tasks").length,
      payments: notifications.filter((n) => n.category === "payments").length,
      leave: notifications.filter((n) => n.category === "leave").length,
      assets: notifications.filter((n) => n.category === "assets").length,
      feedback: notifications.filter((n) => n.category === "feedback").length,
      critical: notifications.filter((n) => n.priority === "high" || n.priority === "urgent").length,
    }
  }, [notifications, readIds])

  const tabs: DataTableTab[] = useMemo(
    () => [
      { key: "all", label: `All(${categoryCounts.all})`, icon: Bell },
      { key: "unread", label: `Unread(${categoryCounts.unread})`, icon: Clock },
      { key: "critical", label: `Critical(${categoryCounts.critical})`, icon: AlertTriangle },
      { key: "users", label: `Users(${categoryCounts.users})`, icon: User },
      { key: "tasks", label: `Tasks(${categoryCounts.tasks})`, icon: Package },
      { key: "payments", label: `Payments(${categoryCounts.payments})`, icon: CreditCard },
      { key: "leave", label: `Leave(${categoryCounts.leave})`, icon: CalendarClock },
      { key: "assets", label: `Assets(${categoryCounts.assets})`, icon: Megaphone },
      { key: "feedback", label: `Feedback(${categoryCounts.feedback})`, icon: Mail },
    ],
    [categoryCounts]
  )

  const filteredData = useMemo(() => {
    return notifications.filter((n) => {
      if (activeTab === "all") return true
      if (activeTab === "unread") return !readIds.has(n.id)
      if (activeTab === "critical") return n.priority === "high" || n.priority === "urgent"
      return n.category === activeTab
    })
  }, [notifications, activeTab, readIds])

  const handleNotificationClick = useCallback(
    (notification: DynamicNotification) => {
      setReadIds((prev) => {
        const next = new Set(prev)
        next.add(notification.id)
        return next
      })
      if (notification.link) router.push(notification.link)
    },
    [router]
  )

  const columns: DataTableColumn<DynamicNotification>[] = useMemo(
    () => [
      {
        key: "read",
        label: "",
        accessor: (n) => (readIds.has(n.id) ? "read" : "unread"),
        width: "70px",
        render: (n) =>
          readIds.has(n.id) ? null : (
            <Badge variant="default" className="capitalize">
              New
            </Badge>
          ),
      },
      {
        key: "type",
        label: "",
        accessor: (n) => n.type,
        width: "60px",
        render: (n) => {
          const Icon = typeIcons[n.type]
          return (
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full",
                n.type === "error"
                  ? "bg-red-100 text-red-600"
                  : n.type === "warning"
                    ? "bg-yellow-100 text-yellow-600"
                    : n.type === "success"
                      ? "bg-green-100 text-green-600"
                      : "bg-blue-100 text-blue-600"
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
          )
        },
      },
      {
        key: "title",
        label: "Notification",
        sortable: true,
        resizable: true,
        initialWidth: 400,
        accessor: (n) => n.title,
        render: (n) => {
          const isRead = readIds.has(n.id)
          return (
            <div className="flex flex-col">
              <span className={cn("group-hover:text-primary text-sm transition-colors", !isRead && "font-semibold")}>
                {n.title}
              </span>
              <span className="text-muted-foreground line-clamp-1 text-xs">{n.message}</span>
            </div>
          )
        },
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
        accessor: (n) => n.timestamp,
        render: (n) => <span className="text-muted-foreground text-xs whitespace-nowrap">{n.timestamp}</span>,
        hideOnMobile: true,
      },
    ],
    [readIds]
  )

  const rowActions = useMemo<RowAction<DynamicNotification>[]>(
    () => [
      {
        label: "Open Link",
        icon: Bell,
        onClick: (n: DynamicNotification) => handleNotificationClick(n),
        hidden: (n: DynamicNotification) => !n.link,
      },
      {
        label: "Mark Read",
        icon: CheckCheck,
        onClick: (n: DynamicNotification) => {
          setReadIds((prev) => {
            const next = new Set(prev)
            next.add(n.id)
            return next
          })
        },
        hidden: (n: DynamicNotification) => readIds.has(n.id),
      },
      {
        label: "Mark Unread",
        icon: Clock,
        onClick: (n: DynamicNotification) => {
          setReadIds((prev) => {
            const next = new Set(prev)
            next.delete(n.id)
            return next
          })
        },
        hidden: (n: DynamicNotification) => !readIds.has(n.id),
      },
    ],
    [handleNotificationClick, readIds]
  )

  const filters: DataTableFilter<DynamicNotification>[] = useMemo(
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
        options: Array.from(new Set(notifications.map((n) => n.category))).map((c) => ({ value: c, label: c })),
      },
    ],
    [notifications]
  )

  const refreshNotifications = () => {
    setIsLoading(true)
    router.refresh()
    setTimeout(() => {
      setIsLoading(false)
      toast.success("Notifications refreshed")
    }, 1000)
  }

  return (
    <DataTablePage
      title="Notifications Center"
      description="Administrative alerts and system notifications requiring attention."
      icon={Bell}
      backLink={{ href: "/admin", label: "Back to Dashboard" }}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refreshNotifications} disabled={isLoading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setReadIds(new Set(notifications.map((n) => n.id)))}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        </div>
      }
    >
      <DataTable<DynamicNotification>
        data={filteredData}
        columns={columns}
        getRowId={(n) => n.id}
        searchPlaceholder="Search titles, messages, categories..."
        searchFn={(n, q) =>
          n.title.toLowerCase().includes(q) ||
          n.message.toLowerCase().includes(q) ||
          n.category.toLowerCase().includes(q)
        }
        filters={filters}
        isLoading={isLoading}
        rowActions={rowActions}
        pagination={{ pageSize: 50 }}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          accentClass: (n) =>
            n.type === "error"
              ? "bg-red-500"
              : n.type === "warning"
                ? "bg-amber-500"
                : n.type === "success"
                  ? "bg-emerald-500"
                  : "bg-blue-500",
          title: (n) => n.title,
          subtitle: (n) => `${n.category} · ${n.priority} · ${n.timestamp}`,
          trailing: (n) => (
            <Badge variant="outline" className={cn("text-[10px] capitalize", getPriorityBadgeClass(n.priority))}>
              {n.priority}
            </Badge>
          ),
          onSelect: (n) => handleNotificationClick(n),
        }}
        cardRenderer={(n) => {
          const Icon = typeIcons[n.type]
          const isRead = readIds.has(n.id)
          return (
            <div
              className={cn(
                "group hover:border-primary relative flex cursor-pointer flex-col gap-3 rounded-xl border-2 p-4 transition-all",
                typeColors[n.type],
                isRead && "opacity-60"
              )}
              onClick={() => handleNotificationClick(n)}
            >
              <div className="flex items-start justify-between gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                    n.type === "error"
                      ? "bg-red-100 text-red-600"
                      : n.type === "warning"
                        ? "bg-yellow-100 text-yellow-600"
                        : n.type === "success"
                          ? "bg-green-100 text-green-600"
                          : "bg-blue-100 text-blue-600"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex flex-1 flex-col truncate">
                  <span className={cn("truncate text-sm", !isRead && "font-bold")}>{n.title}</span>
                  <span className="text-muted-foreground mt-1 line-clamp-2 text-xs">{n.message}</span>
                </div>
                {n.link && (
                  <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
                )}
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex gap-2">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {n.category}
                  </Badge>
                  {n.priority !== "normal" && (
                    <Badge
                      variant="outline"
                      className={cn("px-1.5 py-0 text-[10px]", getPriorityBadgeClass(n.priority))}
                    >
                      {n.priority}
                    </Badge>
                  )}
                </div>
                <span className="text-muted-foreground text-[10px]">{n.timestamp}</span>
              </div>
            </div>
          )
        }}
        urlSync
      />
    </DataTablePage>
  )
}
