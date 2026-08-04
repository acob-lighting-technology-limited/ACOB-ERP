"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { EmploymentStatus } from "@/types/database"
import { Circle, AlertTriangle, XCircle, Clock, FileText } from "lucide-react"

interface EmployeeStatusBadgeProps {
  status: EmploymentStatus
  showIcon?: boolean
  size?: "sm" | "default" | "lg"
  className?: string
}

const statusConfig: Record<
  EmploymentStatus,
  {
    label: string
    variant: "default" | "secondary" | "destructive" | "outline"
    color: string
    bgColor: string
    icon: typeof Circle
  }
> = {
  active: {
    label: "Active",
    variant: "default",
    color: "text-green-700 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/50 border-green-200 dark:border-green-800",
    icon: Circle,
  },
  suspended: {
    label: "Suspended",
    variant: "secondary",
    color: "text-amber-700 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/50 border-amber-200 dark:border-amber-800",
    icon: AlertTriangle,
  },
  exited: {
    label: "Exited",
    variant: "destructive",
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-100 dark:bg-red-900/50 border-red-200 dark:border-red-800",
    icon: XCircle,
  },
  on_leave: {
    label: "On Leave",
    variant: "outline",
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/50 border-blue-200 dark:border-blue-800",
    icon: Clock,
  },
  contract: {
    label: "Contract",
    variant: "secondary",
    color: "text-purple-700 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/50 border-purple-200 dark:border-purple-800",
    icon: FileText,
  },
}

const sizeClasses = {
  sm: "text-xs px-1.5 py-0.5",
  default: "text-xs px-2 py-1",
  lg: "text-sm px-2.5 py-1",
}

export function EmployeeStatusBadge({
  status,
  showIcon = true,
  size = "default",
  className,
}: EmployeeStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.active
  const Icon = config.icon

  return (
    <Badge
      variant="outline"
      className={cn("border font-medium", config.bgColor, config.color, sizeClasses[size], className)}
    >
      {showIcon && <Icon className={cn("mr-1", size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5")} />}
      {config.label}
    </Badge>
  )
}

export function getStatusColor(status: EmploymentStatus): string {
  return statusConfig[status]?.color || statusConfig.active.color
}

export function getStatusLabel(status: EmploymentStatus): string {
  return statusConfig[status]?.label || "Unknown"
}
