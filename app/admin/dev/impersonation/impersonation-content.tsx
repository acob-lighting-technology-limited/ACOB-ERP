"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Copy, UserRoundCog, Users, Building2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"

type ImpersonationRow = {
  id: string
  full_name: string
  company_email: string
  department: string
  role: string
  employment_status: string
}

type ImpersonationResponse = {
  data?: {
    directConfirmLink?: string | null
    actionLink?: string
    target?: {
      id: string
      full_name?: string | null
      company_email?: string | null
    }
  }
  error?: string
}

async function fetchTargets(): Promise<ImpersonationRow[]> {
  const response = await fetch("/api/admin/dev/impersonation", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to load users (${response.status})`)
  }
  return (payload?.data || []) as ImpersonationRow[]
}

async function startImpersonation(targetUserId: string): Promise<string> {
  const response = await fetch("/api/admin/dev/impersonation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      targetUserId,
      nextPath: "/profile",
    }),
  })

  const payload = (await response.json().catch(() => ({}))) as ImpersonationResponse
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to start impersonation")
  }

  const link = payload?.data?.directConfirmLink || payload?.data?.actionLink
  if (!link) throw new Error("Impersonation link was not returned")
  return link
}

async function copyLinkWithFallback(link: string): Promise<"copied" | "manual"> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(link)
      return "copied"
    }
  } catch {
    // Fall through to fallback methods.
  }

  try {
    const textarea = document.createElement("textarea")
    textarea.value = link
    textarea.setAttribute("readonly", "true")
    textarea.style.position = "fixed"
    textarea.style.top = "-9999px"
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    if (ok) return "copied"
  } catch {
    // Fall through to prompt fallback.
  }

  window.prompt("Copy login link", link)
  return "manual"
}

export function DevImpersonationContent() {
  const [linkingUserId, setLinkingUserId] = useState<string | null>(null)

  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dev-impersonation-targets"],
    queryFn: fetchTargets,
  })

  const roleOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.role).filter(Boolean)))
        .sort()
        .map((value) => ({ value, label: value })),
    [rows]
  )

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.department).filter(Boolean)))
        .sort()
        .map((value) => ({ value, label: value })),
    [rows]
  )

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.employment_status).filter(Boolean)))
        .sort()
        .map((value) => ({ value, label: value })),
    [rows]
  )

  const stats = useMemo(() => {
    const total = rows.length
    const active = rows.filter((row) => String(row.employment_status).toLowerCase() === "active").length
    const departments = new Set(rows.map((row) => row.department)).size
    const privileged = rows.filter((row) => ["developer", "super_admin", "admin"].includes(row.role)).length
    return { total, active, departments, privileged }
  }, [rows])

  const columns = useMemo<DataTableColumn<ImpersonationRow>[]>(
    () => [
      {
        key: "full_name",
        label: "Employee",
        accessor: (row) => row.full_name,
        sortable: true,
        render: (row) => (
          <div className="space-y-1">
            <p className="font-medium">{row.full_name}</p>
            <p className="text-muted-foreground text-xs">{row.company_email}</p>
          </div>
        ),
      },
      {
        key: "department",
        label: "Department",
        accessor: (row) => row.department,
        sortable: true,
      },
      {
        key: "role",
        label: "Role",
        accessor: (row) => row.role,
        sortable: true,
        render: (row) => <Badge variant="outline">{row.role}</Badge>,
      },
      {
        key: "employment_status",
        label: "Status",
        accessor: (row) => row.employment_status,
        sortable: true,
        render: (row) => (
          <Badge variant={String(row.employment_status).toLowerCase() === "active" ? "default" : "secondary"}>
            {row.employment_status}
          </Badge>
        ),
      },
      {
        key: "action",
        label: "Action",
        mode: "display",
        render: (row) => (
          <Button
            size="sm"
            disabled={Boolean(linkingUserId)}
            onClick={async () => {
              try {
                setLinkingUserId(row.id)
                const link = await startImpersonation(row.id)
                const mode = await copyLinkWithFallback(link)
                if (mode === "copied") {
                  toast.success(`Login link copied for ${row.full_name}`)
                } else {
                  toast.info("Clipboard blocked. Copy the link from the prompt.")
                }
              } catch (actionError) {
                toast.error(actionError instanceof Error ? actionError.message : "Failed to copy login link")
              } finally {
                setLinkingUserId(null)
              }
            }}
          >
            <Copy className="mr-2 h-4 w-4" />
            {linkingUserId === row.id ? "Generating..." : "Copy Login Link"}
          </Button>
        ),
      },
    ],
    [linkingUserId]
  )

  const filters = useMemo<DataTableFilter<ImpersonationRow>[]>(
    () => [
      { key: "department", label: "Department", options: departmentOptions },
      { key: "role", label: "Role", options: roleOptions },
      { key: "employment_status", label: "Status", options: statusOptions },
    ],
    [departmentOptions, roleOptions, statusOptions]
  )

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Users"
          value={stats.total}
          icon={Users}
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-500"
        />
        <StatCard
          title="Active"
          value={stats.active}
          icon={ShieldCheck}
          iconBgColor="bg-emerald-500/10"
          iconColor="text-emerald-500"
        />
        <StatCard
          title="Departments"
          value={stats.departments}
          icon={Building2}
          iconBgColor="bg-amber-500/10"
          iconColor="text-amber-500"
        />
        <StatCard
          title="Privileged Roles"
          value={stats.privileged}
          icon={UserRoundCog}
          iconBgColor="bg-violet-500/10"
          iconColor="text-violet-500"
        />
      </div>

      <DataTable<ImpersonationRow>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(row) => row.id}
        searchPlaceholder="Search by name, email, department, or role..."
        searchFn={(row, query) => {
          const q = query.toLowerCase()
          return (
            row.full_name.toLowerCase().includes(q) ||
            row.company_email.toLowerCase().includes(q) ||
            row.department.toLowerCase().includes(q) ||
            row.role.toLowerCase().includes(q)
          )
        }}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => {
          void refetch()
        }}
        viewToggle
        cardRenderer={(row) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div>
              <p className="font-medium">{row.full_name}</p>
              <p className="text-muted-foreground text-sm">{row.company_email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{row.department}</Badge>
              <Badge variant="outline">{row.role}</Badge>
              <Badge variant={String(row.employment_status).toLowerCase() === "active" ? "default" : "secondary"}>
                {row.employment_status}
              </Badge>
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={Boolean(linkingUserId)}
              onClick={async () => {
                try {
                  setLinkingUserId(row.id)
                  const link = await startImpersonation(row.id)
                  const mode = await copyLinkWithFallback(link)
                  if (mode === "copied") {
                    toast.success(`Login link copied for ${row.full_name}`)
                  } else {
                    toast.info("Clipboard blocked. Copy the link from the prompt.")
                  }
                } catch (actionError) {
                  toast.error(actionError instanceof Error ? actionError.message : "Failed to copy login link")
                } finally {
                  setLinkingUserId(null)
                }
              }}
            >
              <Copy className="mr-2 h-4 w-4" />
              {linkingUserId === row.id ? "Generating..." : "Copy Login Link"}
            </Button>
          </div>
        )}
        emptyTitle="No users found"
        emptyDescription="User profiles will appear here when available."
        emptyIcon={Users}
        urlSync
      />
    </div>
  )
}
