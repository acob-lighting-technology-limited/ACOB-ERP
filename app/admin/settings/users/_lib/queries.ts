import { formatWATDate } from "@/lib/utils/date"

export interface User {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string
  admin_routes?: string[] | null
  department: string | null
  is_active: boolean
  employment_status: string
  created_at: string
  last_sign_in?: string | null
}

export interface UsersSettingsData {
  users: User[]
  currentUserRole: string
}

export async function fetchUsersSettingsData(): Promise<UsersSettingsData> {
  // Scoped server route resolves admin scope and reads via the service role.
  const res = await fetch("/api/admin/settings/users", { cache: "no-store" })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error || "Failed to load users")
  return { users: (json.users || []) as User[], currentUserRole: json.currentUserRole || "" }
}

export async function fetchAllUsersForPicker(): Promise<User[]> {
  const res = await fetch("/api/admin/settings/users?picker=1", { cache: "no-store" })
  if (!res.ok) return []
  const json = await res.json()
  return (json.users || []) as User[]
}

export function formatDate(date: string) {
  return formatWATDate(date, { year: "numeric", month: "short", day: "numeric" })
}
