"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { DataTablePage, DataTable } from "@/components/ui/data-table"
import type { DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import type { PayrollBreakdown } from "@/lib/hr/payroll-utils"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ManageGrossSalaryDialog } from "@/components/hr/manage-gross-salary-dialog"
import { FileText, Plus, DollarSign, Calendar, ClipboardList, Calculator } from "lucide-react"
import { toast } from "sonner"
import { apiFetch } from "@/lib/api-client"

export interface PayrollPeriod {
  id: string
  name: string
  start_date: string
  end_date: string
  pay_date: string
  status: string
  total_amount: number
}

export interface DbPayrollEntry {
  id?: string
  user_id?: string
  payroll_period_id?: string
  basic_salary?: number
  gross_salary?: number
  total_deductions?: number
  net_salary: number
  tax_amount: number
  bonus?: number
  lunch_deduction?: number
  loan_repayment?: number
  lateness_surcharge?: number
  absent_surcharge?: number
  status?: string | null
  breakdown?: PayrollBreakdown | null
  user?: {
    id?: string
    full_name?: string | null
    employee_number?: string | null
    department?: string | null
  } | null
  payroll_periods?: {
    id?: string
    name?: string | null
    pay_date?: string | null
    start_date?: string | null
    status?: string | null
  } | null
}

export interface PayrollPeriodsPageProps {
  initialData?: {
    periods: PayrollPeriod[]
    entries: DbPayrollEntry[]
    isAdmin: boolean
  }
}

const TABS: DataTableTab[] = [
  { key: "register", label: "Payroll Register", icon: ClipboardList },
  { key: "periods", label: "Periods", icon: Calendar },
]

export function PayrollPeriodsPage({ initialData }: PayrollPeriodsPageProps) {
  const router = useRouter()
  const [periods, setPeriods] = useState<PayrollPeriod[]>(initialData?.periods || [])
  const [openPeriod, setOpenPeriod] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("register")

  const [periodForm, setPeriodForm] = useState({
    name: "",
    start_date: "",
    end_date: "",
    pay_date: "",
  })

  if (!initialData) {
    return <div className="text-muted-foreground p-8 text-center">Access Denied</div>
  }

  const totalPayslips = initialData.entries.length
  const totalAmount = initialData.entries.reduce((sum, e) => sum + Number(e.net_salary), 0)
  const totalTax = initialData.entries.reduce((sum, e) => sum + Number(e.tax_amount), 0)

  const columns = [
    {
      key: "name",
      label: "Period",
      accessor: (row: PayrollPeriod) => row.name,
      sortable: true,
      render: (row: PayrollPeriod) => <span className="text-foreground font-semibold">{row.name}</span>,
    },
    {
      key: "range",
      label: "Date Range",
      render: (row: PayrollPeriod) => (
        <span className="text-muted-foreground text-xs">
          {row.start_date} → {row.end_date}
        </span>
      ),
    },
    {
      key: "pay_date",
      label: "Pay Date",
      render: (row: PayrollPeriod) => <span className="text-xs">{row.pay_date}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row: PayrollPeriod) =>
        row.status === "completed" ? (
          <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">Locked / Paid</Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/30 text-amber-500">
            Draft
          </Badge>
        ),
    },
    {
      key: "actions",
      label: "Worksheet",
      render: (row: PayrollPeriod) => (
        <Button asChild size="sm" variant={row.status === "completed" ? "outline" : "default"}>
          <Link href={`/admin/payroll/${row.id}`}>
            {row.status === "completed" ? "View Published Payslips" : "Open Worksheet"}
          </Link>
        </Button>
      ),
    },
  ]

  const registerColumns = [
    {
      key: "employee",
      label: "Employee",
      accessor: (row: DbPayrollEntry) => row.user?.full_name || "Unknown",
      sortable: true,
      render: (row: DbPayrollEntry) => (
        <div>
          <p className="text-foreground font-medium">{row.user?.full_name || "Unknown"}</p>
          <p className="text-muted-foreground font-mono text-xs">{row.user?.employee_number || "N/A"}</p>
        </div>
      ),
    },
    {
      key: "department",
      label: "Department",
      accessor: (row: DbPayrollEntry) => row.user?.department || "General",
      sortable: true,
      render: (row: DbPayrollEntry) => (
        <span className="text-muted-foreground text-xs">{row.user?.department || "General"}</span>
      ),
    },
    {
      key: "period",
      label: "Period",
      accessor: (row: DbPayrollEntry) => row.payroll_periods?.name || "N/A",
      sortable: true,
      render: (row: DbPayrollEntry) => (
        <div>
          <p className="text-foreground font-medium">{row.payroll_periods?.name || "N/A"}</p>
          <p className="text-muted-foreground text-[11px]">Pay Date: {row.payroll_periods?.pay_date || "N/A"}</p>
        </div>
      ),
    },
    {
      key: "basic_salary",
      label: "Base Salary",
      render: (row: DbPayrollEntry) => (
        <span className="font-mono text-xs font-medium">
          ₦
          {Number(row.basic_salary || row.breakdown?.monthlyBase || 0).toLocaleString("en-US", {
            minimumFractionDigits: 2,
          })}
        </span>
      ),
    },
    {
      key: "gross_salary",
      label: "Gross Pay",
      render: (row: DbPayrollEntry) => (
        <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
          ₦
          {Number(row.gross_salary || row.breakdown?.monthlyGross || 0).toLocaleString("en-US", {
            minimumFractionDigits: 2,
          })}
        </span>
      ),
    },
    {
      key: "tax_amount",
      label: "PAYE Tax",
      render: (row: DbPayrollEntry) => (
        <span className="font-mono text-xs text-amber-600 dark:text-amber-400">
          ₦{Number(row.tax_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "total_deductions",
      label: "Deductions",
      render: (row: DbPayrollEntry) => (
        <span className="font-mono text-xs text-red-600 dark:text-red-400">
          ₦{Number(row.total_deductions || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "net_salary",
      label: "Net Take-Home",
      render: (row: DbPayrollEntry) => (
        <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
          ₦{Number(row.net_salary || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "status",
      label: "Run Status",
      render: (row: DbPayrollEntry) => (
        <Badge
          variant={row.payroll_periods?.status === "completed" ? "default" : "outline"}
          className={
            row.payroll_periods?.status === "completed"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-amber-500/30 text-amber-600"
          }
        >
          {row.payroll_periods?.status === "completed" ? "Published" : "Draft Run"}
        </Badge>
      ),
    },
  ]

  const registerFilters: DataTableFilter<DbPayrollEntry>[] = [
    {
      key: "department",
      label: "Department",
      placeholder: "Filter by department",
      mode: "custom",
      options: [...new Set(initialData.entries.map((e) => e.user?.department).filter(Boolean) as string[])]
        .sort()
        .map((d) => ({ value: d, label: d })),
      filterFn: (row, selected) => selected.includes(row.user?.department || ""),
    },
    {
      key: "period_status",
      label: "Status",
      placeholder: "Filter by status",
      mode: "custom",
      options: [
        { value: "completed", label: "Paid / Locked" },
        { value: "draft", label: "Draft" },
      ],
      filterFn: (row, selected) => selected.includes(row.payroll_periods?.status || "draft"),
    },
  ]

  async function handleCreatePeriod(e: React.FormEvent) {
    e.preventDefault()
    if (!periodForm.name || !periodForm.start_date || !periodForm.end_date || !periodForm.pay_date) {
      toast.error("Please fill in all fields")
      return
    }

    setLoading(true)
    try {
      const res = await apiFetch("/api/admin/payroll/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(periodForm),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to create payroll period")

      toast.success("Payroll period created successfully!")
      setPeriods([payload.data, ...periods])
      setOpenPeriod(false)
      setPeriodForm({ name: "", start_date: "", end_date: "", pay_date: "" })
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setLoading(false)
    }
  }

  const stats = (
    <div className="grid grid-cols-1 gap-2 sm:gap-3 lg:grid-cols-3">
      <StatCard
        title="Total Payslips Issued"
        value={totalPayslips}
        icon={FileText}
        iconBgColor="bg-emerald-500/10"
        iconColor="text-emerald-500"
      />
      <StatCard
        title="Total Payroll Disbursed"
        value={`₦${totalAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
        icon={DollarSign}
        iconBgColor="bg-blue-500/10"
        iconColor="text-blue-500"
      />
      <StatCard
        title="Total PAYE Tax Collected"
        value={`₦${totalTax.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
        icon={FileText}
        iconBgColor="bg-amber-500/10"
        iconColor="text-amber-500"
      />
    </div>
  )

  const actions = initialData.isAdmin ? (
    <div className="flex flex-wrap items-center gap-2">
      <ManageGrossSalaryDialog />
      <Button asChild variant="outline" size="sm">
        <Link href="/admin/payroll/calculator">
          <Calculator className="mr-1.5 h-4 w-4" /> Payroll Calculator
        </Link>
      </Button>
      <Dialog open={openPeriod} onOpenChange={setOpenPeriod}>
        <DialogTrigger asChild>
          <Button size="sm">
            <Plus className="mr-1.5 h-4 w-4" /> Create Period
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={handleCreatePeriod}>
            <DialogHeader>
              <DialogTitle>Create Payroll Period</DialogTitle>
              <DialogDescription>Set up a monthly cycle dates configuration.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Period Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. June 2026"
                  value={periodForm.name}
                  onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={periodForm.start_date}
                    onChange={(e) => setPeriodForm({ ...periodForm, start_date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end_date">End Date</Label>
                  <Input
                    id="end_date"
                    type="date"
                    value={periodForm.end_date}
                    onChange={(e) => setPeriodForm({ ...periodForm, end_date: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay_date">Target Pay Date</Label>
                <Input
                  id="pay_date"
                  type="date"
                  value={periodForm.pay_date}
                  onChange={(e) => setPeriodForm({ ...periodForm, pay_date: e.target.value })}
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpenPeriod(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  ) : null

  return (
    <DataTablePage
      title="Payroll Management"
      description="Create monthly payroll periods, then open a period's worksheet to run the bulk calculation and publish payslips."
      icon={FileText}
      backLink={{ href: "/admin/hr", label: "Back to HR Dashboard" }}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      stats={stats}
      actions={actions}
    >
      {activeTab === "periods" ? (
        <DataTable
          data={periods}
          columns={columns}
          getRowId={(row) => row.id}
          searchPlaceholder="Search by period name..."
          searchFn={(row, q) => row.name.toLowerCase().includes(q.toLowerCase())}
          filters={[]}
          isLoading={false}
        />
      ) : (
        <DataTable<DbPayrollEntry>
          data={initialData.entries}
          columns={registerColumns}
          getRowId={(row) => row.id || `${row.payroll_period_id}-${row.user_id}`}
          pagination={{ pageSize: 50 }}
          searchPlaceholder="Search by employee, staff number, or period..."
          searchFn={(row, q) =>
            `${row.user?.full_name || ""} ${row.user?.employee_number || ""} ${row.payroll_periods?.name || ""}`
              .toLowerCase()
              .includes(q)
          }
          filters={registerFilters}
          isLoading={false}
          emptyIcon={FileText}
          emptyTitle="No payslips yet"
          emptyDescription="Payslips appear here once a payroll period has been saved or locked from its worksheet."
        />
      )}
    </DataTablePage>
  )
}
