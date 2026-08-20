"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { toast } from "sonner"
import { formatName } from "@/lib/utils"
import { useOfficeLocations } from "@/hooks/use-office-locations"
import { generateUniqueCodePreview } from "@/lib/asset-types"
import { Plus, User, Building2, Building } from "lucide-react"
import type { Asset, Employee } from "@/app/admin/assets/admin-assets-content"

const currentYear = new Date().getFullYear()

const assetFormSchema = z.object({
  asset_type: z.string().min(1, "Asset type is required"),
  acquisition_year: z
    .number()
    .min(2000)
    .max(currentYear + 1),
  asset_model: z.string(),
  serial_number: z.string(),
  unique_code: z.string(),
  status: z.string(),
  notes: z.string(),
  assignment_type: z.enum(["individual", "department", "office"]),
  assigned_to: z.string(),
  assignment_department: z.string(),
  office_location: z.string(),
  assignment_notes: z.string(),
  assigned_by: z.string(),
  assigned_at: z.string(),
})

type AssetFormValues = z.infer<typeof assetFormSchema>

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

interface AssetFormDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selectedAsset: Asset | null
  assetForm: AssetFormState
  setAssetForm: (form: AssetFormState) => void
  originalAssetForm: AssetFormState
  assetTypes: { label: string; code: string; requiresSerialModel: boolean }[]
  employees: Employee[]
  activeEmployees: Employee[]
  departments: string[]
  offices?: string[]
  onSave: () => void
  isSaving: boolean
  canCreateAssetType: boolean
  onOpenCreateAssetType: () => void
  batchQuantity: number
  setBatchQuantity: (qty: number) => void
}

export function AssetFormDialog({
  isOpen,
  onOpenChange,
  selectedAsset,
  assetForm,
  setAssetForm,
  originalAssetForm,
  assetTypes,
  employees: _employees,
  activeEmployees,
  departments,
  onSave,
  isSaving,
  canCreateAssetType,
  onOpenCreateAssetType,
  batchQuantity,
  setBatchQuantity,
}: AssetFormDialogProps) {
  const { officeLocations } = useOfficeLocations()

  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      asset_type: assetForm.asset_type,
      acquisition_year: assetForm.acquisition_year,
      asset_model: assetForm.asset_model,
      serial_number: assetForm.serial_number,
      unique_code: assetForm.unique_code,
      status: assetForm.status,
      notes: assetForm.notes,
      assignment_type: assetForm.assignment_type,
      assigned_to: assetForm.assigned_to,
      assignment_department: assetForm.assignment_department,
      office_location: assetForm.office_location,
      assignment_notes: assetForm.assignment_notes,
      assigned_by: assetForm.assigned_by,
      assigned_at: assetForm.assigned_at,
    },
  })

  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = form

  // Sync form state back to parent whenever values change
  useEffect(() => {
    const subscription = watch((values) => {
      setAssetForm({
        asset_type: values.asset_type ?? "",
        acquisition_year: values.acquisition_year ?? currentYear,
        asset_model: values.asset_model ?? "",
        serial_number: values.serial_number ?? "",
        unique_code: values.unique_code ?? "",
        status: values.status ?? "",
        notes: values.notes ?? "",
        assignment_type: (values.assignment_type ?? "individual") as "individual" | "department" | "office",
        assigned_to: values.assigned_to ?? "",
        assignment_department: values.assignment_department ?? "",
        office_location: values.office_location ?? "",
        assignment_notes: values.assignment_notes ?? "",
        assigned_by: values.assigned_by ?? "",
        assigned_at: values.assigned_at ?? "",
      })
    })
    return () => subscription.unsubscribe()
  }, [watch, setAssetForm])

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (isOpen) {
      form.reset({
        asset_type: assetForm.asset_type,
        acquisition_year: assetForm.acquisition_year,
        asset_model: assetForm.asset_model,
        serial_number: assetForm.serial_number,
        unique_code: assetForm.unique_code,
        status: assetForm.status,
        notes: assetForm.notes,
        assignment_type: assetForm.assignment_type,
        assigned_to: assetForm.assigned_to,
        assignment_department: assetForm.assignment_department,
        office_location: assetForm.office_location,
        assignment_notes: assetForm.assignment_notes,
        assigned_by: assetForm.assigned_by,
        assigned_at: assetForm.assigned_at,
      })
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const assetType = watch("asset_type")
  const acquisitionYear = watch("acquisition_year")
  const statusValue = watch("status")
  const assignmentType = watch("assignment_type")
  const assignedTo = watch("assigned_to")
  const assignmentDepartment = watch("assignment_department")
  const officeLocation = watch("office_location")
  const uniqueCode = watch("unique_code")
  const serialNumber = watch("serial_number")

  const getUniqueCodePreview = () => {
    if (!assetType || !acquisitionYear) {
      return "ACOB/HQ/???/????/???"
    }
    return generateUniqueCodePreview(assetType, acquisitionYear, "???")
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{selectedAsset ? "Edit Asset" : "Add New Asset"}</DialogTitle>
          <DialogDescription>
            {selectedAsset ? "Update the asset information below" : "Enter the details for the new asset"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="asset_type">Asset Type *</Label>
                {!selectedAsset && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!canCreateAssetType) {
                        toast.error("You do not have permission to create asset types")
                        return
                      }
                      onOpenCreateAssetType()
                    }}
                    disabled={!canCreateAssetType}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create New
                  </Button>
                )}
              </div>
              <SearchableSelect
                value={assetType}
                onValueChange={(value) => setValue("asset_type", value)}
                placeholder="Select asset type"
                searchPlaceholder="Search asset types..."
                disabled={!!selectedAsset}
                options={assetTypes.map((type) => ({
                  value: type.code,
                  label: type.label,
                }))}
              />
              {errors.asset_type && <p className="text-destructive mt-1 text-xs">{errors.asset_type.message}</p>}
              {selectedAsset && (
                <p className="text-muted-foreground mt-1 text-xs">Asset type cannot be changed after creation</p>
              )}
            </div>
            <div>
              <Label htmlFor="acquisition_year">Acquisition Year *</Label>
              <Input
                id="acquisition_year"
                type="number"
                min={2000}
                max={currentYear + 1}
                value={acquisitionYear}
                onChange={(e) => setValue("acquisition_year", parseInt(e.target.value) || currentYear)}
                disabled={!!selectedAsset}
              />
              {selectedAsset && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Year cannot be changed after creation (it&apos;s part of the unique code)
                </p>
              )}
            </div>
            {!selectedAsset && (
              <div>
                <Label htmlFor="asset_quantity">Quantity *</Label>
                <Input
                  id="asset_quantity"
                  type="number"
                  min={1}
                  max={100}
                  value={batchQuantity}
                  onChange={(e) => setBatchQuantity(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Create multiple assets with the same type and year in one batch (max 100)
                </p>
              </div>
            )}
          </div>

          {/* Unique Code Preview */}
          <div>
            <Label htmlFor="unique_code">Unique Code</Label>
            <Input
              id="unique_code"
              value={selectedAsset ? uniqueCode : getUniqueCodePreview()}
              readOnly
              className="bg-muted font-mono text-sm"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              {selectedAsset
                ? "Asset unique code (auto-generated at creation)"
                : "Preview - Serial number (001, 002...) is unique across all years for this asset type"}
            </p>
          </div>

          {/* Model and Serial Number fields - optional */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="asset_model">Asset Model (Optional)</Label>
              <Input id="asset_model" {...register("asset_model")} placeholder="e.g., Dell Latitude 5420" />
              <p className="text-muted-foreground mt-1 text-xs">Can be added later if not available now</p>
            </div>
            <div>
              <Label htmlFor="serial_number">Serial Number (Optional)</Label>
              <Input id="serial_number" {...register("serial_number")} placeholder="e.g., ABC123XYZ" />
              <p className="text-muted-foreground mt-1 text-xs">Can be added later if not available now</p>
            </div>
          </div>

          <div>
            <Label htmlFor="status">Status</Label>
            <SearchableSelect
              value={statusValue}
              onValueChange={(value) => setValue("status", value)}
              placeholder="Select status"
              searchPlaceholder="Search status..."
              options={[
                { value: "available", label: "Available" },
                { value: "assigned", label: "Assigned" },
                { value: "maintenance", label: "Maintenance" },
                { value: "retired", label: "Retired" },
              ]}
            />
          </div>

          {/* Assignment section - show ONLY when status is 'assigned' */}
          {statusValue === "assigned" && (
            <div className="space-y-4 border-t pt-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="bg-primary h-8 w-1 rounded" />
                <h4 className="text-foreground font-semibold">Assignment Details</h4>
              </div>

              <div>
                <Label htmlFor="assignment_type">Assignment Type *</Label>
                <SearchableSelect
                  value={assignmentType}
                  onValueChange={(value) => {
                    setValue("assignment_type", value as "individual" | "department" | "office")
                    setValue("assigned_to", "")
                    setValue("assignment_department", "")
                    setValue("office_location", "")
                  }}
                  placeholder="Select assignment type"
                  searchPlaceholder="Search assignment types..."
                  options={[
                    { value: "individual", label: "Individual Assignment" },
                    { value: "department", label: "Department Assignment" },
                    { value: "office", label: "Office/Room Assignment" },
                  ]}
                />
              </div>

              {assignmentType === "individual" && (
                <div>
                  <Label htmlFor="assigned_to">Assign To *</Label>
                  <SearchableSelect
                    value={assignedTo}
                    onValueChange={(value) => setValue("assigned_to", value)}
                    placeholder="Select employees member"
                    searchPlaceholder="Search employees..."
                    icon={<User className="h-4 w-4" />}
                    options={activeEmployees.map((member) => ({
                      value: member.id,
                      label: `${formatName(member.first_name)} ${formatName(member.last_name)} - ${member.department}`,
                      icon: <User className="h-3 w-3" />,
                    }))}
                  />
                </div>
              )}

              {assignmentType === "department" && (
                <div>
                  <Label htmlFor="assignment_department">Department *</Label>
                  <SearchableSelect
                    value={assignmentDepartment}
                    onValueChange={(value) => setValue("assignment_department", value)}
                    placeholder="Select department"
                    searchPlaceholder="Search departments..."
                    icon={<Building2 className="h-4 w-4" />}
                    options={departments.map((dept) => ({
                      value: dept,
                      label: dept,
                      icon: <Building2 className="h-3 w-3" />,
                    }))}
                  />
                </div>
              )}

              {assignmentType === "office" && (
                <div>
                  <Label htmlFor="office_location">Assigned Room / Office *</Label>
                  <SearchableSelect
                    value={officeLocation}
                    onValueChange={(value) => setValue("office_location", value)}
                    placeholder="Select room or office"
                    searchPlaceholder="Search rooms and offices..."
                    icon={<Building className="h-4 w-4" />}
                    options={officeLocations.map((location) => ({
                      value: location,
                      label: location,
                      icon: <Building className="h-3 w-3" />,
                    }))}
                  />
                </div>
              )}

              {/* Added: Manual Override for Assigned By & At */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="assigned_by">Assigned By (Optional Override)</Label>
                  <SearchableSelect
                    value={watch("assigned_by")}
                    onValueChange={(value) => setValue("assigned_by", value)}
                    placeholder="Select assigner (defaults to you)"
                    searchPlaceholder="Search employees..."
                    icon={<User className="h-4 w-4" />}
                    options={activeEmployees.map((employee) => ({
                      value: employee.id,
                      label: `${formatName(employee.last_name)}, ${formatName(employee.first_name)}`,
                      secondaryLabel: employee.department,
                      icon: <User className="h-3 w-3" />,
                    }))}
                  />
                </div>
                <div>
                  <Label htmlFor="assigned_at">Assigned Date (Optional Override)</Label>
                  <Input type="datetime-local" id="assigned_at" {...register("assigned_at")} />
                </div>
              </div>

              <div>
                <Label htmlFor="assignment_notes">Assignment Notes (Optional)</Label>
                <Textarea
                  id="assignment_notes"
                  {...register("assignment_notes")}
                  placeholder="Notes about this assignment..."
                  rows={2}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            loading={isSaving}
            disabled={
              // For both create and edit: asset_type is required
              !assetType ||
              // For edit: check if anything changed
              (selectedAsset
                ? assetType === originalAssetForm.asset_type &&
                  acquisitionYear === originalAssetForm.acquisition_year &&
                  watch("asset_model") === originalAssetForm.asset_model &&
                  serialNumber === originalAssetForm.serial_number &&
                  statusValue === originalAssetForm.status &&
                  // Check assignment details
                  assignmentType === originalAssetForm.assignment_type &&
                  assignedTo === originalAssetForm.assigned_to &&
                  assignmentDepartment === originalAssetForm.assignment_department &&
                  officeLocation === originalAssetForm.office_location &&
                  watch("assignment_notes") === originalAssetForm.assignment_notes &&
                  watch("assigned_by") === originalAssetForm.assigned_by &&
                  watch("assigned_at") === originalAssetForm.assigned_at
                : false) ||
              // For create with "assigned" status: validate assignment fields (only when creating, not editing)
              (!selectedAsset && (!Number.isInteger(batchQuantity) || batchQuantity < 1 || batchQuantity > 100)) ||
              (!selectedAsset && batchQuantity > 1 && !!String(serialNumber || "").trim()) ||
              (!selectedAsset && statusValue === "assigned" && assignmentType === "individual" && !assignedTo) ||
              (!selectedAsset &&
                statusValue === "assigned" &&
                assignmentType === "department" &&
                !assignmentDepartment) ||
              (!selectedAsset && statusValue === "assigned" && assignmentType === "office" && !officeLocation)
            }
          >
            {selectedAsset ? "Update Asset" : batchQuantity > 1 ? `Create ${batchQuantity} Assets` : "Create Asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
