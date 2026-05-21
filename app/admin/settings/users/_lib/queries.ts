import { createClient } from "@/lib/supabase/client"

export interface User {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string
  admin_domains?: string[] | null
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
  const supabase = createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("id, company_email, first_name, last_name, role, admin_domains, department, employment_status, created_at")
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users = (data || []).map((u: any) => ({
    ...u,
    email: u.company_email,
    is_active: u.employment_status === "active",
    employment_status: u.employment_status || "active",
  }))

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()
  let currentUserRole = ""
  if (currentUser?.id) {
    const { data: me } = await supabase.from("profiles").select("role").eq("id", currentUser.id).single()
    currentUserRole = me?.role || ""
  }

  return { users, currentUserRole }
}

export async function fetchAllUsersForPicker(): Promise<User[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from("profiles")
    .select("id, company_email, first_name, last_name, role, department, employment_status, created_at")
    .eq("employment_status", "active")
    .order("first_name")

  if (!data) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((u: any) => ({
    ...u,
    email: u.company_email,
    is_active: u.employment_status === "active",
    employment_status: u.employment_status || "active",
  }))
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" })
}
