"use client"

import { useState, useMemo } from "react"
import { useDepartments } from "@/hooks/use-departments"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Download, Upload } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { AdminUserModal } from "./admin-user-modal"
import { AdminUserTable } from "@/components/admin/AdminUserTable"
import { AdminUserDetailsDialog } from "@/components/admin/AdminUserDetailsDialog"
import { toLocalISODate } from "@/lib/utils/date"
import { apiFetch } from "@/lib/api-client"

interface AdminDashboardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  users: any[]
  currentUserId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  feedbackByUserId?: Record<string, any[]>
}

type SortKey = "last_name" | "first_name" | "company_email" | "department" | null

export function AdminDashboard({ users, currentUserId: _currentUserId, feedbackByUserId = {} }: AdminDashboardProps) {
  const { departments: dbDepartments } = useDepartments()
  const DEPARTMENTS = useMemo(() => ["All Departments", ...dbDepartments], [dbDepartments])
  const [selectedDepartment, setSelectedDepartment] = useState("All Departments")
  const [searchTerm, setSearchTerm] = useState("")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [showImportConfirm, setShowImportConfirm] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [detailsUser, setDetailsUser] = useState<any | null>(null)

  const filteredUsers = useMemo(() => {
    let filtered = users

    if (selectedDepartment !== "All Departments") {
      filtered = filtered.filter((user) => user.department === selectedDepartment)
    }

    if (searchTerm) {
      filtered = filtered.filter(
        (user) =>
          user.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          user.last_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          user.company_email?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    if (!sortKey) return filtered
    return [...filtered].sort((a, b) => {
      const av = (a[sortKey] || "").toString().toLowerCase()
      const bv = (b[sortKey] || "").toString().toLowerCase()
      if (av < bv) return sortDir === "asc" ? -1 : 1
      if (av > bv) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [users, selectedDepartment, searchTerm, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const exportToCSV = () => {
    const headers = ["First Name", "Last Name", "Department", "Designation", "Email", "Phone", "Office Location"]
    const rows = filteredUsers.map((user) => [
      user.first_name,
      user.last_name,
      user.department,
      user.designation,
      user.company_email,
      user.phone_number,
      user.office_location,
    ])
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell || ""}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `employee-data-${toLocalISODate()}.csv`
    a.click()
    toast.success("CSV exported successfully!")
  }

  const exportToJSON = () => {
    const json = JSON.stringify(filteredUsers, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `employee-data-${toLocalISODate()}.json`
    a.click()
    toast.success("JSON exported successfully!")
  }

  const exportToXLSX = async () => {
    try {
      const { utils, writeFile } = await import("@e965/xlsx")
      const worksheet = utils.json_to_sheet(
        filteredUsers.map((user) => ({
          "First Name": user.first_name,
          "Last Name": user.last_name,
          Department: user.department,
          Designation: user.designation,
          Email: user.company_email,
          Phone: user.phone_number,
          "Office Location": user.office_location,
        }))
      )
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, worksheet, "employee")
      writeFile(workbook, `employee-data-${toLocalISODate()}.xlsx`)
      toast.success("XLSX exported successfully!")
    } catch {
      toast.error("Failed to export XLSX")
    }
  }

  const exportToPDF = async () => {
    try {
      const { jsPDF } = await import("jspdf")
      const { autoTable } = await import("jspdf-autotable")
      const doc = new jsPDF()
      autoTable(doc, {
        head: [["First Name", "Last Name", "Department", "Role", "Email", "Phone"]],
        body: filteredUsers.map((user) => [
          user.first_name,
          user.last_name,
          user.department,
          user.designation,
          user.company_email,
          user.phone_number,
        ]),
      })
      doc.save(`employee-data-${toLocalISODate()}.pdf`)
      toast.success("PDF exported successfully!")
    } catch {
      toast.error("Failed to export PDF")
    }
  }

  const handleImportCSV = async () => {
    setIsImporting(true)
    toast.loading("Importing employee data...", { id: "import" })
    try {
      const response = await apiFetch("/api/admin/import-csv", { method: "POST" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Import failed")
      toast.success(
        `Import complete! Imported: ${data.imported}, Skipped: ${data.skipped}, Errors: ${data.errorCount}`,
        { id: "import" }
      )
      setTimeout(() => window.location.reload(), 2000)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed", { id: "import" })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Import / Export */}
      <Card>
        <CardHeader>
          <CardTitle>Import &amp; Export Data</CardTitle>
          <CardDescription>Import employees from CSV or download data in various formats</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setShowImportConfirm(true)}
              variant="default"
              size="sm"
              disabled={isImporting}
              className="bg-primary"
            >
              <Upload className="mr-2 h-4 w-4" />
              {isImporting ? "Importing..." : "Import CSV"}
            </Button>
            <Button onClick={exportToCSV} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button onClick={exportToJSON} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export JSON
            </Button>
            <Button onClick={exportToXLSX} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export XLSX
            </Button>
            <Button onClick={exportToPDF} variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
            <Link href="/admin/feedback">
              <Button variant="outline" size="sm">
                View Feedback
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters &amp; Search</CardTitle>
          <CardDescription>Filter users by department or search by name/email</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger id="department">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSelectedDepartment("All Departments")
                  setSearchTerm("")
                  setSortKey(null)
                  setSortDir("asc")
                }}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <AdminUserTable
        users={filteredUsers}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
        onViewDetails={(user) => {
          setDetailsUser(user)
          setDetailsOpen(true)
        }}
        onEditUser={(user) => {
          setSelectedUser(user)
          setShowModal(true)
        }}
      />

      {/* Details dialog */}
      <AdminUserDetailsDialog
        user={detailsUser}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        feedbackByUserId={feedbackByUserId}
      />

      {/* Edit Modal */}
      {showModal && selectedUser && (
        <AdminUserModal
          user={selectedUser}
          onClose={() => {
            setShowModal(false)
            setSelectedUser(null)
          }}
          onSave={() => {
            setShowModal(false)
            setSelectedUser(null)
            toast.success("User updated successfully!")
          }}
        />
      )}

      {/* Import CSV confirmation */}
      <AlertDialog open={showImportConfirm} onOpenChange={setShowImportConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Employee Data</AlertDialogTitle>
            <AlertDialogDescription>
              This will import employee data from CSV. Existing records may be updated. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowImportConfirm(false)
                handleImportCSV()
              }}
            >
              Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
