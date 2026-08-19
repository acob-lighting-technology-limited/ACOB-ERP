import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { AssetsContent } from "./assets-content"

import { logger } from "@/lib/logger"

const log = logger("assets")

export interface Asset {
  id: string
  unique_code: string
  asset_type: string
  asset_model?: string
  serial_number?: string
  status: string
  acquisition_year?: number
  assignment_type?: "individual" | "department" | "office"
  department?: string
  office_location?: string
}

export interface AssetAssignment {
  id: string
  assigned_at: string
  assignment_notes?: string
  assigned_by: string
  asset: Asset
  assigner?: {
    first_name: string
    last_name: string
  }
  department?: string
}

type AssetsPageClient = Awaited<ReturnType<typeof createClient>>

type IndividualAssignmentRow = {
  id: string
  assigned_at: string
  assignment_notes?: string | null
  assigned_by?: string | null
  asset_id: string
  department?: string | null
}

const isDefined = <T,>(value: T | null | undefined): value is T => value != null

async function getAssetsData() {
  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase as AssetsPageClient)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  let loadError: string | null = null

  // Fetch individual assignments only
  const { data: individualAssignments, error: individualError } = await dataClient
    .from("asset_assignments")
    .select(
      `
      id,
      assigned_at,
      assignment_notes,
      assigned_by,
      asset_id,
      department
    `
    )
    .eq("assigned_to", user.id)
    .eq("is_current", true)
    .order("assigned_at", { ascending: false })

  if (individualError) {
    log.error("Error loading individual assignments:", individualError)
    loadError = "Failed to load some asset data"
  }

  const assignmentsList = (individualAssignments || []) as IndividualAssignmentRow[]

  // Fetch Asset and assigner details for individual assignments
  const assignmentsWithDetails = await Promise.all(
    assignmentsList.map(async (assignment) => {
      const [assetResult, assignerResult] = await Promise.all([
        dataClient
          .from("assets")
          .select("id, unique_code, asset_type, asset_model, serial_number, status, acquisition_year")
          .eq("id", assignment.asset_id)
          .is("deleted_at", null)
          .single(),
        assignment.assigned_by
          ? dataClient.from("profiles").select("first_name, last_name").eq("id", assignment.assigned_by).single()
          : Promise.resolve({ data: null }),
      ])

      return {
        ...assignment,
        asset: assetResult.data,
        assigner: assignerResult.data,
      }
    })
  )

  const assignments = assignmentsWithDetails
    .map((entry): AssetAssignment | null => {
      if (!entry.asset) return null

      return {
        id: entry.id,
        assigned_at: entry.assigned_at,
        assignment_notes: entry.assignment_notes || undefined,
        assigned_by: entry.assigned_by || "",
        asset: entry.asset,
        assigner: entry.assigner || undefined,
        department: entry.department || undefined,
      }
    })
    .filter(isDefined)

  return {
    assignments,
    loadError,
  }
}

export default async function AssetsPage() {
  const data = await getAssetsData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const assetsData = data as { assignments: AssetAssignment[]; loadError?: string | null }

  return <AssetsContent initialAssignments={assetsData.assignments} initialError={assetsData.loadError} />
}
