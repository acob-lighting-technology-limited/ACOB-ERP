"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Users, UserPlus, Mail, Plus, Search, X, UserCheck } from "lucide-react"

type Employee = {
  id: string
  full_name: string
  company_email: string | null
  additional_email: string | null
  department: string | null
  employment_status: string | null
  is_department_lead: boolean | null
  gender: string | null
}

type RecipientMode = "all" | "select" | "manual" | "all_plus" | "leads_only" | "males_only" | "females_only"

interface RecipientSelectorProps {
  employees: Employee[]
  recipientMode: RecipientMode
  setRecipientMode: (v: RecipientMode) => void
  selectedEmployeeIds: Set<string>
  toggleEmployee: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  searchQuery: string
  setSearchQuery: (v: string) => void
  filteredEmployees: Employee[]
  manualEmails: string[]
  manualInput: string
  setManualInput: (v: string) => void
  addManualEmail: () => void
  removeManualEmail: (email: string) => void
}

export function RecipientSelector({
  employees,
  recipientMode,
  setRecipientMode,
  selectedEmployeeIds,
  toggleEmployee,
  selectAll,
  deselectAll,
  searchQuery,
  setSearchQuery,
  filteredEmployees,
  manualEmails,
  manualInput,
  setManualInput,
  addManualEmail,
  removeManualEmail,
}: RecipientSelectorProps) {
  return (
    <div className="space-y-4">
      {/* Mode Pills */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: "all", label: "All Employees", icon: Users },
          { value: "leads_only", label: "Leads Only", icon: UserCheck },
          { value: "males_only", label: "Males Only", icon: Users },
          { value: "females_only", label: "Females Only", icon: Users },
          { value: "select", label: "Select Specific", icon: UserPlus },
          { value: "manual", label: "Enter Manually", icon: Mail },
          { value: "all_plus", label: "All + Add More", icon: Plus },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setRecipientMode(opt.value as RecipientMode)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
              recipientMode === opt.value
                ? "bg-orange-600 text-white shadow-md"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            <opt.icon className="h-4 w-4" />
            {opt.label}
          </button>
        ))}
      </div>

      {/* Employee Selection */}
      {recipientMode === "select" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search by name, email, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={deselectAll}>
              Clear
            </Button>
          </div>
          <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-lg border p-2">
            {filteredEmployees.map((emp) => (
              <label
                key={emp.id}
                className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors ${
                  selectedEmployeeIds.has(emp.id) ? "bg-orange-50 dark:bg-orange-950/20" : "hover:bg-muted/50"
                }`}
              >
                <Checkbox checked={selectedEmployeeIds.has(emp.id)} onCheckedChange={() => toggleEmployee(emp.id)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{emp.full_name}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {[emp.company_email, emp.additional_email].filter(Boolean).join(" | ")}
                  </div>
                </div>
                {emp.department && (
                  <Badge variant="secondary" className="shrink-0 text-xs">
                    {emp.department}
                  </Badge>
                )}
              </label>
            ))}
            {filteredEmployees.length === 0 && (
              <div className="text-muted-foreground py-8 text-center text-sm">No employees found</div>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {selectedEmployeeIds.size} of {employees.length} selected
          </p>
        </div>
      )}

      {/* Manual Email Input */}
      {(recipientMode === "manual" || recipientMode === "all_plus") && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Enter email address..."
              type="email"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  addManualEmail()
                }
              }}
              className="flex-1"
            />
            <Button variant="outline" onClick={addManualEmail}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
          {manualEmails.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {manualEmails.map((email) => (
                <Badge key={email} variant="secondary" className="gap-1.5 py-1.5 pr-1.5 pl-3">
                  {email}
                  <button
                    type="button"
                    onClick={() => removeManualEmail(email)}
                    className="hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {recipientMode === "all_plus" && (
            <p className="text-muted-foreground text-xs">
              All {employees.length} employee emails will be included, plus any emails you add above.
            </p>
          )}
        </div>
      )}

      {recipientMode === "all" && (
        <p className="text-muted-foreground text-sm">
          The reminder will be sent to all <strong>{employees.length}</strong> active employees.
        </p>
      )}
      {recipientMode === "leads_only" && (
        <p className="text-muted-foreground text-sm">The reminder will be sent to all department leads.</p>
      )}
      {recipientMode === "males_only" && (
        <p className="text-muted-foreground text-sm">The reminder will be sent to all male employees.</p>
      )}
      {recipientMode === "females_only" && (
        <p className="text-muted-foreground text-sm">The reminder will be sent to all female employees.</p>
      )}
    </div>
  )
}
