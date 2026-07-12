import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { ProjectAdminContent } from "./_components/project-admin-content"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Manage Projects | ACOB ERP",
  description: "Create, update, and track all company projects and their tasks.",
}

type DbClient = Awaited<ReturnType<typeof createClient>>

async function getAdminProjectsData() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase as DbClient)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  // Check admin authorization
  const scope = await resolveAdminScope(supabase as DbClient, user.id)
  if (!scope) {
    return { redirect: "/profile" as const }
  }

  // Fetch list of active employee profiles for assignment dropdowns
  const { data: profiles, error: profilesError } = await dataClient
    .from("profiles")
    .select("id, first_name, last_name, full_name, department")
    .neq("employment_status", "exited")
    .order("first_name", { ascending: true })

  if (profilesError) {
    console.error("Error loading profiles for project manager assignment:", profilesError)
  }

  return {
    profiles: profiles || [],
    userProfile: {
      id: user.id,
      role: scope.role,
      department: scope.department,
    },
  }
}

export default async function AdminProjectsPage() {
  const data = await getAdminProjectsData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const result = data as {
    profiles: Array<{
      id: string
      first_name: string | null
      last_name: string | null
      full_name: string | null
      department: string | null
    }>
    userProfile: { id: string; role: string; department: string | null }
  }

  return <ProjectAdminContent profiles={result.profiles} currentUser={result.userProfile} />
}
