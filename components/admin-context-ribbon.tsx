"use client"

import Link from "next/link"
import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeftRight, Filter, Shield } from "lucide-react"
import type { UserRole } from "@/types/database"
import { getRoleDisplayName } from "@/lib/permissions"
import type { AdminScopeMode } from "@/lib/admin/rbac"

interface AdminContextRibbonProps {
  role: UserRole
  department?: string | null
  scopeMode: AdminScopeMode
  isAdminLike?: boolean
  canToggleLeadScope: boolean
  managedDepartments?: string[]
}

export function AdminContextRibbon({
  role,
  department: _department,
  scopeMode,
  isAdminLike = false,
  canToggleLeadScope,
  managedDepartments = [],
}: AdminContextRibbonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // An admin in lead mode toggled it on; a pure lead is always restricted
  const isAdminLeadMode = scopeMode === "lead"
  const isPureLead = !isAdminLike && managedDepartments.length > 0
  const isRestricted = isAdminLeadMode || isPureLead

  const roleLabel = getRoleDisplayName(role)
  const deptLabel = managedDepartments.length > 0 ? managedDepartments.join(" & ") : null
  const consoleTitle = isPureLead
    ? `${deptLabel ?? "Department"} Lead Console`
    : isAdminLeadMode
      ? `${deptLabel ?? "Lead"} Scope — ${roleLabel}`
      : `${roleLabel} Console`

  function toggleScopeMode() {
    const nextMode: AdminScopeMode = isAdminLeadMode ? "global" : "lead"
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/scope-mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: nextMode }),
        })
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) throw new Error(payload?.error || "Failed to switch scope")
        toast.success(nextMode === "lead" ? "Lead scope enabled" : "Global scope restored")
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to switch scope")
      }
    })
  }

  return (
    <div
      className="sticky top-16 z-20 border-b border-[var(--admin-sidebar-border)] bg-[var(--admin-ribbon-bg)] px-4 py-2 md:px-6"
      style={isRestricted ? { borderLeft: "3px solid var(--admin-primary)" } : undefined}
    >
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
          {/* Toggle button — only shown to admins who are also leads */}
          {canToggleLeadScope ? (
            <Button
              size="sm"
              variant={isAdminLeadMode ? "default" : "outline"}
              onClick={toggleScopeMode}
              disabled={isPending}
              className="h-7 gap-1.5 px-2 text-xs"
              title={isAdminLeadMode ? "Switch to Admin View" : "Switch to Lead View"}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <span className="sm:hidden">{isAdminLeadMode ? "Admin View" : "Lead View"}</span>
              <span className="hidden sm:inline">
                {isAdminLeadMode ? "Switch to Admin View" : "Switch to Lead View"}
              </span>
            </Button>
          ) : null}

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
