"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { Printer, Download, Loader2, User, Laptop, Calendar, ShieldCheck } from "lucide-react"
import { formatName } from "@/lib/utils"
import { toLocalISODate } from "@/lib/utils/date"
import { ASSET_TYPE_MAP } from "@/lib/asset-types"
import {
  downloadHandoverPolicyPDF,
  printHandoverPolicyPDF,
  type HandoverPolicyData,
} from "@/lib/assets/handover-pdf-generator"
import type { Asset, UserProfile, Employee } from "@/app/admin/assets/admin-assets-content"

type ExtendedEmployee = Employee & {
  designation?: string
  residential_address?: string
}

type ExtendedAssignment = {
  assigned_to?: string
  department?: string
  office_location?: string
  assignment_type?: string
  assigned_at?: string
  assigned_by?: string
  assigned_by_user?: {
    first_name: string
    last_name: string
  }
  user?: {
    first_name: string
    last_name: string
    designation?: string
    residential_address?: string
  }
}

interface AssetHandoverDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: Asset | null
  userProfile?: UserProfile & { first_name?: string; last_name?: string }
  employees?: ExtendedEmployee[]
}

export function AssetHandoverDialog({
  open,
  onOpenChange,
  asset,
  userProfile,
  employees = [],
}: AssetHandoverDialogProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [formData, setFormData] = useState<HandoverPolicyData>({
    employeeName: "",
    department: "",
    designation: "",
    residentialAddress: "",
    assetType: "Laptop",
    assetModel: "",
    serialNumber: "",
    uniqueCode: "",
    accessories: "",
    condition: "",
    handoverDate: toLocalISODate(),
    issuingStaffName: "",
    includeDate: true,
  })

  // Auto-populate when dialog opens with selected asset
  useEffect(() => {
    if (!asset || !open) return

    const assignment = asset.current_assignment as ExtendedAssignment | undefined

    // Find assigned employee
    const assignedId = assignment?.assigned_to
    const assignedUser = assignment?.user
    const matchedEmployee = employees.find((e) => e.id === assignedId)

    const empFirst = matchedEmployee?.first_name || assignedUser?.first_name || ""
    const empLast = matchedEmployee?.last_name || assignedUser?.last_name || ""
    const empFullName = empFirst && empLast ? `${formatName(empFirst)} ${formatName(empLast)}`.trim() : ""

    const dept = matchedEmployee?.department || assignment?.department || asset.department || ""

    const designation = matchedEmployee?.designation || assignedUser?.designation || ""
    const address = matchedEmployee?.residential_address || assignedUser?.residential_address || ""

    // Resolve issuing staff from the historical assignment (assigned_by), falling back to logged-in user
    const assignerUser = assignment?.assigned_by_user
    const assignerEmployee = employees.find((e) => e.id === assignment?.assigned_by)
    let issuerName = ""
    if (assignerUser?.first_name && assignerUser?.last_name) {
      issuerName = `${formatName(assignerUser.first_name)} ${formatName(assignerUser.last_name)}`.trim()
    } else if (assignerEmployee?.first_name && assignerEmployee?.last_name) {
      issuerName = `${formatName(assignerEmployee.first_name)} ${formatName(assignerEmployee.last_name)}`.trim()
    } else if (userProfile?.first_name && userProfile?.last_name) {
      issuerName = `${formatName(userProfile.first_name)} ${formatName(userProfile.last_name)}`.trim()
    } else if (userProfile?.role) {
      issuerName = `${userProfile.role.toUpperCase()} Admin`
    }

    // Resolve date of handover from the actual assignment date (assigned_at), falling back to today
    let handoverDateVal = toLocalISODate()
    if (assignment?.assigned_at) {
      try {
        const d = new Date(assignment.assigned_at)
        if (!isNaN(d.getTime())) {
          handoverDateVal = toLocalISODate(d)
        }
      } catch {
        // fallback
      }
    }

    const assetTypeLabel = ASSET_TYPE_MAP[asset.asset_type]?.label || asset.asset_type || "Laptop"

    setFormData({
      employeeName: empFullName || "",
      department: dept || "",
      designation: designation || "",
      residentialAddress: address || "",
      assetType: assetTypeLabel,
      assetModel: asset.asset_model || "",
      serialNumber: asset.serial_number || "",
      uniqueCode: asset.unique_code || "",
      accessories: "",
      condition: "",
      handoverDate: handoverDateVal,
      signatureDate: toLocalISODate(),
      issuingStaffName: issuerName,
      includeDate: true,
    })
  }, [asset, open, employees, userProfile])

  const handlePrint = async () => {
    if (!formData.employeeName?.trim()) {
      toast.error("Please provide the employee name")
      return
    }
    setIsGenerating(true)
    try {
      await printHandoverPolicyPDF(formData)
      toast.success("Print dialog initiated")
    } catch (err: unknown) {
      toast.error("Failed to generate PDF for printing")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownload = async () => {
    if (!formData.employeeName?.trim()) {
      toast.error("Please provide the employee name")
      return
    }
    setIsGenerating(true)
    try {
      await downloadHandoverPolicyPDF(formData)
      toast.success("PDF downloaded successfully")
    } catch (err: unknown) {
      toast.error("Failed to download PDF")
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[650px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Asset Handover Policy & Form</DialogTitle>
              <DialogDescription>
                Review and configure details to print the official 5-page policy document.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Section 1: Staff Info */}
          <div className="bg-muted/30 space-y-3 rounded-lg border p-3.5">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
              <User className="h-3.5 w-3.5" />
              <span>Collecting Staff Information</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="employeeName" className="text-xs">
                  Full Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="employeeName"
                  value={formData.employeeName}
                  onChange={(e) => setFormData((p) => ({ ...p, employeeName: e.target.value }))}
                  placeholder="e.g. Vanessa Lawrence-Ukaegbu"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="department" className="text-xs">
                  Department
                </Label>
                <Input
                  id="department"
                  value={formData.department}
                  onChange={(e) => setFormData((p) => ({ ...p, department: e.target.value }))}
                  placeholder="e.g. Human Resources"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="designation" className="text-xs">
                  Designation / Role
                </Label>
                <Input
                  id="designation"
                  value={formData.designation}
                  onChange={(e) => setFormData((p) => ({ ...p, designation: e.target.value }))}
                  placeholder="e.g. Lead, HR & Admin"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="residentialAddress" className="text-xs">
                  Home Address
                </Label>
                <Input
                  id="residentialAddress"
                  value={formData.residentialAddress}
                  onChange={(e) => setFormData((p) => ({ ...p, residentialAddress: e.target.value }))}
                  placeholder="e.g. Abuja, FCT"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Asset Info */}
          <div className="bg-muted/30 space-y-3 rounded-lg border p-3.5">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
              <Laptop className="h-3.5 w-3.5" />
              <span>Device & Asset Details</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="assetType" className="text-xs">
                  Asset Type
                </Label>
                <Input
                  id="assetType"
                  value={formData.assetType}
                  onChange={(e) => setFormData((p) => ({ ...p, assetType: e.target.value }))}
                  placeholder="e.g. Laptop"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="assetModel" className="text-xs">
                  Brand / Model
                </Label>
                <Input
                  id="assetModel"
                  value={formData.assetModel}
                  onChange={(e) => setFormData((p) => ({ ...p, assetModel: e.target.value }))}
                  placeholder="e.g. Dell Latitude 7430"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="serialNumber" className="text-xs">
                  Serial Number
                </Label>
                <Input
                  id="serialNumber"
                  value={formData.serialNumber}
                  onChange={(e) => setFormData((p) => ({ ...p, serialNumber: e.target.value }))}
                  placeholder="e.g. 2R0FKR3"
                  className="font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="uniqueCode" className="text-xs">
                  Unique Code
                </Label>
                <Input
                  id="uniqueCode"
                  value={formData.uniqueCode}
                  onChange={(e) => setFormData((p) => ({ ...p, uniqueCode: e.target.value }))}
                  placeholder="e.g. ACOB/HQ/LAP/2026/028"
                  className="font-mono"
                />
              </div>

              <div className="col-span-1 space-y-1.5 sm:col-span-2">
                <Label htmlFor="accessories" className="text-xs">
                  Accessories Handed Over
                </Label>
                <Input
                  id="accessories"
                  value={formData.accessories}
                  onChange={(e) => setFormData((p) => ({ ...p, accessories: e.target.value }))}
                  placeholder="e.g. Charger, Power Cable, Laptop Bag"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Handover & Issuer */}
          <div className="bg-muted/30 space-y-3 rounded-lg border p-3.5">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
              <Calendar className="h-3.5 w-3.5" />
              <span>Issuing & Handover Settings</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="issuingStaffName" className="text-xs">
                  Name of Issuing Staff
                </Label>
                <Input
                  id="issuingStaffName"
                  value={formData.issuingStaffName}
                  onChange={(e) => setFormData((p) => ({ ...p, issuingStaffName: e.target.value }))}
                  placeholder="e.g. IT Lead / Officer"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="handoverDate" className="text-xs">
                  Date of Handover
                </Label>
                <Input
                  id="handoverDate"
                  type="date"
                  disabled={!formData.includeDate}
                  value={formData.handoverDate}
                  onChange={(e) => setFormData((p) => ({ ...p, handoverDate: e.target.value }))}
                />
              </div>

              <div className="col-span-1 flex items-center space-x-2 pt-1 sm:col-span-2">
                <Checkbox
                  id="includeDate"
                  checked={formData.includeDate}
                  onCheckedChange={(checked) => setFormData((p) => ({ ...p, includeDate: Boolean(checked) }))}
                />
                <Label htmlFor="includeDate" className="text-muted-foreground cursor-pointer text-xs font-normal">
                  Pre-fill date on document (uncheck to leave date line blank for handwritten date)
                </Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isGenerating}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleDownload} disabled={isGenerating} className="gap-1.5">
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download PDF
            </Button>
            <Button
              onClick={handlePrint}
              disabled={isGenerating}
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Print PDF
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
