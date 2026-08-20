"use client"

import type { AdminRouteKeyV2 } from "@/lib/admin/policy-v2"

interface RouteEntry {
  key: AdminRouteKeyV2
  label: string
  /** Optional clarifier shown under the label — used when one grant covers several sidebar pages. */
  hint?: string
}

interface RouteGroup {
  label: string
  routes: RouteEntry[]
}

export const ADMIN_ROUTE_GROUPS: RouteGroup[] = [
  {
    label: "HR",
    routes: [
      {
        key: "hr.main",
        label: "Employees & HR",
        hint: "Employees, Departments, Office Location & Performance (also covers Leave & Attendance)",
      },
      { key: "hr.leave", label: "Leave" },
      { key: "hr.attendance", label: "Attendance" },
      { key: "hr.fleet", label: "Resource Booking", hint: "Shared Resource Booking" },
      { key: "hr.pms", label: "PMS", hint: "Includes everything under PMS (CBT / Assessments, etc.)" },
      { key: "jobdescriptions.main", label: "Job Descriptions", hint: "Standalone module" },
    ],
  },
  {
    label: "Accounts",
    routes: [
      { key: "accounts.main", label: "Accounts", hint: "Payments, Bills, Invoices, Requisitions & Reports" },
      { key: "purchasing.main", label: "Purchasing", hint: "Orders, Receipts & Suppliers" },
      { key: "payroll.main", label: "Payroll", hint: "Payroll periods & entries — salary data" },
    ],
  },
  {
    label: "Assets",
    routes: [
      { key: "assets.main", label: "Assets" },
      { key: "assets.issues", label: "Asset Issues" },
      { key: "inventory.main", label: "Inventory" },
    ],
  },
  {
    label: "Reports",
    routes: [
      { key: "reports.weekly", label: "Weekly Reports" },
      { key: "reports.other", label: "Other Reports", hint: "General Meeting, KSS, Minutes, Action Tracker" },
    ],
  },
  {
    label: "Tasks",
    routes: [
      { key: "tasks.main", label: "Tasks" },
      { key: "helpdesk.main", label: "Help Desk" },
    ],
  },
  {
    label: "Communications",
    routes: [
      { key: "communications.main", label: "Overview", hint: "Communications landing page" },
      { key: "communications.broadcast", label: "Broadcasts" },
      { key: "communications.meetings", label: "Meetings", hint: "Meeting mail & reminders" },
      { key: "notifications.main", label: "Notifications" },
      { key: "correspondence.main", label: "Correspondence" },
      { key: "documentation.main", label: "Documentation" },
      { key: "feedback.main", label: "Feedback" },
    ],
  },
  {
    label: "Others",
    routes: [
      { key: "tools.main", label: "Tools" },
      { key: "settings.main", label: "Settings", hint: "Users, Roles, Company, Mail & Maintenance" },
      { key: "auditlogs.main", label: "Audit Logs" },
    ],
  },
]

interface AdminRoutesPickerProps {
  values: string[]
  onChange: (values: string[]) => void
}

export function AdminRoutesPicker({ values, onChange }: AdminRoutesPickerProps) {
  function toggle(key: string, checked: boolean) {
    const next = new Set(values)
    if (checked) {
      next.add(key)
    } else {
      next.delete(key)
    }
    onChange(Array.from(next))
  }

  function toggleGroup(group: RouteGroup, checked: boolean) {
    const groupKeys = group.routes.map((r) => r.key)
    const next = new Set(values)
    if (checked) {
      groupKeys.forEach((k) => next.add(k))
    } else {
      groupKeys.forEach((k) => next.delete(k))
    }
    onChange(Array.from(next))
  }

  function isGroupAll(group: RouteGroup) {
    return group.routes.every((r) => values.includes(r.key))
  }

  function isGroupPartial(group: RouteGroup) {
    return group.routes.some((r) => values.includes(r.key)) && !isGroupAll(group)
  }

  return (
    <div className="space-y-2">
      {ADMIN_ROUTE_GROUPS.map((group) => {
        const allSelected = isGroupAll(group)
        const partial = isGroupPartial(group)
        return (
          <div key={group.label} className="rounded-md border p-3">
            <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = partial
                }}
                onChange={(e) => toggleGroup(group, e.target.checked)}
              />
              {group.label}
            </label>
            <div className="ml-4 grid grid-cols-2 gap-1">
              {group.routes.map((route) => (
                <label key={route.key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={values.includes(route.key)}
                    onChange={(e) => toggle(route.key, e.target.checked)}
                  />
                  <span className="flex flex-col">
                    <span>{route.label}</span>
                    {route.hint && (
                      <span className="text-muted-foreground text-[10px] leading-tight">{route.hint}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
