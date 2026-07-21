"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { DataTablePage, DataTable } from "@/components/ui/data-table"
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
import { FileText, Plus, DollarSign, Calendar, ClipboardList } from "lucide-react"
import { toast } from "sonner"

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
  net_salary: number
  tax_amount: number
}

export interface PayrollPeriodsPageProps {
  initialData?: {
    periods: PayrollPeriod[]
    entries: DbPayrollEntry[]
    isAdmin: boolean
  }
}

export function PayrollPeriodsPage({ initialData }: PayrollPeriodsPageProps) {
  const router = useRouter()
  const [periods, setPeriods] = useState<PayrollPeriod[]>(initialData?.periods || [])
  const [openPeriod, setOpenPeriod] = useState(false)
  const [loading, setLoading] = useState(false)

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
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-600">
            Draft
          </Badge>
        ),
    },
    {
      key: "total_amount",
      label: "Total Disbursed",
      render: (row: PayrollPeriod) => (
        <span className="font-medium">
          ₦{Number(row.total_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row: PayrollPeriod) => (
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/hr/payroll/${row.id}`}>
            <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Open Worksheet
          </Link>
        </Button>
      ),
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
      const res = await fetch("/api/admin/hr/payroll/periods", {
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
              <Label htmlFor="pay_date">Disbursement / Pay Date</Label>
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
  ) : null

  return (
    <DataTablePage
      title="Payroll Management"
      description="Create monthly payroll periods, then open a period's worksheet to run the bulk calculation and publish payslips."
      icon={FileText}
      backLink={{ href: "/admin/hr", label: "Back to HR Dashboard" }}
      stats={stats}
      actions={actions}
    >
      <DataTable
        data={periods}
        columns={columns}
        getRowId={(row) => row.id}
        searchPlaceholder="Search by period name..."
        searchFn={(row, q) => row.name.toLowerCase().includes(q.toLowerCase())}
        filters={[]}
        isLoading={false}
      />
    </DataTablePage>
  )
}
