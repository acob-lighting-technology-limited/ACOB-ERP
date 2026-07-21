import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { ProjectContent } from "./project-content"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Projects Dashboard | Matrix",
  description: "View and track ongoing electrification project deployment tasks and milestones.",
}

export default async function ProjectsPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  return <ProjectContent />
}
