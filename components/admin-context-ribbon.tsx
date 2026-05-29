"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { ArrowLeftRight, Filter, Shield } from "lucide-react"
import type { UserRole } from "@/types/database"
import { getRoleDisplayName } from "@/lib/permissions"
import type { AdminScopeMode } from "@/lib/admin/rbac"

interface AdminContextRibbonProps {
  role: UserRole
  department?: string | null
  scopeMode: AdminScopeMode
  isAdminLike?: boolean
  managedDepartments?: string[]
}

export function AdminContextRibbon({
  role,
  department: _department,
  scopeMode,
  isAdminLike = false,
  managedDepartments = [],
}: AdminContextRibbonProps) {
  const isAdminLeadMode = scopeMode === "lead"
  const isPureLead = !isAdminLike && managedDepartments.length > 0
  const isRestricted = isAdminLeadMode || isPureLead

  const roleLabel = getRoleDisplayName(role)
  const consoleTitle = isRestricted ? "Department Console" : `${roleLabel} Console`

  return (
    <div className="sticky top-16 z-20 border-b border-[var(--admin-sidebar-border)] bg-[var(--admin-ribbon-bg)] px-4 py-2 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Console title badge — always visible */}
        <Badge
          variant="outline"
          className="border-[var(--admin-badge-border)] bg-[var(--admin-badge-bg)] text-[var(--admin-primary)]"
        >
          {isPureLead ? <Shield className="mr-1 h-3 w-3" /> : <Filter className="mr-1 h-3 w-3" />}
          {consoleTitle}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/profile"
            className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs font-medium"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span className="sm:hidden">User View</span>
            <span className="hidden sm:inline">Switch to User View</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
