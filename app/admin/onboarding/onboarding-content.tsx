"use client"

import { useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { formatWATDateTime, formatWATRelative, toLocalISODate } from "@/lib/utils/date"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { StatCard } from "@/components/ui/stat-card"
import { QUERY_KEYS } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { Download, RefreshCw, Users, UserCheck, UserX } from "lucide-react"

export interface OnboardingRow {
  id: string
  employee_number: string | null
  full_name: string
  email: string
  additional_email: string | null
  department: string | null
  designation: string | null
  role: string
  employment_status: string
  has_signed_in: boolean
  last_sign_in_at: string | null
  first_sign_in_at: string | null
  sign_in_count: number
  last_auth_method: string | null
  email_confirmed: boolean
  account_created_at: string | null
  profile_created_at: string
}

interface OnboardingMeta {
  authSourceAvailable: boolean
  loginLogsAvailable: boolean
  total: number
}

interface OnboardingPayload {
  rows: OnboardingRow[]
  meta: OnboardingMeta | null
}

async function fetchOnboarding(): Promise<OnboardingPayload> {
  const response = await fetch("/api/admin/onboarding", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to load onboarding status (${response.status})`)
  }
  return {
    rows: (payload?.data || []) as OnboardingRow[],
    meta: (payload?.meta as OnboardingMeta | undefined) ?? null,
  }
}

function toCsv(rows: OnboardingRow[]) {
  const headers = [
    "employee_number",
    "name",
    "email",
    "department",
    "designation",
    "role",
    "employment_status",
    "signed_in",
    "first_sign_in",
    "last_sign_in",
    "sign_ins_recorded",
    "last_method",
    "email_confirmed",
    "account_created",
  ]
  const body = rows.map((row) => [
    row.employee_number || "",
    row.full_name,
    row.email,
    row.department || "",
    row.designation || "",
    row.role,
    row.employment_status,
    row.has_signed_in ? "yes" : "no",
    row.first_sign_in_at || "",
    row.last_sign_in_at || "",
    row.sign_in_count,
    row.last_auth_method || "",
    row.email_confirmed ? "yes" : "no",
    row.account_created_at || row.profile_created_at,
  ])
  return [headers, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n")
}

export function OnboardingContent() {
  const queryClient = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: QUERY_KEYS.adminOnboarding(),
    queryFn: fetchOnboarding,
  })

  const rows = useMemo(() => data?.rows ?? [], [data])
  const meta = data?.meta ?? null

  const stats = useMemo(() => {
    // Exited staff are gone, not "not yet onboarded" — excluded so they don't
    // inflate "Never Signed In" with people who will never sign in again.
    const current = rows.filter((row) => row.employment_status !== "exited")
    const total = current.length
    const onboardable = current.filter((row) => row.email && row.email.trim() !== "").length
    const signedIn = current.filter((row) => row.has_signed_in).length
    const neverSignedIn = onboardable - signedIn
    const rate = onboardable > 0 ? Math.round((signedIn / onboardable) * 100) : 0
    return { total, onboardable, signedIn, neverSignedIn, rate }
  }, [rows])

  const departmentOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.department).filter((dept): dept is string => Boolean(dept))))
        .sort()
        .map((dept) => ({ value: dept, label: dept })),
    [rows]
  )

  const roleOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.role).filter(Boolean)))
        .sort()
        .map((role) => ({ value: role, label: role.replace(/_/g, " ") })),
    [rows]
  )

  const employmentStatusOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.employment_status).filter(Boolean)))
        .sort()
        .map((status) => ({ value: status, label: status.replace(/_/g, " ") })),
    [rows]
  )

  const columns = useMemo<DataTableColumn<OnboardingRow>[]>(
    () => [
      {
        key: "full_name",
        label: "Person",
        sortable: true,
        accessor: (row) => row.full_name,
        resizable: true,
        initialWidth: 240,
        render: (row) => (
          <div className="space-y-1">
            <p className="font-medium">{row.full_name}</p>
            <p className="text-muted-foreground text-xs">{row.employee_number || "No employee number"}</p>
          </div>
        ),
      },
      {
        key: "email",
        label: "Email",
        sortable: true,
        accessor: (row) => row.email,
        resizable: true,
        initialWidth: 260,
        render: (row) => <span className="text-sm break-all">{row.email || "-"}</span>,
      },
      {
        key: "signed_in",
        label: "Sign-in Status",
        sortable: true,
        accessor: (row) => (row.has_signed_in ? "Signed in" : "Never signed in"),
        render: (row) =>
          row.has_signed_in ? (
            <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">Signed in</Badge>
          ) : (
            <Badge className="border-red-500/20 bg-red-500/10 text-red-600">Never signed in</Badge>
          ),
      },
      {
        key: "first_sign_in_at",
        label: "First Sign-in",
        sortable: true,
        accessor: (row) => row.first_sign_in_at || "",
        hideOnMobile: true,
        render: (row) =>
          row.first_sign_in_at ? (
            <span className="text-sm">{formatWATDateTime(row.first_sign_in_at)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "last_sign_in_at",
        label: "Last Sign-in",
        sortable: true,
        accessor: (row) => row.last_sign_in_at || "",
        hideOnMobile: true,
        render: (row) =>
          row.last_sign_in_at ? (
            <span className="text-sm">{formatWATDateTime(row.last_sign_in_at)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "department",
        label: "Department",
        sortable: true,
        accessor: (row) => row.department || "",
        hideOnMobile: true,
        render: (row) => row.department || "—",
      },

      {
        key: "employment_status",
        label: "Employment",
        sortable: true,
        accessor: (row) => row.employment_status,
        hideOnMobile: true,
        defaultVisible: false,
        render: (row) => <span className="capitalize">{row.employment_status.replace(/_/g, " ")}</span>,
      },
    ],
    []
  )

  const filters = useMemo<DataTableFilter<OnboardingRow>[]>(
    () => [
      {
        key: "signed_in",
        label: "Sign-in Status",
        options: [
          { value: "Signed in", label: "Signed in" },
          { value: "Never signed in", label: "Never signed in" },
        ],
      },
      {
        key: "department",
        label: "Department",
        options: departmentOptions,
      },
      {
        key: "role",
        label: "Role",
        options: roleOptions,
      },
      {
        key: "employment_status",
        label: "Employment Status",
        options: employmentStatusOptions,
        defaultValues: ["active", "contract"],
      },
      {
        key: "has_email",
        label: "Email Presence",
        options: [
          { value: "With Email", label: "With Email" },
          { value: "Without Email", label: "Without Email" },
        ],
        defaultValues: ["With Email"],
        filterFn: (row, selected) =>
          selected.includes(row.email && row.email.trim() !== "" ? "With Email" : "Without Email"),
      },
    ],
    [departmentOptions, employmentStatusOptions, roleOptions]
  )

  const exportCsv = () => {
    const csv = toCsv(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `onboarding-status-${toLocalISODate(new Date())}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <DataTablePage
      title="Onboarding"
      description="Every staff profile, including not-yet-onboarded placeholders, and whether the person has ever signed in."
      icon={UserCheck}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminOnboarding() })}
            disabled={isLoading}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <StatCard
            variant="compact"
            title="Profiles"
            value={stats.total}
            icon={Users}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
            description="All profile records, including not-yet-onboarded placeholders"
          />
          <StatCard
            variant="compact"
            title="Onboardable"
            value={stats.onboardable}
            icon={UserCheck}
            iconBgColor="bg-indigo-500/10"
            iconColor="text-indigo-500"
            description="Have an email and can sign in"
          />
          <StatCard
            variant="compact"
            title="Signed In"
            value={stats.signedIn}
            icon={UserCheck}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
            description={`${stats.rate}% of onboardable`}
          />
          <StatCard
            variant="compact"
            title="Never Signed In"
            value={stats.neverSignedIn}
            icon={UserX}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
            description="Onboardable but haven't logged in yet"
          />
        </div>
      }
    >
      <div className="space-y-4">
        {meta && !meta.authSourceAvailable ? (
          <p className="text-muted-foreground text-xs">
            The auth service could not be read, so sign-in status falls back to in-app login logs only. Anyone whose
            last sign-in predates login logging will be shown as never signed in.
          </p>
        ) : null}

        <DataTable<OnboardingRow>
          data={rows}
          columns={columns}
          filters={filters}
          getRowId={(row) => row.id}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search name, email, employee number, or department..."
          searchFn={(row, query) => {
            const q = query.toLowerCase()
            return (
              row.full_name.toLowerCase().includes(q) ||
              row.email.toLowerCase().includes(q) ||
              (row.additional_email || "").toLowerCase().includes(q) ||
              (row.employee_number || "").toLowerCase().includes(q) ||
              (row.department || "").toLowerCase().includes(q) ||
              (row.designation || "").toLowerCase().includes(q)
            )
          }}
          isLoading={isLoading}
          error={error instanceof Error ? error.message : null}
          onRetry={() => {
            void refetch()
          }}
          expandable={{
            render: (row) => (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">First Recorded Sign-in</p>
                  <p className="mt-2 text-sm">
                    {row.first_sign_in_at ? formatWATDateTime(row.first_sign_in_at) : "Not recorded"}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Recorded Sign-ins</p>
                  <p className="mt-2 text-sm">
                    {row.sign_in_count}
                    {row.last_auth_method ? ` · last via ${row.last_auth_method}` : ""}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Account Created</p>
                  <p className="mt-2 text-sm">{formatWATDateTime(row.account_created_at || row.profile_created_at)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Role</p>
                  <p className="mt-2 text-sm">
                    <Badge variant="outline">{row.role.replace(/_/g, " ")}</Badge>
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Designation</p>
                  <p className="mt-2 text-sm">{row.designation || "—"}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Additional Email</p>
                  <p className="mt-2 text-sm break-all">{row.additional_email || "—"}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Email Confirmed</p>
                  <p className="mt-2 text-sm">{row.email_confirmed ? "Yes" : "No"}</p>
                </div>
              </div>
            ),
          }}
          viewToggle
          contactsView
          stickyToolbar
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            accentClass: (row) => (row.has_signed_in ? "bg-emerald-500" : "bg-red-500"),
            title: (row) => row.full_name,
            subtitle: (row) =>
              `${row.email || "No email"} · ${row.department || "No dept"} · ${row.employee_number || "No ID"}`,
            trailing: (row) =>
              row.has_signed_in ? (
                <Badge className="border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-600">
                  Signed in
                </Badge>
              ) : (
                <Badge className="border-red-500/20 bg-red-500/10 text-[10px] text-red-600">Never</Badge>
              ),
          }}
          cardRenderer={(row) => (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{row.full_name}</p>
                  <p className="text-muted-foreground text-sm break-all">{row.email}</p>
                </div>
                {row.has_signed_in ? (
                  <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-600">Signed in</Badge>
                ) : (
                  <Badge className="border-red-500/20 bg-red-500/10 text-red-600">Never</Badge>
                )}
              </div>
              <div className="grid gap-1 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Department</span>
                  <span>{row.department || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last sign-in</span>
                  <span>{row.last_sign_in_at ? formatWATRelative(row.last_sign_in_at) : "—"}</span>
                </div>
              </div>
            </div>
          )}
          emptyTitle="No accounts found"
          emptyDescription="Staff accounts will appear here once profiles exist."
          emptyIcon={Users}
          skeletonRows={8}
          urlSync
        />
      </div>
    </DataTablePage>
  )
}
