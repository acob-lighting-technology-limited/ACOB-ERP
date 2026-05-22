"use client"

import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select"
import { Search, Building2, Shield, UserCircle, User } from "lucide-react"
import { formatName } from "@/lib/utils"
import { getRoleDisplayName } from "@/lib/permissions"
import type { UserRole } from "@/types/database"
import type { Employee } from "@/app/admin/hr/employees/admin-employee-content"

interface Filters {
  searchQuery: string
  departmentFilter: string[]
  employeeFilter: string[]
  roleFilter: string[]
  statusFilter: string[]
}

interface EmployeeFilterBarProps {
  filters: Filters
  onFilterChange: (filters: Partial<Filters>) => void
  departments: string[]
  employees: Employee[]
  roles: UserRole[]
}

export function EmployeeFilterBar({ filters, onFilterChange, departments, employees, roles }: EmployeeFilterBarProps) {
  return (
    <Card className="border-2">
      <CardContent className="p-6">
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="relative w-full">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform" />
            <Input
              placeholder="Search employees by name, email, or designation..."
              value={filters.searchQuery}
              onChange={(e) => onFilterChange({ searchQuery: e.target.value })}
              className="pl-10"
            />
          </div>

          {/* Filter Buttons */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <SearchableMultiSelect
              label="Departments"
              icon={<Building2 className="h-4 w-4" />}
              values={filters.departmentFilter}
              options={departments.map((dept) => ({
                value: dept,
                label: dept,
                icon: <Building2 className="h-3 w-3" />,
              }))}
              onChange={(values) => onFilterChange({ departmentFilter: values })}
              placeholder="Department"
            />
            <SearchableMultiSelect
              label="Employee Members"
              icon={<User className="h-4 w-4" />}
              values={filters.employeeFilter}
              options={employees.map((member) => ({
                value: member.id,
                label: `${formatName(member.first_name)} ${formatName(member.last_name)} - ${member.department || "No Dept"}`,
                icon: <User className="h-3 w-3" />,
              }))}
              onChange={(values) => onFilterChange({ employeeFilter: values })}
              placeholder="Employee"
            />
            <SearchableMultiSelect
              label="Roles"
              icon={<Shield className="h-4 w-4" />}
              values={filters.roleFilter}
              options={roles.map((role) => ({
                value: role,
                label: getRoleDisplayName(role),
              }))}
              onChange={(values) => onFilterChange({ roleFilter: values })}
              placeholder="Role"
            />
            <SearchableMultiSelect
              label="Status"
              icon={<UserCircle className="h-4 w-4" />}
              values={filters.statusFilter}
              options={[
                { value: "active", label: "Active" },
                { value: "suspended", label: "Suspended" },
                { value: "exited", label: "Exited" },
                { value: "on_leave", label: "On Leave" },
              ]}
              onChange={(values) => onFilterChange({ statusFilter: values })}
              placeholder="Status"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
