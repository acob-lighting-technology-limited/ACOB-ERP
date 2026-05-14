"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { EmployeeStatusBadge } from "@/components/hr/employee-status-badge"
import { ChangeStatusContent } from "@/components/hr/change-status-dialog"
import { SignatureCreator } from "@/components/signature-creator"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import { formatName } from "@/lib/utils"
import { format, differenceInDays } from "date-fns"
import {
  Edit,
  Mail,
  Phone,
  Building2,
  MapPin,
  Shield,
  FileSignature,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Calendar,
  Clock,
  User as UserIcon,
  UserCircle,
} from "lucide-react"
import type { UserRole, EmploymentStatus } from "@/types/database"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { useDepartments } from "@/hooks/use-departments"
import { useOfficeLocations } from "@/hooks/use-office-locations"
import { createClient } from "@/lib/supabase/client"
import type { UserProfile } from "@/app/admin/hr/employees/admin-employee-content"
import type { EmployeeAssignedItems, EmployeeProfile, EmployeeStatusSummary, EmployeeViewData } from "./types"

interface EditForm {
  role: UserRole
  admin_domains: string[]
  is_department_lead: boolean
  department: string
  office_location: string
  designation: string
  lead_departments: string[]
  employee_number: string
  first_name: string
  last_name: string
  other_names: string
  company_email: string
  additional_email: string
  phone_number: string
  additional_phone: string
  residential_address: string
  bank_name: string
  bank_account_number: string
  bank_account_name: string
  date_of_birth: string
  employment_date: string
  job_description: string
}

interface EmployeeViewModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  employee: EmployeeProfile | null
  assignedItems: EmployeeAssignedItems
  modalViewMode: "profile" | "employment" | "edit" | "signature" | "status"
  setModalViewMode: (mode: "profile" | "employment" | "edit" | "signature" | "status") => void
  onSave: () => void
  isSaving: boolean
  editForm: EditForm
  setEditForm: (form: EditForm | ((prev: EditForm) => EditForm)) => void
  showMoreOptions: boolean
  setShowMoreOptions: (show: boolean) => void
  userProfile: UserProfile
  viewEmployeeData: EmployeeViewData
  onEditEmployee: (employee: EmployeeProfile) => void
  onSignature: (employee: EmployeeProfile) => void
  loadData: () => void
  setViewEmployeeProfile: (profile: EmployeeProfile | null) => void
  canManageUsers: boolean
  getAvailableRoles: () => UserRole[]
}

export function EmployeeViewModal({
  isOpen,
  onOpenChange,
  employee,
  assignedItems: _assignedItems,
  modalViewMode,
  setModalViewMode,
  onSave,
  isSaving,
  editForm,
  setEditForm,
  showMoreOptions,
  setShowMoreOptions,
  userProfile,
  viewEmployeeData,
  onEditEmployee,
  onSignature,
  loadData,
  setViewEmployeeProfile,
  canManageUsers,
  getAvailableRoles,
}: EmployeeViewModalProps) {
  const { departments: DEPARTMENTS } = useDepartments()
  const { officeLocations } = useOfficeLocations()
  const supabase = createClient()

  const viewEmployeeProfile = employee
  const displayedLeadDepartments =
    viewEmployeeProfile?.is_department_lead && viewEmployeeProfile.department
      ? [viewEmployeeProfile.department]
      : viewEmployeeProfile?.lead_departments || []

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] max-w-7xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>
              {modalViewMode === "edit"
                ? "Edit Employee Profile"
                : modalViewMode === "signature"
                  ? "Email Signature"
                  : modalViewMode === "status"
                    ? "Change Employment Status"
                    : viewEmployeeProfile
                      ? `${formatName(viewEmployeeProfile.first_name)} ${formatName(viewEmployeeProfile.last_name)}`
                      : "Employee Details"}
            </span>
            {viewEmployeeProfile?.role && (
              <Badge className={getRoleBadgeColor(viewEmployeeProfile.role as UserRole)}>
                {getRoleDisplayName(viewEmployeeProfile.role as UserRole)}
              </Badge>
            )}
            {viewEmployeeProfile?.employment_status && (
              <EmployeeStatusBadge status={(viewEmployeeProfile.employment_status as EmploymentStatus) || "active"} />
            )}
          </DialogTitle>
          <DialogDescription>
            {modalViewMode === "edit"
              ? "Update role, department, permissions, and profile information."
              : modalViewMode === "signature"
                ? "Manage branded signature details for this employee."
                : modalViewMode === "status"
                  ? "Update employment status and offboarding details."
                  : "Review profile, assets, tasks, and employment details."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4 sm:px-6">
          {/* Loading skeleton — shown while the profile fetch is in flight */}
          {!viewEmployeeProfile && (
            <div className="space-y-4 py-2">
              <div className="bg-muted h-6 w-2/5 animate-pulse rounded" />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
                    <div className="bg-muted h-5 w-full animate-pulse rounded" />
                  </div>
                ))}
              </div>
              <div className="bg-muted h-4 w-1/4 animate-pulse rounded" />
              <div className="bg-muted h-20 w-full animate-pulse rounded" />
            </div>
          )}
          {viewEmployeeProfile && modalViewMode === "profile" && (
            <ScrollArea className="h-full pr-4">
              <div className="space-y-4">
                {/* Profile Information */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <UserIcon className="h-5 w-5" />
                      Profile Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-primary text-primary-foreground">
                            {formatName(viewEmployeeProfile.first_name)?.[0]}
                            {formatName(viewEmployeeProfile.last_name)?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-muted-foreground text-sm">Full Name</p>
                          <p className="font-medium">
                            {formatName(viewEmployeeProfile.first_name)} {formatName(viewEmployeeProfile.last_name)}
                          </p>
                          {viewEmployeeProfile.other_names && (
                            <p className="text-muted-foreground text-xs">({viewEmployeeProfile.other_names})</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <Mail className="text-muted-foreground h-5 w-5" />
                        <div>
                          <p className="text-muted-foreground text-sm">Email</p>
                          <p className="font-medium">{viewEmployeeProfile.company_email}</p>
                          {viewEmployeeProfile.additional_email && (
                            <p className="text-muted-foreground text-xs">{viewEmployeeProfile.additional_email}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <Building2 className="text-muted-foreground h-5 w-5" />
                        <div>
                          <p className="text-muted-foreground text-sm">Department</p>
                          <p className="font-medium">{viewEmployeeProfile.department || "N/A"}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <Shield className="text-muted-foreground h-5 w-5" />
                        <div>
                          <p className="text-muted-foreground text-sm">Role</p>
                          <div className="mt-1 flex gap-2">
                            <Badge className={getRoleBadgeColor(viewEmployeeProfile.role as UserRole)}>
                              {getRoleDisplayName(viewEmployeeProfile.role as UserRole)}
                            </Badge>
                            {viewEmployeeProfile.is_department_lead && displayedLeadDepartments.length > 0 && (
                              <Badge variant="outline">
                                Leading {displayedLeadDepartments.length} Dept
                                {displayedLeadDepartments.length > 1 ? "s" : ""}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <UserIcon className="text-muted-foreground h-5 w-5" />
                        <div>
                          <p className="text-muted-foreground text-sm">Designation</p>
                          <p className="font-medium">{viewEmployeeProfile.designation || "N/A"}</p>
                        </div>
                      </div>

                      {viewEmployeeProfile.phone_number && (
                        <div className="flex items-center gap-3">
                          <Phone className="text-muted-foreground h-5 w-5" />
                          <div>
                            <p className="text-muted-foreground text-sm">Phone</p>
                            <p className="font-medium">{viewEmployeeProfile.phone_number}</p>
                            {viewEmployeeProfile.additional_phone && (
                              <p className="text-muted-foreground text-xs">{viewEmployeeProfile.additional_phone}</p>
                            )}
                          </div>
                        </div>
                      )}

                      {viewEmployeeProfile.residential_address && (
                        <div className="flex items-center gap-3">
                          <MapPin className="text-muted-foreground h-5 w-5" />
                          <div>
                            <p className="text-muted-foreground text-sm">Address</p>
                            <p className="font-medium">{viewEmployeeProfile.residential_address}</p>
                          </div>
                        </div>
                      )}

                      {viewEmployeeProfile.office_location && (
                        <div className="flex items-center gap-3">
                          <MapPin className="text-muted-foreground h-5 w-5" />
                          <div>
                            <p className="text-muted-foreground text-sm">Office Location</p>
                            <p className="font-medium">{viewEmployeeProfile.office_location}</p>
                          </div>
                        </div>
                      )}

                      {displayedLeadDepartments.length > 0 && (
                        <div className="flex items-center gap-3">
                          <Building2 className="text-muted-foreground h-5 w-5" />
                          <div>
                            <p className="text-muted-foreground text-sm">Leading Departments</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {displayedLeadDepartments.map((dept: string) => (
                                <Badge key={dept} variant="outline">
                                  {dept}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <Calendar className="text-muted-foreground h-5 w-5" />
                        <div>
                          <p className="text-muted-foreground text-sm">Hire Date</p>
                          <p className="font-medium">
                            {viewEmployeeProfile.employment_date
                              ? format(new Date(viewEmployeeProfile.employment_date), "PPP")
                              : "Not recorded"}
                          </p>
                        </div>
                      </div>

                      {viewEmployeeProfile.employment_date && (
                        <>
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="text-muted-foreground h-5 w-5" />
                            <div>
                              <p className="text-muted-foreground text-sm">Joined ACOB</p>
                              <p className="font-medium">
                                {format(new Date(viewEmployeeProfile.employment_date), "MMM d, yyyy")}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <Clock className="text-muted-foreground h-5 w-5" />
                            <div>
                              <p className="text-muted-foreground text-sm">Days at ACOB</p>
                              <p className="font-medium text-blue-600 dark:text-blue-400">
                                {differenceInDays(new Date(), new Date(viewEmployeeProfile.employment_date))} Days
                              </p>
                            </div>
                          </div>
                        </>
                      )}

                      <div className="flex items-center gap-3">
                        <Calendar className="text-muted-foreground h-5 w-5" />
                        <div>
                          <p className="text-muted-foreground text-sm">Account Created</p>
                          <p className="font-medium">{format(new Date(viewEmployeeProfile.created_at), "PPP")}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Related Data Tabs */}
                <Tabs defaultValue="assets" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="assets">Assets ({viewEmployeeData.assets.length})</TabsTrigger>
                    <TabsTrigger value="tasks">Tasks ({viewEmployeeData.tasks.length})</TabsTrigger>
                    <TabsTrigger value="documentation">
                      Documentation ({viewEmployeeData.documentation.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="assets">
                    <Card>
                      <CardHeader>
                        <CardTitle>Assigned Assets</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {viewEmployeeData.assets.length > 0 ? (
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-14">S/N</TableHead>
                                  <TableHead>Type</TableHead>
                                  <TableHead>Assignment</TableHead>
                                  <TableHead>Unique Code</TableHead>
                                  <TableHead>Model</TableHead>
                                  <TableHead>Serial Number</TableHead>
                                  <TableHead>Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {viewEmployeeData.assets.map((assignment, index: number) => {
                                  const asset = assignment.Asset
                                  const assetTypeLabel = asset?.asset_type
                                    ? ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type
                                    : "Unknown"
                                  const isOfficeAssignment = assignment.assignmentType === "office"

                                  return (
                                    <TableRow key={assignment.id}>
                                      <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                                      <TableCell className="font-medium">{assetTypeLabel}</TableCell>
                                      <TableCell>
                                        {isOfficeAssignment ? (
                                          <Badge
                                            variant="outline"
                                            className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                                          >
                                            Office:{" "}
                                            {assignment.officeLocation ||
                                              viewEmployeeProfile?.office_location ||
                                              "Office"}
                                          </Badge>
                                        ) : (
                                          <Badge
                                            variant="outline"
                                            className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                                          >
                                            Personal
                                          </Badge>
                                        )}
                                      </TableCell>
                                      <TableCell className="font-mono">{asset?.unique_code || "-"}</TableCell>
                                      <TableCell>{asset?.asset_model || "-"}</TableCell>
                                      <TableCell className="font-mono">{asset?.serial_number || "-"}</TableCell>
                                      <TableCell>
                                        <Badge variant={asset?.status === "assigned" ? "default" : "secondary"}>
                                          {asset?.status || "unknown"}
                                        </Badge>
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">No assets assigned</p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="tasks">
                    <Card>
                      <CardHeader>
                        <CardTitle>Assigned Tasks</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {viewEmployeeData.tasks.length > 0 ? (
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-14">S/N</TableHead>
                                  <TableHead>Title</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead>Created</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {viewEmployeeData.tasks.map((task, index: number) => (
                                  <TableRow key={task.id}>
                                    <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                                    <TableCell className="font-medium">{task.title || "Untitled Task"}</TableCell>
                                    <TableCell>
                                      <Badge variant="outline">{task.status || "unknown"}</Badge>
                                    </TableCell>
                                    <TableCell>
                                      {task.created_at ? new Date(task.created_at).toLocaleDateString() : "—"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">No tasks assigned</p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="documentation">
                    <Card>
                      <CardHeader>
                        <CardTitle>Documentation</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {viewEmployeeData.documentation.length > 0 ? (
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-14">S/N</TableHead>
                                  <TableHead>Title</TableHead>
                                  <TableHead>Created</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {viewEmployeeData.documentation.map((doc, index: number) => (
                                  <TableRow key={doc.id}>
                                    <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                                    <TableCell className="font-medium">{doc.title || "Untitled"}</TableCell>
                                    <TableCell>
                                      {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-sm">No documentation</p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>
          )}

          {viewEmployeeProfile && modalViewMode === "employment" && (
            <ScrollArea className="h-full pr-4">
              <div className="space-y-6 pt-4">
                <Card className="border-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <UserCircle className="h-5 w-5" />
                      Employment Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <div className="space-y-1">
                        <p className="text-muted-foreground text-sm font-medium">Current Status</p>
                        <EmployeeStatusBadge status={viewEmployeeProfile.employment_status || "active"} size="lg" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-muted-foreground text-sm font-medium">Hire Date</p>
                        <div className="text-foreground flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span className="font-medium">
                            {viewEmployeeProfile.employment_date
                              ? new Date(viewEmployeeProfile.employment_date).toLocaleDateString("en-GB", {
                                  day: "numeric",
                                  month: "long",
                                  year: "numeric",
                                })
                              : "Not recorded"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {viewEmployeeProfile.employment_status === "separated" && (
                      <div className="rounded-lg border border-red-100 bg-red-50 p-4 dark:border-red-900/30 dark:bg-red-950/20">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Separation Date</p>
                            <p className="text-foreground font-medium">
                              {viewEmployeeProfile.separation_date
                                ? new Date(viewEmployeeProfile.separation_date).toLocaleDateString("en-GB", {
                                    day: "numeric",
                                    month: "long",
                                    year: "numeric",
                                  })
                                : "Not recorded"}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-red-700 dark:text-red-400">Separation Reason</p>
                            <p className="text-foreground font-medium italic">
                              {viewEmployeeProfile.separation_reason || "No reason specified"}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {viewEmployeeProfile.employment_status === "suspended" && (
                      <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 dark:border-amber-900/30 dark:bg-amber-950/20">
                        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Suspension Note</p>
                        <p className="text-foreground mt-1 text-sm italic">
                          Contact IT / Admin for active suspension period details.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="bg-muted/30 rounded-lg p-4">
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Note: Changes to employment status are logged for audit purposes. Terminating an employee will
                    automatically revoke their system access and clear their assigned roles.
                  </p>
                </div>
              </div>
            </ScrollArea>
          )}

          {viewEmployeeProfile && modalViewMode === "signature" && (
            <ScrollArea className="h-full pr-4">
              <div className="mt-4">
                <SignatureCreator
                  profile={viewEmployeeProfile}
                  variant="selectable"
                  defaultSelectableMode="anniversary"
                />
              </div>
            </ScrollArea>
          )}

          {viewEmployeeProfile && modalViewMode === "status" && (
            <ScrollArea className="h-full pr-4">
              <div className="mx-auto max-w-md pb-4">
                <ChangeStatusContent
                  employee={
                    {
                      id: viewEmployeeProfile.id,
                      first_name: viewEmployeeProfile.first_name,
                      last_name: viewEmployeeProfile.last_name,
                      employment_status: viewEmployeeProfile.employment_status || "active",
                    } satisfies EmployeeStatusSummary
                  }
                  onSuccess={() => {
                    setModalViewMode("profile")
                    loadData()
                    // Refresh profile data
                    supabase
                      .from("profiles")
                      .select("*")
                      .eq("id", viewEmployeeProfile.id)
                      .single()
                      .then(({ data }) => {
                        if (data) setViewEmployeeProfile(data as EmployeeProfile)
                      })
                  }}
                />
              </div>
            </ScrollArea>
          )}

          {viewEmployeeProfile && modalViewMode === "edit" && (
            <ScrollArea className="h-full pr-4">
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="role">Role *</Label>
                  <Select
                    value={editForm.role}
                    onValueChange={(value: UserRole) => {
                      setEditForm((prev) => ({
                        ...prev,
                        role: value,
                        admin_domains: value === "admin" ? prev.admin_domains : [],
                      }))
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableRoles().map((role) => (
                        <SelectItem key={role} value={role}>
                          {getRoleDisplayName(role)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {userProfile?.role === "admin"
                      ? "As Admin, you can assign: Visitor and Employee roles"
                      : "As Super Admin, you can assign any role"}
                  </p>
                  {editForm.role === "admin" && (
                    <div className="mt-3 space-y-2">
                      <Label>Admin Domains *</Label>
                      <SearchableMultiSelect
                        label="Admin Domains"
                        values={editForm.admin_domains}
                        onChange={(values) => setEditForm((prev) => ({ ...prev, admin_domains: values }))}
                        options={[
                          { value: "hr", label: "HR" },
                          { value: "finance", label: "Finance" },
                          { value: "assets", label: "Assets" },
                          { value: "reports", label: "Reports" },
                          { value: "tasks", label: "Tasks" },
                          { value: "projects", label: "Projects" },
                          { value: "communications", label: "Communications" },
                        ]}
                        placeholder="Select at least one admin domain"
                      />
                      <p className="text-muted-foreground text-xs">Admin must have one or more domains.</p>
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="department">Department *</Label>
                  <Select
                    value={editForm.department}
                    onValueChange={(value) =>
                      setEditForm({
                        ...editForm,
                        department: value,
                        lead_departments: editForm.is_department_lead ? [value] : editForm.lead_departments,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editForm.is_department_lead && editForm.department && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Lead department will be set to {editForm.department}.
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      id="is_department_lead"
                      type="checkbox"
                      checked={editForm.is_department_lead}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          is_department_lead: e.target.checked,
                          lead_departments: e.target.checked && prev.department ? [prev.department] : [],
                        }))
                      }
                      className="rounded"
                    />
                    <Label htmlFor="is_department_lead">Department Lead</Label>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    When enabled, the selected department is used automatically as the lead department.
                  </p>
                </div>

                <div>
                  <Label htmlFor="office_location">Office Location</Label>
                  <SearchableSelect
                    value={editForm.office_location}
                    onValueChange={(value) => setEditForm({ ...editForm, office_location: value })}
                    placeholder="Select office location"
                    options={officeLocations.map((location) => ({
                      value: location,
                      label: location,
                    }))}
                  />
                </div>

                <div>
                  <Label htmlFor="designation">Designation</Label>
                  <Input
                    id="designation"
                    value={editForm.designation}
                    onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                    placeholder="e.g., Senior Developer"
                  />
                </div>

                {/* More Options */}
                <div className="border-t pt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowMoreOptions(!showMoreOptions)}
                    className="w-full justify-between"
                  >
                    <span className="font-medium">More Personal Options</span>
                    {showMoreOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>

                  {showMoreOptions && (
                    <div className="animate-in slide-in-from-top-2 mt-4 space-y-4">
                      {/* Personal Information */}
                      <div className="space-y-4">
                        <h4 className="text-foreground text-sm font-semibold">Personal Information</h4>
                        <div>
                          <Label htmlFor="edit_employee_number">Employee Number</Label>
                          <Input
                            id="edit_employee_number"
                            value={editForm.employee_number}
                            placeholder="e.g., ACOB/2026/058"
                            className="font-mono"
                            readOnly
                            disabled
                          />
                          <p className="text-muted-foreground mt-1 text-xs">
                            Employee number is locked after creation.
                          </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label htmlFor="edit_first_name">First Name</Label>
                            <Input
                              id="edit_first_name"
                              value={editForm.first_name}
                              onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                              placeholder="First name"
                            />
                          </div>
                          <div>
                            <Label htmlFor="edit_last_name">Last Name</Label>
                            <Input
                              id="edit_last_name"
                              value={editForm.last_name}
                              onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                              placeholder="Last name"
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="edit_other_names">Other Names</Label>
                          <Input
                            id="edit_other_names"
                            value={editForm.other_names}
                            onChange={(e) => setEditForm({ ...editForm, other_names: e.target.value })}
                            placeholder="Middle name or other names"
                          />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label htmlFor="edit_company_email">Company Email</Label>
                            <Input
                              id="edit_company_email"
                              type="email"
                              value={editForm.company_email}
                              onChange={(e) => setEditForm({ ...editForm, company_email: e.target.value })}
                              disabled={!canManageUsers}
                              placeholder="email@company.com"
                            />
                          </div>
                          <div>
                            <Label htmlFor="edit_additional_email">Additional Email</Label>
                            <Input
                              id="edit_additional_email"
                              type="email"
                              value={editForm.additional_email}
                              onChange={(e) => setEditForm({ ...editForm, additional_email: e.target.value })}
                              placeholder="email@example.com"
                            />
                          </div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label htmlFor="edit_phone_number">Phone Number</Label>
                            <Input
                              id="edit_phone_number"
                              type="tel"
                              value={editForm.phone_number}
                              onChange={(e) => setEditForm({ ...editForm, phone_number: e.target.value })}
                              placeholder="+234 800 000 0000"
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="edit_additional_phone">Additional Phone</Label>
                          <Input
                            id="edit_additional_phone"
                            type="tel"
                            value={editForm.additional_phone}
                            onChange={(e) => setEditForm({ ...editForm, additional_phone: e.target.value })}
                            placeholder="Alternative phone number"
                          />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label htmlFor="edit_date_of_birth">Date of Birth</Label>
                            <Input
                              id="edit_date_of_birth"
                              type="date"
                              value={editForm.date_of_birth}
                              onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label htmlFor="edit_employment_date">Employment Date</Label>
                            <Input
                              id="edit_employment_date"
                              type="date"
                              value={editForm.employment_date}
                              onChange={(e) => setEditForm({ ...editForm, employment_date: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Address Information */}
                      <div className="space-y-4 border-t pt-4">
                        <h4 className="text-foreground text-sm font-semibold">Address Information</h4>
                        <div>
                          <Label htmlFor="edit_residential_address">Residential Address</Label>
                          <Textarea
                            id="edit_residential_address"
                            value={editForm.residential_address}
                            onChange={(e) => setEditForm({ ...editForm, residential_address: e.target.value })}
                            placeholder="Full residential address"
                            rows={2}
                          />
                        </div>
                      </div>

                      {/* Banking Information */}
                      <div className="space-y-4 border-t pt-4">
                        <h4 className="text-foreground text-sm font-semibold">Banking Information</h4>
                        <div>
                          <Label htmlFor="edit_bank_name">Bank Name</Label>
                          <Input
                            id="edit_bank_name"
                            value={editForm.bank_name}
                            onChange={(e) => setEditForm({ ...editForm, bank_name: e.target.value })}
                            placeholder="Bank name"
                          />
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <Label htmlFor="edit_bank_account_number">Account Number</Label>
                            <Input
                              id="edit_bank_account_number"
                              value={editForm.bank_account_number}
                              onChange={(e) => setEditForm({ ...editForm, bank_account_number: e.target.value })}
                              placeholder="Account number"
                            />
                          </div>
                          <div>
                            <Label htmlFor="edit_bank_account_name">Account Name</Label>
                            <Input
                              id="edit_bank_account_name"
                              value={editForm.bank_account_name}
                              onChange={(e) => setEditForm({ ...editForm, bank_account_name: e.target.value })}
                              placeholder="Account holder name"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Job Description */}
                      <div className="space-y-4 border-t pt-4">
                        <h4 className="text-foreground text-sm font-semibold">Job Information</h4>
                        <div>
                          <Label htmlFor="edit_job_description">Job Description</Label>
                          <Textarea
                            id="edit_job_description"
                            value={editForm.job_description}
                            onChange={(e) => setEditForm({ ...editForm, job_description: e.target.value })}
                            placeholder="Job description or responsibilities"
                            rows={4}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="bg-background/95 flex w-full flex-col gap-3 border-t px-5 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {modalViewMode === "edit" ? (
              <>
                <Button variant="outline" onClick={() => setModalViewMode("profile")} disabled={isSaving}>
                  Back to Profile
                </Button>
              </>
            ) : modalViewMode === "signature" || modalViewMode === "status" ? (
              <Button variant="outline" onClick={() => setModalViewMode("profile")}>
                Back to Profile
              </Button>
            ) : (
              <>
                <Button
                  variant={modalViewMode === "profile" ? "secondary" : "outline"}
                  onClick={() => setModalViewMode("profile")}
                  className="gap-2"
                >
                  Overview
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (viewEmployeeProfile) onSignature(viewEmployeeProfile)
                  }}
                  className="gap-2"
                >
                  <FileSignature className="h-4 w-4" />
                  Signature
                </Button>
                <Button
                  variant={modalViewMode === "employment" ? "secondary" : "outline"}
                  onClick={() => setModalViewMode(modalViewMode === "profile" ? "employment" : "profile")}
                  className="gap-2"
                >
                  <UserCircle className="h-4 w-4" />
                  Employment
                </Button>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {modalViewMode === "edit" ? (
              <Button onClick={onSave} loading={isSaving}>
                Save Changes
              </Button>
            ) : (
              <>
                {canManageUsers && modalViewMode === "profile" && (
                  <Button
                    variant="default"
                    onClick={() => {
                      if (viewEmployeeProfile) onEditEmployee(viewEmployeeProfile)
                    }}
                    className="gap-2"
                  >
                    <Edit className="h-4 w-4" />
                    Edit Profile
                  </Button>
                )}
                {canManageUsers && modalViewMode === "employment" && (
                  <Button variant="default" onClick={() => setModalViewMode("status")} className="gap-2">
                    <UserCircle className="h-4 w-4" />
                    Change Status
                  </Button>
                )}
              </>
            )}

            <Button
              variant="ghost"
              onClick={() => {
                onOpenChange(false)
                setModalViewMode("profile")
              }}
            >
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
