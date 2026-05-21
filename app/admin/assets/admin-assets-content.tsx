"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { formatName } from "@/lib/utils"
import { isAssignableProfile } from "@/lib/workforce/assignment-policy"
import { ASSET_TYPES, ASSET_TYPE_MAP } from "@/lib/asset-types"
import { getDepartmentForOffice } from "@/lib/office-locations"
import { assignmentValidation } from "@/lib/validation"
import { Package, AlertCircle, Plus, Download, History, Pencil, RefreshCw, Wrench } from "lucide-react"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"

import { logger } from "@/lib/logger"

import { AssetFormDialog } from "@/components/assets/AssetFormDialog"
import { AssetAssignDialog } from "@/components/assets/AssetAssignDialog"
import { AssetHistoryDialog } from "@/components/assets/AssetHistoryDialog"
import { AssetIssuesDialog } from "@/components/assets/AssetIssuesDialog"
import { AssetTypeDialog } from "@/components/assets/AssetTypeDialog"
import { AssetExportDialog } from "@/components/assets/AssetExportDialog"
import { EmployeeAssetsReportDialog } from "@/components/assets/EmployeeAssetsReportDialog"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import {
  buildAssetExportRows,
  exportAssetsToExcel,
  exportAssetsToPDF,
  exportAssetsToWord,
  exportEmployeeReportToExcel,
  exportEmployeeReportToPDF,
  exportEmployeeReportToWord,
} from "@/lib/assets/asset-export"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("assets-admin-assets-content")

async function fetchAssetTypes(): Promise<{ label: string; code: string; requiresSerialModel: boolean }[]> {
  const response = await fetch("/api/admin/assets/types", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    log.warn("Could not load asset types from API:", payload?.error || response.status)
    return ASSET_TYPES
  }

  const payload = (await response.json()) as {
    data?: { label: string; code: string; requires_serial_model?: boolean | null }[]
  }
  const data = payload?.data || []
  if (data.length > 0) {
    return data.map((t) => ({
      label: t.label,
      code: t.code,
      requiresSerialModel: t.requires_serial_model || false,
    }))
  }
  return ASSET_TYPES
}

export interface Asset {
  id: string
  unique_code: string
  asset_type: string
  acquisition_year: number
  asset_model?: string
  serial_number?: string
  status: string
  notes?: string
  created_at: string
  created_by: string
  assignment_type?: "individual" | "department" | "office"
  department?: string
  office_location?: string
  current_assignment?: {
    assigned_to?: string
    department?: string
    office_location?: string
    assignment_type?: "individual" | "department" | "office" | string
    user?: {
      first_name: string
      last_name: string
    }
  }
  issues?: AssetIssue[]
  unresolved_issues_count?: number
  deleted_at?: string | null
  deleted_by?: string | null
  delete_reason?: string | null
}

interface AssetIssue {
  id: string
  asset_id: string
  description: string
  resolved: boolean
  created_at: string
  resolved_at?: string
  resolved_by?: string
  created_by: string
}

export interface Employee {
  id: string
  first_name: string
  last_name: string
  company_email: string
  department: string
  employment_status?: string | null
}

interface AssetAssignment {
  id: string
  assigned_to?: string
  department?: string
  office_location?: string
  assignment_type?: string
  assigned_at: string
  is_current: boolean
  user?: {
    first_name: string
    last_name: string
  }
}

type AssignableAsset = {
  status: string
  assignment_type?: string
  department?: string
  office_location?: string
  current_assignment?: {
    assigned_to?: string
    department?: string
    office_location?: string
    assignment_type?: string
    user?: {
      first_name: string
      last_name: string
    }
  }
}

type ProfileNameRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
}

interface AssetActivity {
  id: string
  timestamp: string
  type: "assignment" | "unassignment" | "status_change" | "issue_reported" | "issue_resolved"
  title: string
  description?: string
  user_name?: string
  performed_by_name?: string
  details?: {
    assigned_to?: string
    department?: string
    office_location?: string
    assignment_type?: string
    notes?: string
    status?: string
    old_status?: string
  }
}

const currentYear = new Date().getFullYear()

export interface UserProfile {
  role: string
  admin_domains?: string[] | null
  is_department_lead?: boolean
  lead_departments?: string[]
  managed_departments?: string[]
  managed_offices?: string[]
}

interface AdminAssetsContentProps {
  initialAssets: Asset[]
  initialEmployees: Employee[]
  initialDepartments: string[]
  userProfile: UserProfile
  initialError?: string | null
}

export function AdminAssetsContent({
  initialAssets,
  initialEmployees,
  initialDepartments,
  userProfile,
  initialError,
}: AdminAssetsContentProps) {
  const router = useRouter()
  const normalizedRole = String(userProfile?.role || "")
    .trim()
    .toLowerCase()
  const adminDomains = Array.isArray(userProfile?.admin_domains)
    ? userProfile.admin_domains.map((domain) => String(domain).trim().toLowerCase())
    : []
  const canCreateAssetType =
    normalizedRole === "developer" ||
    normalizedRole === "super_admin" ||
    (normalizedRole === "admin" && adminDomains.includes("assets"))
  const [assets, setAssets] = useState<Asset[]>(initialAssets)
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees)
  const activeEmployees = employees.filter((member) => isAssignableProfile(member, { allowLegacyNullStatus: false }))
  const [departments] = useState<string[]>(initialDepartments)
  const [isLoading, setIsLoading] = useState(false)

  // Export dialog state
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportType, setExportType] = useState<"excel" | "pdf" | "word" | null>(null)
  const [selectedColumns, setSelectedColumns] = useState<Record<string, boolean>>({
    "#": true,
    "Unique Code": true,
    "Asset Type": true,
    Model: true,
    "Serial Number": true,
    Year: true,
    Status: true,
    "Assigned To": true,
    Department: true,
    "Office Location": true,
    Issues: true,
  })

  // Employee Assets Report dialog state
  const [employeeReportDialogOpen, setEmployeeReportDialogOpen] = useState(false)
  const [employeeReportExportType, setEmployeeReportExportType] = useState<"excel" | "pdf" | "word" | null>(null)
  const [employeeReportSelectedTypes, setEmployeeReportSelectedTypes] = useState<Record<string, boolean>>({})
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)

  // Dialog states
  const [isAssetDialogOpen, setIsAssetDialogOpen] = useState(false)
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isIssuesDialogOpen, setIsIssuesDialogOpen] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null)
  const [isAssigning, setIsAssigning] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [assetHistory, setAssetHistory] = useState<AssetActivity[]>([])

  // Issue tracking states
  const [assetIssues, setAssetIssues] = useState<AssetIssue[]>([])
  const [newIssueDescription, setNewIssueDescription] = useState("")
  const [isAddingIssue, setIsAddingIssue] = useState(false)

  // Asset type creation states
  const [isCreateAssetTypeDialogOpen, setIsCreateAssetTypeDialogOpen] = useState(false)
  const [newAssetType, setNewAssetType] = useState({ label: "", code: "", requiresSerialModel: false })
  const [isCreatingAssetType, setIsCreatingAssetType] = useState(false)
  const [assetTypes, setAssetTypes] =
    useState<{ label: string; code: string; requiresSerialModel: boolean }[]>(ASSET_TYPES)
  const [batchQuantity, setBatchQuantity] = useState(1)
  const [filteredAssetsForExport, setFilteredAssetsForExport] = useState<Asset[]>([])

  interface AssetFormState {
    asset_type: string
    acquisition_year: number
    asset_model: string
    serial_number: string
    unique_code: string
    status: string
    notes: string
    assignment_type: "individual" | "department" | "office"
    assigned_to: string
    assignment_department: string
    office_location: string
    assignment_notes: string
    assigned_by: string
    assigned_at: string
  }

  // Track original form values for change detection
  const [originalAssetForm, setOriginalAssetForm] = useState<AssetFormState>({
    asset_type: "",
    acquisition_year: currentYear,
    asset_model: "",
    serial_number: "",
    unique_code: "",
    status: "available",
    notes: "",
    assignment_type: "individual",
    assigned_to: "",
    assignment_department: "",
    office_location: "",
    assignment_notes: "",
    assigned_by: "",
    assigned_at: "",
  })

  // Form states
  const [assetForm, setAssetForm] = useState<AssetFormState>({
    asset_type: "",
    acquisition_year: currentYear,
    asset_model: "",
    serial_number: "",
    unique_code: "",
    status: "available",
    notes: "",
    assignment_type: "individual",
    assigned_to: "",
    assignment_department: "",
    office_location: "",
    assignment_notes: "",
    assigned_by: "",
    assigned_at: "",
  })

  interface AssignFormState {
    assignment_type: "individual" | "department" | "office"
    assigned_to: string
    department: string
    office_location: string
    assignment_notes: string
    assigned_by: string
    assigned_at: string
  }

  const [assignForm, setAssignForm] = useState<AssignFormState>({
    assignment_type: "individual",
    assigned_to: "",
    department: "",
    office_location: "",
    assignment_notes: "",
    assigned_by: "",
    assigned_at: "",
  })

  const [currentAssignment, setCurrentAssignment] = useState<AssetAssignment | null>(null)

  const supabase = createClient()
  const scopedDepartments = useMemo(
    () => userProfile.managed_departments ?? userProfile.lead_departments ?? [],
    [userProfile.lead_departments, userProfile.managed_departments]
  )
  const scopedOffices = useMemo(() => userProfile.managed_offices ?? [], [userProfile.managed_offices])

  const queryClient = useQueryClient()

  const { data: fetchedAssetTypes } = useQuery({
    queryKey: QUERY_KEYS.adminAssetTypes(),
    queryFn: fetchAssetTypes,
    initialData: ASSET_TYPES,
  })

  // Keep assetTypes in sync with query result
  useEffect(() => {
    if (fetchedAssetTypes) {
      setAssetTypes(fetchedAssetTypes)
    }
  }, [fetchedAssetTypes])

  useEffect(() => {
    if (initialError) {
      toast.error(initialError)
    }
  }, [initialError])

  const handleCreateAssetType = async () => {
    if (!canCreateAssetType) {
      toast.error("You do not have permission to create asset types")
      return
    }

    if (!newAssetType.label.trim() || !newAssetType.code.trim()) {
      toast.error("Please provide both full name and short name")
      return
    }

    // Validate code format (should be uppercase, no spaces)
    const code = newAssetType.code.trim().toUpperCase().replace(/\s+/g, "")
    if (!code) {
      toast.error("Short name must contain at least one character")
      return
    }

    setIsCreatingAssetType(true)
    try {
      const response = await fetch("/api/admin/assets/types", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          label: newAssetType.label.trim(),
          code,
          requiresSerialModel: newAssetType.requiresSerialModel,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string; code?: string } | null
        if (response.status === 409 || payload?.code === "23505") {
          toast.error("An asset type with this name or code already exists")
        } else if (response.status === 403) {
          toast.error("You do not have permission to create asset types")
        } else if (response.status === 401) {
          toast.error("You must be logged in to create asset types")
        } else {
          throw new Error(payload?.error || "Failed to create asset type")
        }
        return
      }

      toast.success("Asset type created successfully")
      setNewAssetType({ label: "", code: "", requiresSerialModel: false })
      setIsCreateAssetTypeDialogOpen(false)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.adminAssetTypes() })
      // Auto-select the newly created asset type
      setAssetForm({ ...assetForm, asset_type: code })
    } catch (error: unknown) {
      log.error("Error creating asset type:", error)
      const message = error instanceof Error ? error.message : "Unknown error"
      toast.error("Failed to create asset type: " + message)
    } finally {
      setIsCreatingAssetType(false)
    }
  }

  const loadData = async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/admin/assets/snapshot", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      })

      if (!response.ok) {
        throw new Error(`Failed to refresh assets (${response.status})`)
      }

      const payload = (await response.json()) as { assets: Asset[]; employees: Employee[] }
      setAssets(payload.assets || [])
      setEmployees(payload.employees || [])
    } catch (error: unknown) {
      log.error("Error loading data:", error)
      toast.error("Failed to refresh data")
    } finally {
      setIsLoading(false)
    }
  }

  const loadAssetHistory = async (asset: Asset) => {
    try {
      // 1. Fetch Assignments
      const { data: assignments, error: assignmentsError } = await supabase
        .from("asset_assignments")
        .select(
          "id, assigned_at, handed_over_at, assignment_notes, handover_notes, assigned_by, assigned_to, department, office_location, assignment_type"
        )
        .eq("asset_id", asset.id)

      if (assignmentsError) throw assignmentsError

      // 2. Fetch Issues
      const { data: issues, error: issuesError } = await supabase
        .from("asset_issues")
        .select("id, description, resolved, created_at, resolved_at, created_by, resolved_by")
        .eq("asset_id", asset.id)

      if (issuesError) throw issuesError

      // 3. Fetch Status Changes from Audit Logs
      const { data: auditLogs, error: auditError } = await supabase
        .from("audit_logs")
        .select("id, operation, old_values, new_values, created_at, user_id")
        .eq("table_name", "assets")
        .eq("record_id", asset.id)
        .eq("operation", "UPDATE")

      if (auditError) throw auditError

      // 4. Resolve User Names
      const userIds = new Set<string>()
      assignments?.forEach((a) => {
        if (a.assigned_by) userIds.add(a.assigned_by)
        if (a.assigned_to) userIds.add(a.assigned_to)
      })
      issues?.forEach((i) => {
        if (i.created_by) userIds.add(i.created_by)
        if (i.resolved_by) userIds.add(i.resolved_by)
      })
      auditLogs?.forEach((l) => {
        if (l.user_id) userIds.add(l.user_id)
      })

      let usersMap = new Map<string, ProfileNameRow>()
      if (userIds.size > 0) {
        const { data: usersData } = await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", Array.from(userIds))
        if (usersData) usersMap = new Map((usersData as ProfileNameRow[]).map((u) => [u.id, u] as const))
      }

      const getUName = (id: string | null | undefined) => {
        if (!id) return null
        const u = usersMap.get(id)
        return u ? `${formatName(u.first_name)} ${formatName(u.last_name)}` : "System"
      }

      // 5. Transform into unified Activity list
      const activities: AssetActivity[] = []

      // Add Assignments & Handovers
      assignments?.forEach((a) => {
        // The Assignment itself
        activities.push({
          id: `${a.id}-assign`,
          timestamp: a.assigned_at,
          type: "assignment",
          title: "Asset Assigned",
          user_name: a.assigned_to
            ? getUName(a.assigned_to) || a.department || a.office_location || "Office"
            : a.department || a.office_location || "Office",
          performed_by_name: getUName(a.assigned_by) || "System Admin",
          details: {
            notes: a.assignment_notes,
            assignment_type: a.assignment_type,
          },
        })

        // The Handover/Return (if closed)
        if (a.handed_over_at) {
          activities.push({
            id: `${a.id}-return`,
            timestamp: a.handed_over_at,
            type: "unassignment",
            title: "Asset Returned / Unassigned",
            user_name: a.assigned_to
              ? getUName(a.assigned_to) || a.department || a.office_location || "Office"
              : a.department || a.office_location || "Office",
            details: {
              notes: a.handover_notes,
            },
          })
        }
      })

      // Add Issues
      issues?.forEach((i) => {
        activities.push({
          id: `${i.id}-issue`,
          timestamp: i.created_at,
          type: "issue_reported",
          title: "Issue Reported",
          description: i.description,
          performed_by_name: getUName(i.created_by) || "System Admin",
        })

        if (i.resolved && i.resolved_at) {
          activities.push({
            id: `${i.id}-resolved`,
            timestamp: i.resolved_at,
            type: "issue_resolved",
            title: "Issue Resolved",
            performed_by_name: getUName(i.resolved_by) || "System Admin",
          })
        }
      })

      // Add Status Changes (filter for meaningful changes)
      auditLogs?.forEach((l) => {
        const oldStatus = l.old_values?.status
        const newStatus = l.new_values?.status
        if (newStatus && oldStatus !== newStatus) {
          activities.push({
            id: l.id,
            timestamp: l.created_at,
            type: "status_change",
            title: `Status Changed: ${formatName(newStatus)}`,
            performed_by_name: getUName(l.user_id) || "System Admin",
            details: {
              old_status: oldStatus,
              status: newStatus,
            },
          })
        }
      })

      // Sort chronological (descending)
      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

      setAssetHistory(activities)
      setSelectedAsset(asset)
      setIsHistoryOpen(true)
    } catch (error: unknown) {
      log.error("Error loading asset history:", error)
      const message = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to load history: ${message}`)
    }
  }

  const loadAssetIssues = async (assetId: string) => {
    try {
      const { data, error } = await supabase
        .from("asset_issues")
        .select("*")
        .eq("asset_id", assetId)
        .order("created_at", { ascending: false })

      if (error) throw error
      setAssetIssues(data || [])
    } catch (error: unknown) {
      log.error("Error loading asset issues:", error)
      toast.error("Failed to load asset issues")
    }
  }

  const handleAddIssue = async () => {
    if (!newIssueDescription.trim() || !selectedAsset || isAddingIssue) return

    setIsAddingIssue(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setIsAddingIssue(false)
        return
      }

      const { error } = await supabase.from("asset_issues").insert({
        asset_id: selectedAsset.id,
        description: newIssueDescription.trim(),
        created_by: user.id,
      })

      if (error) throw error

      toast.success("Issue added")
      setNewIssueDescription("")
      await loadAssetIssues(selectedAsset.id)
      await loadData() // Refresh to update issue counts
    } catch (error: unknown) {
      log.error("Error adding issue:", error)
      toast.error("Failed to add issue")
    } finally {
      setIsAddingIssue(false)
    }
  }

  const handleToggleIssue = async (issue: AssetIssue) => {
    try {
      const { error } = await supabase.from("asset_issues").update({ resolved: !issue.resolved }).eq("id", issue.id)

      if (error) throw error

      toast.success(issue.resolved ? "Issue marked as unresolved" : "Issue marked as resolved")
      if (selectedAsset) {
        await loadAssetIssues(selectedAsset.id)
      }
      await loadData() // Refresh to update issue counts
    } catch (error: unknown) {
      log.error("Error toggling issue:", error)
      toast.error("Failed to update issue")
    }
  }

  const handleDeleteIssue = async (issueId: string) => {
    try {
      const { error } = await supabase.from("asset_issues").delete().eq("id", issueId)

      if (error) throw error

      toast.success("Issue deleted")
      if (selectedAsset) {
        await loadAssetIssues(selectedAsset.id)
      }
      await loadData() // Refresh to update issue counts
    } catch (error: unknown) {
      log.error("Error deleting issue:", error)
      toast.error("Failed to delete issue")
    }
  }

  const handleOpenAssetDialog = async (asset?: Asset) => {
    if (asset) {
      setBatchQuantity(1)
      setSelectedAsset(asset)

      // Fetch current assignment details if asset is assigned
      let assignmentDetails = {
        assigned_by: "",
        assigned_at: "",
        assigned_to: "",
        department: "",
        office_location: "",
        assignment_notes: "",
      }

      if (asset.status === "assigned" || asset.status === "retired" || asset.status === "maintenance") {
        const { data, error: assignmentFetchError } = await supabase
          .from("asset_assignments")
          .select("assigned_by, assigned_at, assigned_to, department, office_location, assignment_notes")
          .eq("asset_id", asset.id)
          .eq("is_current", true)
          .single()

        if (assignmentFetchError && assignmentFetchError.code !== "PGRST116") {
          log.error("Error fetching current assignment:", assignmentFetchError)
        }

        if (data) {
          assignmentDetails = {
            assigned_by: data.assigned_by || "",
            assigned_at: data.assigned_at ? new Date(data.assigned_at).toISOString().slice(0, 16) : "",
            assigned_to: data.assigned_to || "",
            department: data.department || "",
            office_location: data.office_location || "",
            assignment_notes: data.assignment_notes || "",
          }
        }
      }

      const formData = {
        asset_type: asset.asset_type,
        acquisition_year: asset.acquisition_year,
        asset_model: asset.asset_model || "",
        serial_number: asset.serial_number || "",
        unique_code: asset.unique_code,
        status: asset.status,
        notes: asset.notes || "",
        assignment_type: (asset.assignment_type as "individual" | "department" | "office") || "individual",
        assigned_to: assignmentDetails.assigned_to,
        assignment_department: assignmentDetails.department,
        office_location: assignmentDetails.office_location,
        assignment_notes: assignmentDetails.assignment_notes,
        assigned_by: assignmentDetails.assigned_by,
        assigned_at: assignmentDetails.assigned_at,
      }
      setAssetForm(formData)
      // Store original values for change detection
      setOriginalAssetForm({
        asset_type: asset.asset_type,
        acquisition_year: asset.acquisition_year,
        asset_model: asset.asset_model || "",
        serial_number: asset.serial_number || "",
        unique_code: asset.unique_code,
        status: asset.status,
        notes: asset.notes || "",
        // Include assignment details for change detection
        assignment_type: formData.assignment_type,
        assigned_to: formData.assigned_to,
        assignment_department: formData.assignment_department,
        office_location: formData.office_location,
        assignment_notes: formData.assignment_notes,
        assigned_by: formData.assigned_by,
        assigned_at: formData.assigned_at,
      })
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      setBatchQuantity(1)
      setSelectedAsset(null)
      setAssetForm({
        asset_type: "",
        acquisition_year: currentYear,
        asset_model: "",
        serial_number: "",
        unique_code: "",
        status: "available",
        notes: "",
        assignment_type: "individual",
        assigned_to: "",
        assignment_department: "",
        office_location: "",
        assignment_notes: "",
        assigned_by: user?.id || "",
        assigned_at: new Date().toISOString().slice(0, 16),
      })
      setOriginalAssetForm({
        asset_type: "",
        acquisition_year: currentYear,
        asset_model: "",
        serial_number: "",
        unique_code: "",
        status: "available",
        notes: "",
        assignment_type: "individual",
        assigned_to: "",
        assignment_department: "",
        office_location: "",
        assignment_notes: "",
        assigned_by: user?.id || "",
        assigned_at: new Date().toISOString().slice(0, 16),
      })
    }
    setIsAssetDialogOpen(true)
  }

  const handleOpenIssuesDialog = async (asset: Asset) => {
    setSelectedAsset(asset)
    await loadAssetIssues(asset.id)
    setNewIssueDescription("")
    setIsIssuesDialogOpen(true)
  }

  const handleSaveAsset = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      if (!assetForm.asset_type) {
        toast.error("Please select an asset type")
        setIsSaving(false)
        return
      }

      if (!selectedAsset) {
        if (!Number.isInteger(batchQuantity) || batchQuantity < 1 || batchQuantity > 100) {
          toast.error("Quantity must be between 1 and 100")
          setIsSaving(false)
          return
        }

        if (batchQuantity > 1 && String(assetForm.serial_number || "").trim()) {
          toast.error("For batch creation, leave Serial Number empty. You can edit each asset later if needed.")
          setIsSaving(false)
          return
        }
      }

      const response = await fetch("/api/admin/assets", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: selectedAsset ? "update" : "create",
          assetForm,
          quantity: selectedAsset ? 1 : batchQuantity,
          selectedAsset: selectedAsset ? { id: selectedAsset.id, status: selectedAsset.status } : null,
          originalAssetForm: selectedAsset
            ? {
                assigned_to: originalAssetForm.assigned_to,
                assignment_department: originalAssetForm.assignment_department,
                office_location: originalAssetForm.office_location,
              }
            : null,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save asset")
      }

      toast.success(payload?.message || (selectedAsset ? "Asset updated successfully" : "Asset created successfully"))

      setIsAssetDialogOpen(false)
      loadData()
    } catch (error: unknown) {
      log.error("Error saving asset:", error)
      const message = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to save asset: ${message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleAssignAsset = async () => {
    if (isAssigning) return
    setIsAssigning(true)
    try {
      if (!selectedAsset) {
        setIsAssigning(false)
        return
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setIsAssigning(false)
        return
      }

      // Validate
      const validationError = assignmentValidation.validateAssignment(
        assignForm.assignment_type,
        assignForm.assigned_to,
        assignForm.department,
        assignForm.office_location
      )
      if (validationError) {
        toast.error(validationError)
        setIsAssigning(false)
        return
      }

      // Use RPC for atomic reassignment
      const { error: rpcError } = await supabase.rpc("reassign_asset", {
        p_asset_id: selectedAsset.id,
        p_new_assignment_type: assignForm.assignment_type,
        p_assigned_to: assignForm.assigned_to || null,
        p_department: assignForm.department || null,
        p_office_location: assignForm.office_location || null,
        p_assigned_by: assignForm.assigned_by || user.id,
        p_assigned_at: assignForm.assigned_at
          ? new Date(assignForm.assigned_at).toISOString()
          : new Date().toISOString(),
        p_assignment_notes: assignForm.assignment_notes || null,
        p_handover_notes: "Reassigned",
        p_new_status: "assigned",
      })

      if (rpcError) throw rpcError

      toast.success("Asset reassigned successfully")
      setIsAssignDialogOpen(false)
      loadData()
    } catch (error: unknown) {
      log.error("Error assigning asset:", error)
      const message = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed: ${message}`)
    } finally {
      setIsAssigning(false)
    }
  }

  const handleDeleteAsset = async () => {
    if (isDeleting) return // Prevent duplicate submissions
    setIsDeleting(true)
    try {
      if (!assetToDelete) {
        setIsDeleting(false)
        return
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setIsDeleting(false)
        return
      }

      const isArchived = Boolean(assetToDelete.deleted_at)
      if (isArchived) {
        toast.error("Asset is already archived")
        setIsDeleting(false)
        return
      }

      // Only check for active assignments if the asset status is "assigned"
      if (assetToDelete.status === "assigned") {
        const { data: assignments } = await supabase
          .from("asset_assignments")
          .select("*")
          .eq("asset_id", assetToDelete.id)
          .eq("is_current", true)

        if (assignments && assignments.length > 0) {
          toast.error("Cannot archive asset with active assignments. Please return or reassign first.")
          setIsDeleting(false)
          return
        }
      }

      const { error } = await supabase
        .from("assets")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user.id,
          delete_reason: "Archived from Admin Assets",
          updated_at: new Date().toISOString(),
        })
        .eq("id", assetToDelete.id)

      if (error) throw error

      toast.success("Asset archived. You can restore it later.")
      setIsDeleteDialogOpen(false)
      setAssetToDelete(null)
      loadData()
    } catch (error: unknown) {
      log.error("Error archiving asset:", error)
      const errorMessage = error instanceof Error ? error.message : "Failed to archive asset"
      toast.error(`Failed to archive asset: ${errorMessage}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleRestoreAsset = async (asset: Asset) => {
    if (isDeleting) return
    setIsDeleting(true)
    try {
      const { error } = await supabase
        .from("assets")
        .update({
          deleted_at: null,
          deleted_by: null,
          delete_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", asset.id)

      if (error) throw error
      toast.success("Asset restored successfully")
      await loadData()
    } catch (error: unknown) {
      log.error("Error restoring asset:", error)
      const message = error instanceof Error ? error.message : "Unknown error"
      toast.error(`Failed to restore asset: ${message}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const openAssignDialog = async (asset: Asset) => {
    setSelectedAsset(asset)

    let assignmentState: AssetAssignment | null = null
    let assignedBy = ""
    let assignedAt = new Date().toISOString().slice(0, 16)
    const assignmentNotes = ""

    try {
      const { data: assignment } = await supabase
        .from("asset_assignments")
        .select("id, assigned_to, department, office_location, assignment_type, assigned_at, is_current")
        .eq("asset_id", asset.id)
        .eq("is_current", true)
        .maybeSingle<AssetAssignment>()

      if (assignment) {
        assignmentState = assignment
        assignedAt = assignment.assigned_at ? new Date(assignment.assigned_at).toISOString().slice(0, 16) : assignedAt
      }
    } catch (error) {
      log.error("Error loading current assignment:", error)
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    assignedBy = user?.id || ""

    setCurrentAssignment(assignmentState)
    setAssignForm({
      assignment_type:
        (asset.current_assignment?.assignment_type as "individual" | "department" | "office") ||
        (asset.assignment_type as "individual" | "department" | "office") ||
        "individual",
      assigned_to: asset.current_assignment?.assigned_to || "",
      department: asset.current_assignment?.department || asset.department || "",
      office_location: asset.current_assignment?.office_location || asset.office_location || "",
      assignment_notes: assignmentNotes,
      assigned_by: assignedBy,
      assigned_at: assignedAt,
    })
    setIsAssignDialogOpen(true)
  }

  const getEffectiveAssignmentType = (asset: AssignableAsset) =>
    (asset.current_assignment?.assignment_type || asset.assignment_type || "").toLowerCase()

  const getAssignedPersonName = (asset: AssignableAsset) => {
    const assignedId = asset.current_assignment?.assigned_to
    if (!assignedId) return null

    const assignmentUser = asset.current_assignment?.user
    const employeeUser = employees.find((member) => member.id === assignedId)
    const firstName = assignmentUser?.first_name || employeeUser?.first_name || ""
    const lastName = assignmentUser?.last_name || employeeUser?.last_name || ""
    const fullName = `${formatName(firstName)} ${formatName(lastName)}`.trim()

    return fullName || "Assigned User"
  }

  const getAssignedToLabel = (asset: AssignableAsset, withStatusSuffix = false) => {
    const isAssignedLike = asset.status === "assigned" || asset.status === "retired" || asset.status === "maintenance"
    if (!isAssignedLike) return "Unassigned"

    const statusSuffix =
      withStatusSuffix && (asset.status === "retired" || asset.status === "maintenance") ? ` (${asset.status})` : ""

    const assignmentType = getEffectiveAssignmentType(asset)
    if (assignmentType === "office") {
      return `${asset.current_assignment?.office_location || asset.office_location || "Office"}${statusSuffix}`
    }

    if (assignmentType === "department") {
      return `${asset.current_assignment?.department || asset.department || "Assigned Department"}${statusSuffix}`
    }

    const personName = getAssignedPersonName(asset)
    if (personName) return `${personName}${statusSuffix}`
    if (asset.current_assignment?.department) return `${asset.current_assignment.department}${statusSuffix}`

    return `Assigned${statusSuffix}`
  }

  const getCreatedByLabel = (createdBy: string) => {
    const creator = employees.find((employee) => employee.id === createdBy)
    if (!creator) return "Unknown user"

    const fullName = `${formatName(creator.first_name)} ${formatName(creator.last_name)}`.trim()
    return fullName || creator.company_email || "Unknown user"
  }

  // Export functions
  const handleExportClick = (type: "excel" | "pdf" | "word") => {
    setExportType(type)
    setExportDialogOpen(true)
  }

  const handleExportConfirm = async () => {
    const exportableAssets = filteredAssetsForExport
    const rows = buildAssetExportRows(
      exportableAssets,
      { selectedColumns, employees, getDepartmentForOffice },
      (asset, withStatus) => getAssignedToLabel(asset, withStatus)
    )
    const filename = `assets-export-${toLocalISODate()}`
    if (exportType === "excel") await exportAssetsToExcel(rows, filename)
    else if (exportType === "pdf") await exportAssetsToPDF(rows, filename, { total: exportableAssets.length })
    else if (exportType === "word") await exportAssetsToWord(rows, filename)
    setExportDialogOpen(false)
  }

  const handleEmployeeReportClick = (type: "excel" | "pdf" | "word") => {
    const availableTypes: Record<string, boolean> = {}
    assetTypes.forEach((t) => {
      availableTypes[t.code] = true
    })
    setEmployeeReportSelectedTypes(availableTypes)
    setEmployeeReportExportType(type)
    setEmployeeReportDialogOpen(true)
  }

  const handleEmployeeReportConfirm = async () => {
    const input = {
      employees,
      assets,
      selectedTypes: employeeReportSelectedTypes,
      assetTypeMap: ASSET_TYPE_MAP,
    }
    const filename = `employees-assets-report-${toLocalISODate()}`
    if (employeeReportExportType === "excel") await exportEmployeeReportToExcel(input, filename)
    else if (employeeReportExportType === "pdf") await exportEmployeeReportToPDF(input, filename)
    else if (employeeReportExportType === "word") await exportEmployeeReportToWord(input, filename)
    setEmployeeReportDialogOpen(false)
  }

  // Pre-filter by role scope (dept leads only see their scope; DataTable handles the rest)
  const scopedAssets = useMemo(() => {
    if (!userProfile?.is_department_lead) return assets
    if (scopedDepartments.length === 0 && scopedOffices.length === 0) return assets
    return assets.filter((asset) => {
      const assignmentDept = asset.current_assignment?.department
      const assignedUserDept = asset.current_assignment?.assigned_to
        ? employees.find((s) => s.id === asset.current_assignment?.assigned_to)?.department
        : null
      const assignmentOffice = asset.current_assignment?.office_location
      return (
        (assignmentDept ? scopedDepartments.includes(assignmentDept) : false) ||
        (assignedUserDept ? scopedDepartments.includes(assignedUserDept) : false) ||
        (assignmentOffice ? scopedOffices.includes(assignmentOffice) : false)
      )
    })
  }, [assets, employees, userProfile, scopedDepartments, scopedOffices])

  useEffect(() => {
    setFilteredAssetsForExport(scopedAssets)
  }, [scopedAssets])

  const stats = {
    total: assets.filter((d) => !d.deleted_at).length,
    available: assets.filter((d) => !d.deleted_at && d.status === "available").length,
    assigned: assets.filter((d) => !d.deleted_at && d.status === "assigned").length,
    maintenance: assets.filter((d) => !d.deleted_at && d.status === "maintenance").length,
    archived: assets.filter((d) => !!d.deleted_at).length,
    unresolvedIssues: assets
      .filter((d) => !d.deleted_at)
      .reduce((sum, asset) => sum + (asset.unresolved_issues_count || 0), 0),
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "assigned":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      case "available":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
      case "maintenance":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      case "retired":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
      case "archived":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
    }
  }

  const assetTypeOptions = assetTypes.map((type) => ({ value: type.code, label: type.label }))
  const departmentOptions = departments.map((department) => ({ value: department, label: department }))
  const officeOptions = Array.from(new Set(assets.map((asset) => asset.office_location).filter(Boolean) as string[]))
    .sort()
    .map((office) => ({ value: office, label: office }))
  const employeeOptions = employees
    .map((employee) => {
      const fullName = `${formatName(employee.first_name)} ${formatName(employee.last_name)}`.trim()
      return {
        value: employee.id,
        label: fullName || employee.company_email || "Unknown employee",
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
  const yearOptions = Array.from(new Set(assets.map((asset) => String(asset.acquisition_year))))
    .sort()
    .map((year) => ({ value: year, label: year }))

  const assetColumns: DataTableColumn<Asset>[] = [
    {
      key: "unique_code",
      label: "Unique Code",
      sortable: true,
      accessor: (asset) => asset.unique_code,
      render: (asset) => <span className="font-mono text-xs font-medium">{asset.unique_code}</span>,
      resizable: true,
      initialWidth: 150,
    },
    {
      key: "asset_type",
      label: "Asset Type",
      sortable: true,
      accessor: (asset) => asset.asset_type,
      render: (asset) => <span>{ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type}</span>,
      resizable: true,
      initialWidth: 180,
    },
    {
      key: "model",
      label: "Model",
      sortable: true,
      accessor: (asset) => asset.asset_model || "",
      render: (asset) => <span className="text-muted-foreground text-sm">{asset.asset_model || "-"}</span>,
      hideOnMobile: true,
      resizable: true,
      initialWidth: 160,
    },
    {
      key: "year",
      label: "Year",
      sortable: true,
      accessor: (asset) => asset.acquisition_year,
      align: "center",
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (asset) => (asset.deleted_at ? "archived" : asset.status),
      render: (asset) => (
        <Badge className={getStatusColor(asset.deleted_at ? "archived" : asset.status)} variant="outline">
          {asset.deleted_at ? "archived" : asset.status}
        </Badge>
      ),
    },
    {
      key: "assigned_to",
      label: "Assigned To",
      sortable: true,
      accessor: (asset) => getAssignedToLabel(asset),
      render: (asset) => <span className="text-sm">{getAssignedToLabel(asset, true)}</span>,
      resizable: true,
      initialWidth: 220,
    },
    {
      key: "department",
      label: "Department",
      sortable: true,
      accessor: (asset) => asset.current_assignment?.department || asset.department || "",
      render: (asset) => <span>{asset.current_assignment?.department || asset.department || "-"}</span>,
      hideOnMobile: true,
    },
    {
      key: "office_location",
      label: "Office",
      sortable: true,
      accessor: (asset) => asset.current_assignment?.office_location || asset.office_location || "",
      render: (asset) => <span>{asset.current_assignment?.office_location || asset.office_location || "-"}</span>,
      hideOnMobile: true,
    },
    {
      key: "issues",
      label: "Issues",
      sortable: true,
      accessor: (asset) => asset.unresolved_issues_count || 0,
      render: (asset) => (
        <Badge variant={(asset.unresolved_issues_count || 0) > 0 ? "destructive" : "secondary"}>
          {asset.unresolved_issues_count || 0}
        </Badge>
      ),
      align: "center",
    },
  ]

  const assetFilters: DataTableFilter<Asset>[] = [
    {
      key: "status",
      label: "Status",
      options: [
        { value: "available", label: "Available" },
        { value: "assigned", label: "Assigned" },
        { value: "maintenance", label: "Maintenance" },
        { value: "retired", label: "Retired" },
        { value: "archived", label: "Archived" },
      ],
      placeholder: "All Statuses",
      mode: "custom",
      filterFn: (asset, values) => values.length === 0 || values.includes(asset.deleted_at ? "archived" : asset.status),
    },
    {
      key: "asset_type",
      label: "Asset Type",
      options: assetTypeOptions,
      placeholder: "All Asset Types",
    },
    {
      key: "employee",
      label: "Employee",
      options: employeeOptions,
      placeholder: "All Employees",
      mode: "custom",
      filterFn: (asset, values) => {
        if (values.length === 0) return true
        const assignmentType = getEffectiveAssignmentType(asset)
        if (assignmentType === "department" || assignmentType === "office") return false
        const assignedTo = asset.current_assignment?.assigned_to || ""
        return assignedTo ? values.includes(assignedTo) : false
      },
    },
    {
      key: "department",
      label: "Department",
      options: departmentOptions,
      placeholder: "All Departments",
      mode: "custom",
      filterFn: (asset, values) => {
        const department = asset.current_assignment?.department || asset.department || ""
        return values.length === 0 || values.includes(department)
      },
    },
    {
      key: "office_location",
      label: "Office",
      options: officeOptions,
      placeholder: "All Offices",
      mode: "custom",
      filterFn: (asset, values) => {
        const office = asset.current_assignment?.office_location || asset.office_location || ""
        return values.length === 0 || values.includes(office)
      },
    },
    {
      key: "year",
      label: "Year",
      options: yearOptions,
      placeholder: "All Years",
      mode: "custom",
      filterFn: (asset, values) => values.length === 0 || values.includes(String(asset.acquisition_year)),
    },
  ]

  const assetRowActions: RowAction<Asset>[] = [
    {
      label: "Edit",
      icon: Pencil,
      onClick: (asset) => void handleOpenAssetDialog(asset),
      hidden: (asset) => Boolean(asset.deleted_at),
    },
    {
      label: "Assign",
      icon: Wrench,
      onClick: (asset) => void openAssignDialog(asset),
      hidden: (asset) => Boolean(asset.deleted_at),
    },
    {
      label: "Issues",
      icon: AlertCircle,
      onClick: (asset) => void handleOpenIssuesDialog(asset),
      hidden: (asset) => Boolean(asset.deleted_at),
    },
    {
      label: "History",
      icon: History,
      onClick: (asset) => void loadAssetHistory(asset),
    },
    {
      label: "Archive",
      icon: AlertCircle,
      variant: "destructive",
      onClick: (asset) => {
        setAssetToDelete(asset)
        setIsDeleteDialogOpen(true)
      },
      hidden: (asset) => Boolean(asset.deleted_at),
    },
    {
      label: "Restore",
      icon: RefreshCw,
      onClick: (asset) => void handleRestoreAsset(asset),
      hidden: (asset) => !Boolean(asset.deleted_at),
    },
  ]

  return (
    <DataTablePage
      title="Asset Management"
      description="Manage asset inventory, assignments, history, and issue tracking."
      icon={Package}
      backLink={{ href: "/admin", label: "Back to Admin" }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setExportOptionsOpen(true)} className="gap-2" size="sm">
            <Download className="h-4 w-4" />
            Export
          </Button>
          {!userProfile?.is_department_lead && (
            <Button onClick={() => void handleOpenAssetDialog()} className="gap-2" size="sm">
              <Plus className="h-4 w-4" />
              Add Asset
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push("/admin/assets/issues")} className="gap-2" size="sm">
            <AlertCircle className="h-4 w-4" />
            Issues
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard
            title="Total Assets"
            value={stats.total}
            icon={Package}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Available"
            value={stats.available}
            icon={Package}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Assigned"
            value={stats.assigned}
            icon={Package}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
          <StatCard
            title="Maintenance"
            value={stats.maintenance}
            icon={Wrench}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Open Issues"
            value={stats.unresolvedIssues}
            icon={AlertCircle}
            iconBgColor="bg-red-500/10"
            iconColor="text-red-500"
          />
        </div>
      }
    >
      <DataTable<Asset>
        data={scopedAssets}
        columns={assetColumns}
        filters={assetFilters}
        onProcessedDataChange={setFilteredAssetsForExport}
        getRowId={(asset) => asset.id}
        searchPlaceholder="Search asset code, type, model, assignee, office, or creator..."
        searchFn={(asset, query) =>
          [
            asset.unique_code,
            ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type,
            asset.asset_model || "",
            asset.serial_number || "",
            getAssignedToLabel(asset),
            asset.department || "",
            asset.office_location || "",
            getCreatedByLabel(asset.created_by),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }
        isLoading={isLoading}
        error={initialError || null}
        onRetry={() => void loadData()}
        rowActions={assetRowActions}
        expandable={{
          render: (asset) => (
            <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-muted-foreground text-xs">Model</p>
                <p className="mt-1">{asset.asset_model || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Serial Number</p>
                <p className="mt-1">{asset.serial_number || "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Created By</p>
                <p className="mt-1">{getCreatedByLabel(asset.created_by)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Issue Count</p>
                <p className="mt-1">{asset.unresolved_issues_count || 0}</p>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-muted-foreground text-xs">Notes</p>
                <p className="mt-1">{asset.notes || "No notes added."}</p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(asset) => (
          <div className="space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{asset.unique_code}</p>
                <p className="text-muted-foreground text-xs">
                  {ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type}
                </p>
              </div>
              <Badge className={getStatusColor(asset.deleted_at ? "archived" : asset.status)} variant="outline">
                {asset.deleted_at ? "archived" : asset.status}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Assigned To</p>
                <p>{getAssignedToLabel(asset, true)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Issues</p>
                <p>{asset.unresolved_issues_count || 0}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void handleOpenAssetDialog(asset)}>
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleOpenIssuesDialog(asset)}>
                Issues
              </Button>
            </div>
          </div>
        )}
        emptyTitle="No assets found"
        emptyDescription="Add the first asset to start tracking inventory, assignments, and maintenance issues."
        emptyIcon={Package}
        skeletonRows={8}
        minWidth="1280px"
      />
      {/* asset Dialog */}
      <AssetFormDialog
        isOpen={isAssetDialogOpen}
        onOpenChange={setIsAssetDialogOpen}
        selectedAsset={selectedAsset}
        assetForm={assetForm}
        setAssetForm={setAssetForm}
        originalAssetForm={originalAssetForm}
        assetTypes={assetTypes}
        employees={employees}
        activeEmployees={activeEmployees}
        departments={departments}
        onSave={handleSaveAsset}
        isSaving={isSaving}
        canCreateAssetType={canCreateAssetType}
        onOpenCreateAssetType={() => setIsCreateAssetTypeDialogOpen(true)}
        batchQuantity={batchQuantity}
        setBatchQuantity={setBatchQuantity}
      />

      {/* Assign Dialog */}
      <AssetAssignDialog
        isOpen={isAssignDialogOpen}
        onOpenChange={setIsAssignDialogOpen}
        selectedAsset={selectedAsset}
        assignForm={assignForm}
        setAssignForm={setAssignForm}
        currentAssignment={currentAssignment}
        onAssign={handleAssignAsset}
        employees={employees}
        activeEmployees={activeEmployees}
        departments={departments}
        isAssigning={isAssigning}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive &quot;{assetToDelete?.unique_code}&quot; (
              {ASSET_TYPE_MAP[assetToDelete?.asset_type || ""]?.label}
              ). Archived assets are recoverable and not permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAssetToDelete(null)} disabled={isDeleting}>
              Cancel
            </AlertDialogCancel>
            <Button onClick={handleDeleteAsset} loading={isDeleting} className="bg-red-600 text-white hover:bg-red-700">
              Archive
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* asset History Dialog */}
      <AssetHistoryDialog
        isOpen={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        selectedAsset={selectedAsset}
        assetHistory={assetHistory}
      />

      {/* Asset Issues Dialog */}
      <AssetIssuesDialog
        isOpen={isIssuesDialogOpen}
        onOpenChange={setIsIssuesDialogOpen}
        selectedAsset={selectedAsset}
        assetIssues={assetIssues}
        newIssueDescription={newIssueDescription}
        setNewIssueDescription={setNewIssueDescription}
        onAddIssue={handleAddIssue}
        onToggleIssue={handleToggleIssue}
        onDeleteIssue={handleDeleteIssue}
        isAddingIssue={isAddingIssue}
      />

      {/* Create Asset Type Dialog */}
      <AssetTypeDialog
        isOpen={isCreateAssetTypeDialogOpen}
        onOpenChange={setIsCreateAssetTypeDialogOpen}
        newAssetType={newAssetType}
        setNewAssetType={setNewAssetType}
        onCreateAssetType={handleCreateAssetType}
        isCreatingAssetType={isCreatingAssetType}
      />

      {/* Export Column Selection Dialog */}
      <AssetExportDialog
        isOpen={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        exportType={exportType}
        selectedColumns={selectedColumns}
        setSelectedColumns={setSelectedColumns}
        onExportConfirm={handleExportConfirm}
      />

      {/* Employee Assets Report Confirmation Dialog */}
      <EmployeeAssetsReportDialog
        isOpen={employeeReportDialogOpen}
        onOpenChange={setEmployeeReportDialogOpen}
        employeeReportExportType={employeeReportExportType}
        employeeReportSelectedTypes={employeeReportSelectedTypes}
        setEmployeeReportSelectedTypes={setEmployeeReportSelectedTypes}
        assetTypes={assetTypes}
        employeesCount={employees.length}
        onConfirm={handleEmployeeReportConfirm}
      />

      <ExportOptionsDialog
        open={exportOptionsOpen}
        onOpenChange={setExportOptionsOpen}
        title="Export Assets"
        options={[
          { id: "asset_excel", label: "Assets: Excel (.xlsx)", icon: "excel" },
          { id: "asset_pdf", label: "Assets: PDF", icon: "pdf" },
          { id: "asset_word", label: "Assets: Word (.docx)", icon: "word" },
          { id: "employee_excel", label: "Employee Report: Excel (.xlsx)", icon: "excel" },
          { id: "employee_pdf", label: "Employee Report: PDF", icon: "pdf" },
          { id: "employee_word", label: "Employee Report: Word (.docx)", icon: "word" },
        ]}
        onSelect={(id) => {
          if (id === "asset_excel") return handleExportClick("excel")
          if (id === "asset_pdf") return handleExportClick("pdf")
          if (id === "asset_word") return handleExportClick("word")
          if (id === "employee_excel") return handleEmployeeReportClick("excel")
          if (id === "employee_pdf") return handleEmployeeReportClick("pdf")
          handleEmployeeReportClick("word")
        }}
      />
    </DataTablePage>
  )
}
