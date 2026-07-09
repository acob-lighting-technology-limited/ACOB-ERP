import type { Role } from "./role-form-dialog"

export const DEFAULT_ROLES: Role[] = [
  {
    id: "1",
    name: "super_admin",
    description: "Full system access",
    permissions: [
      "users.view",
      "users.manage",
      "roles.manage",
      "hr.view",
      "hr.manage",
      "finance.view",
      "finance.manage",
      "inventory.view",
      "inventory.manage",
      "purchasing.view",
      "purchasing.manage",
      "settings.manage",
      "reports.view",
    ],
    is_system: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "2",
    name: "developer",
    description: "Developer-level access (matches Super Admin)",
    permissions: [
      "users.view",
      "users.manage",
      "roles.manage",
      "hr.view",
      "hr.manage",
      "finance.view",
      "finance.manage",
      "inventory.view",
      "inventory.manage",
      "purchasing.view",
      "purchasing.manage",
      "settings.manage",
      "reports.view",
    ],
    is_system: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "3",
    name: "admin",
    description: "Administrative access",
    permissions: ["users.view", "users.manage", "hr.view", "hr.manage", "finance.view", "reports.view"],
    is_system: true,
    created_at: new Date().toISOString(),
  },
  {
    id: "4",
    name: "employee",
    description: "Standard employee access",
    permissions: ["hr.view"],
    is_system: true,
    created_at: new Date().toISOString(),
  },
]

export async function fetchRolesData(): Promise<Role[]> {
  // Scoped server route resolves admin scope and reads via the service role;
  // the browser no longer queries Supabase directly (see AGENTS.md).
  const res = await fetch("/api/admin/settings/roles", { cache: "no-store" })
  if (!res.ok) {
    throw new Error(`Failed to load roles (${res.status})`)
  }
  const json = (await res.json()) as { data?: Role[] | null; fallback?: boolean; error?: string }
  if (json.error) throw new Error(json.error)
  if (json.fallback) return DEFAULT_ROLES
  return json.data ?? []
}
