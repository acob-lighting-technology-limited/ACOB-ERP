"use client"

import type { AdminRouteKeyV2 } from "@/lib/admin/policy-v2"

interface RouteEntry {
  key: AdminRouteKeyV2
  label: string
}

interface RouteGroup {
  label: string
  routes: RouteEntry[]
}

export const ADMIN_ROUTE_GROUPS: RouteGroup[] = [
  {
    label: "HR",
    routes: [
      { key: "hr.main", label: "Employees & HR" },
      { key: "jobdescriptions.main", label: "Job Descriptions" },
      { key: "hr.fleet", label: "Fleet Management" },
      { key: "hr.resources", label: "Learning Resources" },
      { key: "hr.pms.cbt.manage", label: "CBT / Assessments" },
    ],
  },
  {
    label: "Finance",
    routes: [
      { key: "finance.main", label: "Finance" },
      { key: "purchasing.main", label: "Purchasing" },
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
      { key: "reports.other", label: "Other Reports" },
    ],
  },
  {
    label: "Tasks",
    routes: [{ key: "tasks.main", label: "Tasks" }],
  },
  {
    label: "Communications",
    routes: [
      { key: "communications.main", label: "Communications" },
      { key: "communications.broadcast", label: "Broadcasts" },
      { key: "communications.meetings", label: "Meetings" },
      { key: "helpdesk.main", label: "Help Desk" },
      { key: "notifications.main", label: "Notifications" },
      { key: "correspondence.main", label: "Correspondence" },
      { key: "documentation.main", label: "Documentation" },
      { key: "feedback.main", label: "Feedback" },
      { key: "tools.main", label: "Tools" },
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
                <label key={route.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs">
                  <input
                    type="checkbox"
                    checked={values.includes(route.key)}
                    onChange={(e) => toggle(route.key, e.target.checked)}
                  />
                  {route.label}
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
