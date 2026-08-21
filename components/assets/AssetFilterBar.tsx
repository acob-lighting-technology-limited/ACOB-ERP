"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { formatName } from "@/lib/utils"
import { useOfficeLocations } from "@/hooks/use-office-locations"
import {
  Download,
  FileText,
  Users,
  Search,
  Package,
  Filter,
  Calendar,
  Building,
  AlertCircle,
  CheckCircle2,
  Building2,
  User,
} from "lucide-react"
import type { Employee } from "@/app/admin/assets/admin-assets-content"

interface AssetFilterBarProps {
  // Search and filter state
  searchQuery: string
  setSearchQuery: (v: string) => void
  statusFilter: string[]
  setStatusFilter: (v: string[]) => void
  departmentFilter: string[]
  setDepartmentFilter: (v: string[]) => void
  userFilter: string[]
  setUserFilter: (v: string[]) => void
  yearFilter: string[]
  setYearFilter: (v: string[]) => void
  officeLocationFilter: string[]
  setOfficeLocationFilter: (v: string[]) => void
  assetTypeFilter: string[]
  setAssetTypeFilter: (v: string[]) => void
  issueStatusFilter: string[]
  setIssueStatusFilter: (v: string[]) => void
  // Data
  assetTypes: { label: string; code: string; requiresSerialModel: boolean }[]
  departments: string[]
  activeEmployees: Employee[]
  acquisitionYears: number[]
  // User profile flags
  isDepartmentLead: boolean
}

interface AssetExportBarProps {
  filteredAssetsCount: number
  employeesCount: number
  onExportClick: (type: "excel" | "pdf" | "word") => void
  onEmployeeReportClick: (type: "excel" | "pdf" | "word") => void
}

export function AssetExportBar({
  filteredAssetsCount,
  employeesCount,
  onExportClick,
  onEmployeeReportClick,
}: AssetExportBarProps) {
  return (
    <Card className="border-2">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Download className="text-muted-foreground h-4 w-4" />
              <span className="text-foreground text-sm font-medium">Export Assets:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExportClick("excel")}
                className="gap-2"
                disabled={filteredAssetsCount === 0}
              >
                <FileText className="h-4 w-4" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExportClick("pdf")}
                className="gap-2"
                disabled={filteredAssetsCount === 0}
              >
                <FileText className="h-4 w-4" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onExportClick("word")}
                className="gap-2"
                disabled={filteredAssetsCount === 0}
              >
                <FileText className="h-4 w-4" />
                Word
              </Button>
            </div>
          </div>

          <div className="bg-border hidden h-8 w-px md:block" />

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Users className="text-muted-foreground h-4 w-4" />
              <span className="text-foreground text-sm font-medium">Employee Assets Report:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEmployeeReportClick("excel")}
                className="gap-2"
                disabled={employeesCount === 0}
              >
                <FileText className="h-4 w-4" />
                Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEmployeeReportClick("pdf")}
                className="gap-2"
                disabled={employeesCount === 0}
              >
                <FileText className="h-4 w-4" />
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEmployeeReportClick("word")}
                className="gap-2"
                disabled={employeesCount === 0}
              >
                <FileText className="h-4 w-4" />
                Word
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function AssetFilterBar({
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  departmentFilter,
  setDepartmentFilter,
  userFilter,
  setUserFilter,
  yearFilter,
  setYearFilter,
  officeLocationFilter,
  setOfficeLocationFilter,
  assetTypeFilter,
  setAssetTypeFilter,
  issueStatusFilter,
  setIssueStatusFilter,
  assetTypes,
  departments,
  activeEmployees,
  acquisitionYears,
  isDepartmentLead,
}: AssetFilterBarProps) {
  const { officeLocations } = useOfficeLocations()
  return (
    <Card className="border-2">
      <CardContent className="p-6">
        <div className="space-y-4">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
            <Input
              placeholder="Search assets by code, type, model, serial, year, status, location, or assigned user..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <SearchableMultiSelect
              label="Asset Types"
              icon={<Package className="h-4 w-4" />}
              values={assetTypeFilter}
              options={assetTypes.map((type) => ({
                value: type.code,
                label: type.label,
              }))}
              onChange={setAssetTypeFilter}
              placeholder="All Types"
            />
            <SearchableMultiSelect
              label="Status"
              icon={<Filter className="h-4 w-4" />}
              values={statusFilter}
              options={[
                { value: "available", label: "Available" },
                { value: "assigned", label: "Assigned" },
                { value: "maintenance", label: "Maintenance" },
                { value: "retired", label: "Retired" },
                { value: "archived", label: "Archived" },
              ]}
              onChange={setStatusFilter}
              placeholder="All Status"
            />
            <SearchableMultiSelect
              label="Years"
              icon={<Calendar className="h-4 w-4" />}
              values={yearFilter}
              options={acquisitionYears
                .filter(Boolean)
                .sort((a, b) => (b || 0) - (a || 0))
                .map((year) => ({
                  value: year?.toString() || "",
                  label: year?.toString() || "",
                }))}
              onChange={setYearFilter}
              placeholder="All Years"
            />
            <SearchableMultiSelect
              label="Rooms & Offices"
              icon={<Building className="h-4 w-4" />}
              values={officeLocationFilter}
              options={officeLocations.map((location) => ({
                value: location,
                label: location,
                icon: <Building className="h-3 w-3" />,
              }))}
              onChange={setOfficeLocationFilter}
              placeholder="All Rooms & Offices"
            />
            <SearchableMultiSelect
              label="Issue Status"
              icon={<AlertCircle className="h-4 w-4" />}
              values={issueStatusFilter}
              options={[
                {
                  value: "has_issues",
                  label: "Has Issues",
                  icon: <AlertCircle className="h-3 w-3 text-orange-500" />,
                },
                {
                  value: "no_issues",
                  label: "No Issues",
                  icon: <CheckCircle2 className="h-3 w-3 text-green-500" />,
                },
              ]}
              onChange={setIssueStatusFilter}
              placeholder="All Assets"
            />
            {!isDepartmentLead && (
              <SearchableMultiSelect
                label="Departments"
                icon={<Building2 className="h-4 w-4" />}
                values={departmentFilter}
                options={departments.map((dept) => ({
                  value: dept,
                  label: dept,
                  icon: <Building2 className="h-3 w-3" />,
                }))}
                onChange={setDepartmentFilter}
                placeholder="All Departments"
              />
            )}
            <SearchableMultiSelect
              label="Users"
              icon={<User className="h-4 w-4" />}
              values={userFilter}
              options={activeEmployees.map((member) => ({
                value: member.id,
                label: `${formatName(member.first_name)} ${formatName(member.last_name)} - ${member.department}`,
                icon: <User className="h-3 w-3" />,
              }))}
              onChange={setUserFilter}
              placeholder={
                isDepartmentLead && departments.length > 0
                  ? `All ${departments.length === 1 ? departments[0] : "Department"} Users`
                  : "All Users"
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
