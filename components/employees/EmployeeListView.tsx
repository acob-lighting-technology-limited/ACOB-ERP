"use client"

import { Fragment, useState } from "react"
import { cn, formatName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmployeeStatusBadge } from "@/components/hr/employee-status-badge"
import {
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Mail,
  Building2,
  UserCog,
  Phone,
  MapPin,
  Shield,
  Users,
  ChevronDown,
  ChevronRight,
  Calendar,
  IdCard,
} from "lucide-react"
import type { UserRole } from "@/types/database"
import type { Employee } from "@/app/admin/hr/employees/admin-employee-content"

interface EmployeeListViewProps {
  employees: Employee[]
  viewMode: "list" | "card"
  sortConfig: { key: string; direction: "asc" | "desc" }
  onSortChange: (updated: { key: string; direction: "asc" | "desc" }) => void
  onViewDetails: (employee: Employee) => void
  hasActiveFilters: boolean
  getRoleBadgeColor: (role: UserRole) => string
  getRoleDisplayName: (role: UserRole) => string
}

export function EmployeeListView({
  employees,
  viewMode,
  sortConfig,
  onSortChange,
  onViewDetails,
  hasActiveFilters,
  getRoleBadgeColor,
  getRoleDisplayName,
}: EmployeeListViewProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const toggleRow = (employeeId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(employeeId)) next.delete(employeeId)
      else next.add(employeeId)
      return next
    })
  }

  if (employees.length === 0) {
    return (
      <Card className="border-2">
        <CardContent className="p-12 text-center">
          <Users className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
          <h3 className="text-foreground mb-2 text-xl font-semibold">No Employee Found</h3>
          <p className="text-muted-foreground">
            {hasActiveFilters ? "No employees matches your filters" : "No employees members found"}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (viewMode === "list") {
    return (
      <Card className="border-2">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead className="w-12">#</TableHead>
                <TableHead>
                  <div className="flex items-center gap-2">
                    <span>Emp. No.</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onSortChange({
                          key: "employee_number",
                          direction:
                            sortConfig.key === "employee_number" && sortConfig.direction === "asc" ? "desc" : "asc",
                        })
                      }
                      className="h-6 w-6 p-0"
                    >
                      {sortConfig.key === "employee_number" ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="text-muted-foreground/30 h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </TableHead>
                <TableHead>
                  <div className="flex items-center gap-2">
                    <span>Name</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onSortChange({
                          key: "last_name",
                          direction: sortConfig.key === "last_name" && sortConfig.direction === "asc" ? "desc" : "asc",
                        })
                      }
                      className="h-6 w-6 p-0"
                    >
                      {sortConfig.key === "last_name" ? (
                        sortConfig.direction === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="text-muted-foreground/30 h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((member, index) => {
                const isExpanded = expandedRows.has(member.id)
                const fullName =
                  `${formatName(member.first_name)} ${formatName(member.other_names || "")} ${formatName(member.last_name)}`
                    .replace(/\s+/g, " ")
                    .trim()
                const leadDepartments = member.lead_departments.filter(Boolean)
                const createdAt = member.created_at ? formatWATDate(member.created_at) : "-"
                const employmentDate = member.employment_date ? formatWATDate(member.employment_date) : "-"

                return (
                  <Fragment key={member.id}>
                    <TableRow
                      className={cn(
                        "hover:bg-muted/30 cursor-pointer transition-colors",
                        member.employment_status === "exited" && "opacity-60",
                        member.is_department_lead && "border-l-2 border-l-amber-500/70",
                        isExpanded && "bg-muted/30"
                      )}
                      onClick={() => toggleRow(member.id)}
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="text-muted-foreground h-4 w-4" />
                        ) : (
                          <ChevronRight className="text-muted-foreground h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                      <TableCell>
                        <span className="text-muted-foreground font-mono text-sm">{member.employee_number || "-"}</span>
                      </TableCell>
                      <TableCell>
                        <div className="whitespace-nowrap">
                          <span
                            className={cn(
                              "text-foreground font-medium",
                              member.employment_status === "exited" && "text-muted-foreground line-through"
                            )}
                          >
                            {formatName(member.last_name)}, {formatName(member.first_name)}
                          </span>
                          {member.is_department_lead && (
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                              <Shield className="h-3 w-3" />
                              <span>Dept Lead</span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-muted-foreground flex flex-col gap-1 text-sm">
                          <div className="flex items-center gap-2">
                            <Mail className="h-3 w-3" />
                            <span className="max-w-[200px] truncate">{member.company_email}</span>
                          </div>
                          {member.additional_email && (
                            <div className="pl-5 text-xs">
                              <span className="text-muted-foreground/80 max-w-[200px] truncate">
                                {member.additional_email}
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-foreground text-sm">{member.department || "-"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge className={getRoleBadgeColor(member.role)}>{getRoleDisplayName(member.role)}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <EmployeeStatusBadge status={member.employment_status || "active"} size="sm" />
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 sm:gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs sm:h-auto sm:text-sm"
                            onClick={() => onViewDetails(member)}
                          >
                            <span className="hidden sm:inline">View</span>
                            <span className="sm:hidden">👁</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/10 hover:bg-muted/10 border-t-0">
                        <TableCell colSpan={9} className="p-0">
                          <div className="animate-in slide-in-from-top-2 grid grid-cols-1 gap-4 p-6 duration-200 md:grid-cols-3">
                            <div className="space-y-3 rounded-lg border bg-white/60 p-4 dark:bg-slate-950/40">
                              <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-blue-600 uppercase">
                                <IdCard className="h-3.5 w-3.5" />
                                Identity
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Full Name</span>
                                  <span className="text-foreground text-right font-medium">{fullName || "-"}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Employee No.</span>
                                  <span className="text-foreground font-mono text-xs">
                                    {member.employee_number || "-"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Role</span>
                                  <span className="text-foreground text-right font-medium">
                                    {getRoleDisplayName(member.role)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Status</span>
                                  <EmployeeStatusBadge status={member.employment_status || "active"} size="sm" />
                                </div>
                              </div>
                            </div>
                            <div className="space-y-3 rounded-lg border bg-white/60 p-4 dark:bg-slate-950/40">
                              <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-emerald-600 uppercase">
                                <Building2 className="h-3.5 w-3.5" />
                                Work Info
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Department</span>
                                  <span className="text-foreground text-right font-medium">
                                    {member.department || "-"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Designation</span>
                                  <span className="text-foreground text-right font-medium">
                                    {member.designation || "-"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Office Location</span>
                                  <span className="text-foreground text-right font-medium">
                                    {member.office_location || "-"}
                                  </span>
                                </div>
                                <div className="flex items-start justify-between gap-3">
                                  <span className="text-muted-foreground pt-1">Lead Scope</span>
                                  <div className="flex max-w-[70%] flex-wrap justify-end gap-1">
                                    {leadDepartments.length > 0 ? (
                                      leadDepartments.map((dept) => (
                                        <Badge key={dept} variant="outline" className="text-xs">
                                          {dept}
                                        </Badge>
                                      ))
                                    ) : (
                                      <span className="text-foreground font-medium">-</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="space-y-3 rounded-lg border bg-white/60 p-4 dark:bg-slate-950/40">
                              <h4 className="flex items-center gap-2 text-[10px] font-black tracking-widest text-amber-600 uppercase">
                                <Calendar className="h-3.5 w-3.5" />
                                Contact & Dates
                              </h4>
                              <div className="space-y-2 text-sm">
                                <div className="flex items-start gap-2">
                                  <Mail className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-foreground font-medium break-all">
                                      {member.company_email || "-"}
                                    </p>
                                    {member.additional_email && (
                                      <p className="text-muted-foreground text-xs break-all">
                                        {member.additional_email}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Phone className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                                  <span className="text-foreground font-medium">{member.phone_number || "-"}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <MapPin className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                                  <span className="text-foreground font-medium">
                                    {member.office_location || "No office location"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-3 pt-1">
                                  <span className="text-muted-foreground">Employment Date</span>
                                  <span className="text-foreground font-medium">{employmentDate}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-muted-foreground">Profile Created</span>
                                  <span className="text-foreground font-medium">{createdAt}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {employees.map((member) => (
        <Card
          key={member.id}
          className={`border-2 transition-shadow hover:shadow-lg ${member.employment_status === "exited" ? "opacity-60" : ""}`}
        >
          <CardHeader className="from-primary/5 to-background border-b bg-linear-to-r">
            <div className="flex items-start justify-between">
              <div className="flex flex-1 items-start gap-3">
                <div className="bg-primary/10 rounded-lg p-2">
                  <Users className="text-primary h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle
                    className={cn(
                      "text-lg",
                      member.employment_status === "exited" && "text-muted-foreground line-through"
                    )}
                  >
                    {member.first_name} {member.last_name}
                  </CardTitle>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge className={getRoleBadgeColor(member.role)}>{getRoleDisplayName(member.role)}</Badge>
                    <EmployeeStatusBadge status={member.employment_status || "active"} size="sm" />
                    {member.is_department_lead && member.lead_departments && member.lead_departments.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {member.lead_departments.length} Dept
                        {member.lead_departments.length > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{member.company_email}</span>
                {member.additional_email && (
                  <span className="text-muted-foreground/80 truncate text-xs">{member.additional_email}</span>
                )}
              </div>
            </div>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4" />
              <span>{member.department || "-"}</span>
            </div>
            {member.designation && (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <UserCog className="h-4 w-4" />
                <span>{member.designation}</span>
              </div>
            )}
            {member.phone_number && (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4" />
                <span>{member.phone_number}</span>
              </div>
            )}
            {member.office_location && (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4" />
                <span>{member.office_location}</span>
              </div>
            )}
            {member.is_department_lead && member.lead_departments.length > 0 && (
              <div className="border-t pt-2">
                <p className="text-muted-foreground mb-1 text-xs">Leading:</p>
                <div className="flex flex-wrap gap-1">
                  {member.lead_departments.map((dept, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                    >
                      {dept}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onViewDetails(member)} className="flex-1">
                View Profile
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
