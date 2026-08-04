"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { format, parseISO, isValid, differenceInDays, isBefore, startOfDay } from "date-fns"
import { CreditCard, Download, Eye, FileText, Plus, Receipt, Upload } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"
import { ExportOptionsDialog } from "@/components/admin/export-options-dialog"
import { CreatePaymentDialog } from "./create-payment-dialog"
import { ExportColumnsDialog } from "./export-columns-dialog"
import { PaymentStatsCards } from "./payment-stats-cards"
import { ReceiptSelectionDialog } from "./receipt-selection-dialog"
import { usePaymentExport } from "./use-payment-export"
import type { CreatePaymentFormData } from "./create-payment-dialog"
import { logger } from "@/lib/logger"
import { QUERY_KEYS } from "@/lib/query-keys"
import { apiFetch } from "@/lib/api-client"

const log = logger("payments-table")

interface Payment {
  id: string
  department_id: string
  title: string
  amount: number
  currency: string
  status: "due" | "paid" | "overdue" | "cancelled"
  payment_type: "one-time" | "recurring"
  recurrence_period?: "monthly" | "quarterly" | "yearly"
  next_payment_due?: string
  payment_date?: string
  category: string
  description?: string
  issuer_name?: string
  issuer_phone_number?: string
  issuer_address?: string
  payment_reference?: string
  amount_paid?: number
  created_at: string
  department?: {
    name: string
  }
  documents?: {
    id: string
    document_type: string
    file_path: string
    file_name?: string
    applicable_date?: string
    created_at?: string
  }[]
}

interface Department {
  id: string
  name: string
}

interface PaymentsTableData {
  payments: Payment[]
  departments: Department[]
}

interface ProcessedPayment extends Payment {
  amountDue: number
  departmentName: string
  issuerDisplay: string
  dateLabel: string
  dateSortValue: number
  paymentTypeLabel: string
  hasReceipt: boolean
}

type PaymentTableDocument = NonNullable<Payment["documents"]>[number]

const EMPTY_PAYMENTS: Payment[] = []
const EMPTY_DEPARTMENTS: Department[] = []

async function fetchPaymentsTableData(): Promise<PaymentsTableData> {
  const [paymentsRes, deptRes] = await Promise.all([apiFetch("/api/payments"), apiFetch("/api/departments")])

  if (!paymentsRes.ok) {
    const data = await paymentsRes.json().catch(() => ({}))
    throw new Error(data?.error ?? "Failed to fetch payments")
  }

  const paymentsJson = await paymentsRes.json()
  const departments: Department[] = deptRes.ok ? ((await deptRes.json()).data ?? []) : []

  return {
    payments: paymentsJson.data ?? [],
    departments,
  }
}

interface PaymentsTableProps {
  initialPayments?: Payment[]
  initialDepartments?: Department[]
  initialError?: string | null
  currentUser: {
    id: string
    department_id: string | null
    isAdmin: boolean
  }
  basePath?: string
}

export function PaymentsTable({
  initialPayments = [],
  initialDepartments = [],
  initialError = null,
  currentUser,
  basePath = currentUser.isAdmin ? "/admin/finance/payments" : "/payments",
}: PaymentsTableProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [selectedPaymentForReceipt, setSelectedPaymentForReceipt] = useState<ProcessedPayment | null>(null)
  const [receiptUploadDialogOpen, setReceiptUploadDialogOpen] = useState(false)
  const [selectedPaymentForReceiptUpload, setSelectedPaymentForReceiptUpload] = useState<ProcessedPayment | null>(null)
  const [receiptUploadFile, setReceiptUploadFile] = useState<File | null>(null)
  const [receiptUploading, setReceiptUploading] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportOptionsOpen, setExportOptionsOpen] = useState(false)
  const [exportTypeOptionsOpen, setExportTypeOptionsOpen] = useState(false)
  const [exportType, setExportType] = useState<"excel" | "pdf" | null>(null)
  const [exportPaymentType, setExportPaymentType] = useState<"all" | "recurring" | "one-time">("all")
  const [processedTableRows, setProcessedTableRows] = useState<ProcessedPayment[] | null>(null)
  const [processedTableRowsSignature, setProcessedTableRowsSignature] = useState("")
  const [selectedColumns, setSelectedColumns] = useState<Record<string, boolean>>({
    "#": true,
    Title: true,
    Issuer: true,
    Department: true,
    Amount: true,
    "Amount Due": true,
    Currency: true,
    Type: true,
    Status: true,
    "First Payment Date": true,
    "Number of Payments": true,
    "Next Due Date": true,
    Recurrence: false,
    Reference: true,
  })
  const [formData, setFormData] = useState<CreatePaymentFormData>({
    department_id: currentUser.department_id || "",
    payment_type: "",
    title: "",
    description: "",
    amount: "",
    currency: "NGN",
    recurrence_period: "monthly",
    next_payment_due: "",
    payment_date: "",
    issuer_name: "",
    issuer_phone_number: "",
    issuer_address: "",
    payment_reference: "",
    notes: "",
  })

  const {
    data: tableData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEYS.paymentsTable(),
    queryFn: fetchPaymentsTableData,
    initialData:
      initialPayments.length > 0 || initialDepartments.length > 0
        ? { payments: initialPayments, departments: initialDepartments }
        : undefined,
  })

  useEffect(() => {
    if (initialError) {
      toast.error(initialError)
    }
  }, [initialError])

  const payments = tableData?.payments ?? EMPTY_PAYMENTS
  const departments = tableData?.departments ?? EMPTY_DEPARTMENTS

  const getRealStatus = (payment: Payment): Payment["status"] => {
    if (payment.payment_type === "one-time") return "paid"
    if (payment.status === "paid" || payment.status === "cancelled") return payment.status

    const dateStr = payment.payment_type === "recurring" ? payment.next_payment_due : payment.payment_date
    if (!dateStr) return "due"

    const date = parseISO(dateStr)
    if (!isValid(date)) return "due"

    const today = startOfDay(new Date())
    const daysDiff = differenceInDays(date, today)

    if (isBefore(date, today)) return "overdue"
    if (daysDiff <= 7) return "due"
    return "paid"
  }

  const getAmountDue = (payment: Payment, status: Payment["status"]) => {
    if (status === "paid" || status === "cancelled") return 0
    if (status === "due") return payment.amount

    if (payment.payment_type === "recurring" && payment.next_payment_due && payment.recurrence_period) {
      const dueDate = parseISO(payment.next_payment_due)
      if (!isValid(dueDate)) return payment.amount

      const today = startOfDay(new Date())
      const daysPastDue = Math.abs(differenceInDays(today, dueDate))

      let periodsOverdue = 1
      if (payment.recurrence_period === "monthly") periodsOverdue = Math.floor(daysPastDue / 30) + 1
      if (payment.recurrence_period === "quarterly") periodsOverdue = Math.floor(daysPastDue / 90) + 1
      if (payment.recurrence_period === "yearly") periodsOverdue = Math.floor(daysPastDue / 365) + 1

      return payment.amount * periodsOverdue
    }

    return payment.amount
  }

  const formatCurrency = (amount: number, currency: string) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(amount)

  const getStatusColor = (status: string) => {
    if (status === "paid") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    if (status === "due") return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    if (status === "overdue") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    if (status === "cancelled") return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
    return ""
  }

  const processedPayments = useMemo<ProcessedPayment[]>(() => {
    return payments.map((payment) => {
      const status = getRealStatus(payment)
      const dateStr = payment.payment_type === "recurring" ? payment.next_payment_due : payment.payment_date
      const parsedDate = dateStr ? parseISO(dateStr) : null

      return {
        ...payment,
        status,
        amountDue: getAmountDue(payment, status),
        departmentName: payment.department?.name || "Unknown",
        issuerDisplay: payment.issuer_name || "N/A",
        dateLabel: parsedDate && isValid(parsedDate) ? format(parsedDate, "MMM d, yyyy") : "N/A",
        dateSortValue: parsedDate && isValid(parsedDate) ? parsedDate.getTime() : 0,
        paymentTypeLabel: payment.payment_type === "recurring" ? "Recurring" : "One-time",
        hasReceipt: payment.documents?.some((doc) => doc.document_type === "receipt") ?? false,
      }
    })
  }, [payments])

  const stats = useMemo(
    () => ({
      totalDue: processedPayments
        .filter((payment) => {
          if (payment.status === "overdue") return true
          if (payment.status !== "due") return false
          const dateStr = payment.payment_type === "recurring" ? payment.next_payment_due : payment.payment_date
          if (!dateStr) return true
          return differenceInDays(parseISO(dateStr), new Date()) <= 7
        })
        .reduce((sum, payment) => sum + payment.amount, 0),
      totalPaid: processedPayments.reduce((sum, payment) => sum + (payment.amount_paid || 0), 0),
      countCompleted: processedPayments.filter((payment) => payment.status === "paid" || (payment.amount_paid || 0) > 0)
        .length,
      countOverdue: processedPayments.filter((payment) => payment.status === "overdue").length,
      countDue: processedPayments.filter((payment) => payment.status === "due").length,
    }),
    [processedPayments]
  )

  const departmentOptions = useMemo(
    () =>
      (currentUser.isAdmin
        ? departments
        : departments.filter((department) => department.id === currentUser.department_id)
      ).map((department) => ({
        value: department.id,
        label: department.name,
      })),
    [currentUser.department_id, currentUser.isAdmin, departments]
  )

  const monthOptions = useMemo(
    () =>
      Array.from(
        new Set(
          processedPayments
            .map((payment) => {
              const dateStr = payment.payment_type === "recurring" ? payment.next_payment_due : payment.payment_date
              if (!dateStr) return null
              const parsedDate = parseISO(dateStr)
              if (!isValid(parsedDate)) return null
              return format(parsedDate, "yyyy-MM")
            })
            .filter((value): value is string => Boolean(value))
        )
      )
        .sort((a, b) => b.localeCompare(a))
        .map((value) => {
          const parsedDate = parseISO(`${value}-01`)
          return {
            value,
            label: isValid(parsedDate) ? format(parsedDate, "MMMM yyyy") : value,
          }
        }),
    [processedPayments]
  )

  const filters = useMemo<DataTableFilter<ProcessedPayment>[]>(() => {
    const filterList: DataTableFilter<ProcessedPayment>[] = []

    if (currentUser.isAdmin) {
      filterList.push({
        key: "department_id",
        label: "Department",
        placeholder: "All Departments",
        options: departmentOptions,
      })
    }

    filterList.push(
      {
        key: "payment_type",
        label: "Type",
        placeholder: "All Types",
        options: [
          { value: "one-time", label: "One-time" },
          { value: "recurring", label: "Recurring" },
        ],
      },
      {
        key: "status",
        label: "Status",
        placeholder: "All Status",
        options: [
          { value: "paid", label: "Paid" },
          { value: "due", label: "Due" },
          { value: "overdue", label: "Overdue" },
          { value: "cancelled", label: "Cancelled" },
        ],
      },
      {
        key: "paymentMonth",
        label: "Month",
        placeholder: "All Months",
        options: monthOptions,
        mode: "custom",
        filterFn: (row, selected) => {
          const dateStr = row.payment_type === "recurring" ? row.next_payment_due : row.payment_date
          if (!dateStr) return false
          const parsedDate = parseISO(dateStr)
          if (!isValid(parsedDate)) return false
          return selected.includes(format(parsedDate, "yyyy-MM"))
        },
      }
    )

    return filterList
  }, [currentUser.isAdmin, departmentOptions, monthOptions])

  const columns: DataTableColumn<ProcessedPayment>[] = [
    {
      key: "payment_type",
      label: "Type",
      sortable: true,
      accessor: (row) => row.payment_type,
      render: (row) => (
        <Badge
          variant="outline"
          className={
            row.payment_type === "recurring"
              ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
              : "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400"
          }
        >
          {row.paymentTypeLabel}
        </Badge>
      ),
    },
    {
      key: "title",
      label: "Title",
      sortable: true,
      accessor: (row) => row.title,
      resizable: true,
      initialWidth: 240,
      render: (row) => <span className="font-medium">{row.title}</span>,
    },
    {
      key: "department_id",
      label: "Department",
      sortable: true,
      accessor: (row) => row.department_id,
      render: (row) => row.departmentName,
      hideOnMobile: true,
    },
    {
      key: "amount",
      label: "Amount",
      sortable: true,
      align: "right",
      accessor: (row) => row.amount,
      render: (row) => formatCurrency(row.amount, row.currency),
    },
    {
      key: "amountDue",
      label: "Amount Due",
      sortable: true,
      align: "right",
      accessor: (row) => row.amountDue,
      render: (row) => (
        <span
          className={
            row.status === "overdue"
              ? "font-semibold text-red-600"
              : row.status === "due"
                ? "font-semibold text-yellow-600"
                : "text-muted-foreground"
          }
        >
          {formatCurrency(row.amountDue, row.currency)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      accessor: (row) => row.status,
      render: (row) => (
        <Badge className={getStatusColor(row.status)} variant="outline">
          {row.status}
        </Badge>
      ),
    },
    {
      key: "dateSortValue",
      label: "Date / Next Due",
      sortable: true,
      hideOnMobile: true,
      accessor: (row) => row.dateSortValue,
      render: (row) => row.dateLabel,
    },
    {
      key: "quick_actions",
      label: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={(event) => {
              event.stopPropagation()
              router.push(`${basePath}/${row.id}`, { scroll: false })
            }}
            title="View"
            aria-label="View payment"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {row.documents?.some((doc) => doc.document_type === "invoice") ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={(event) => {
                event.stopPropagation()
                void handlePrintDocument(row, "invoice")
              }}
              title="Download invoice"
              aria-label="Download invoice"
            >
              <FileText className="h-4 w-4" />
            </Button>
          ) : null}
          {row.documents?.some((doc) => doc.document_type === "receipt") ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={(event) => {
                event.stopPropagation()
                void handlePrintDocument(row, "receipt")
              }}
              title="Download receipt"
              aria-label="Download receipt"
            >
              <Receipt className="h-4 w-4" />
            </Button>
          ) : null}
          {row.payment_type === "one-time" && !row.hasReceipt ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={(event) => {
                event.stopPropagation()
                handleOpenReceiptUpload(row)
              }}
              title="Upload missing receipt"
              aria-label="Upload missing receipt"
            >
              <Upload className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  const handleSubmit = async (submittedFormData: CreatePaymentFormData) => {
    setSubmitting(true)

    try {
      if (submittedFormData.payment_type === "one-time" && !receiptFile) {
        toast.error("One-time payments require a receipt to be uploaded")
        setSubmitting(false)
        return
      }

      const response = await apiFetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...submittedFormData,
          category: submittedFormData.payment_type,
          amount: parseFloat(submittedFormData.amount),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        toast.error(data.error || "Failed to create payment")
        return
      }

      const data = await response.json()
      const paymentId = data.data.id

      if (submittedFormData.payment_type === "one-time" && receiptFile) {
        const uploadFormData = new FormData()
        uploadFormData.append("file", receiptFile)
        uploadFormData.append("payment_id", paymentId)
        uploadFormData.append("document_type", "receipt")
        uploadFormData.append("applicable_date", submittedFormData.payment_date)

        const uploadResponse = await apiFetch(`/api/payments/${paymentId}/documents`, {
          method: "POST",
          body: uploadFormData,
        })

        if (!uploadResponse.ok) {
          toast.warning("Payment created, but receipt upload failed. You can upload it later.")
        }
      }

      toast.success("Payment created successfully")
      setIsModalOpen(false)
      setReceiptFile(null)
      setFormData({
        department_id: currentUser.department_id || "",
        payment_type: "",
        title: "",
        description: "",
        amount: "",
        currency: "NGN",
        recurrence_period: "monthly",
        next_payment_due: "",
        payment_date: "",
        issuer_name: "",
        issuer_phone_number: "",
        issuer_address: "",
        payment_reference: "",
        notes: "",
      })
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.paymentsTable() })
    } catch {
      toast.error("Error creating payment")
    } finally {
      setSubmitting(false)
    }
  }

  const exportBaseRows = processedTableRows ?? processedPayments

  const handleProcessedDataChange = useCallback((rows: ProcessedPayment[]) => {
    const nextSignature = rows.map((row) => row.id).join("|")
    setProcessedTableRowsSignature((prevSignature) => {
      if (prevSignature === nextSignature) return prevSignature
      setProcessedTableRows(rows)
      return nextSignature
    })
  }, [])

  const exportPayments = useMemo(
    () =>
      exportPaymentType === "all"
        ? exportBaseRows
        : exportBaseRows.filter((payment) => payment.payment_type === exportPaymentType),
    [exportBaseRows, exportPaymentType]
  )

  const { handleExportConfirm } = usePaymentExport(exportPayments, selectedColumns, () => setExportDialogOpen(false))

  const downloadFile = async (url: string, filename: string) => {
    try {
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      link.style.display = "none"
      link.rel = "noopener noreferrer"
      document.body.appendChild(link)
      link.click()

      setTimeout(() => {
        document.body.removeChild(link)
      }, 100)
    } catch (downloadError: unknown) {
      log.error("Error downloading file:", downloadError)
      throw downloadError
    }
  }

  const downloadPaymentDocument = useCallback(async (paymentId: string, doc: PaymentTableDocument) => {
    const filename = doc.file_name || `${doc.document_type}_${paymentId.substring(0, 8)}`
    const toastId = toast.loading("Preparing download...")

    try {
      await downloadFile(`/api/payments/${paymentId}/documents/${doc.id}/download`, filename)
      window.setTimeout(() => {
        toast.dismiss(toastId)
      }, 6000)
    } catch (downloadError) {
      toast.dismiss(toastId)
      throw downloadError
    }
  }, [])

  const handlePrintDocument = useCallback(
    async (payment: ProcessedPayment, type: "invoice" | "receipt") => {
      if (type === "receipt") {
        const receipts = payment.documents?.filter((doc) => doc.document_type === "receipt") || []

        if (receipts.length > 1) {
          setSelectedPaymentForReceipt(payment)
          setReceiptDialogOpen(true)
          return
        }

        if (receipts.length === 1) {
          try {
            await downloadPaymentDocument(payment.id, receipts[0])
          } catch {
            toast.error("Error downloading document")
          }
        }

        return
      }

      const doc = payment.documents?.find((item) => item.document_type === type)
      if (!doc) return

      try {
        await downloadPaymentDocument(payment.id, doc)
      } catch {
        toast.error("Error downloading document")
      }
    },
    [downloadPaymentDocument]
  )

  const handleViewReceipt = async (receipt: PaymentTableDocument) => {
    if (!selectedPaymentForReceipt) return

    try {
      setReceiptDialogOpen(false)
      await new Promise((resolve) => setTimeout(resolve, 100))
      await downloadPaymentDocument(selectedPaymentForReceipt.id, receipt)
    } catch {
      toast.error("Error downloading document")
    }
  }

  const handleOpenReceiptUpload = useCallback((payment: ProcessedPayment) => {
    setSelectedPaymentForReceiptUpload(payment)
    setReceiptUploadFile(null)
    setReceiptUploadDialogOpen(true)
  }, [])

  const handleUploadMissingReceipt = async () => {
    if (!selectedPaymentForReceiptUpload || !receiptUploadFile) {
      toast.error("Choose a receipt file to continue")
      return
    }

    setReceiptUploading(true)
    try {
      const uploadData = new FormData()
      uploadData.append("file", receiptUploadFile)
      uploadData.append("payment_id", selectedPaymentForReceiptUpload.id)
      uploadData.append("document_type", "receipt")

      if (selectedPaymentForReceiptUpload.payment_date) {
        uploadData.append("applicable_date", selectedPaymentForReceiptUpload.payment_date)
      }

      const response = await apiFetch(`/api/payments/${selectedPaymentForReceiptUpload.id}/documents`, {
        method: "POST",
        body: uploadData,
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || "Failed to upload receipt")
      }

      toast.success("Receipt uploaded successfully")
      setReceiptUploadDialogOpen(false)
      setSelectedPaymentForReceiptUpload(null)
      setReceiptUploadFile(null)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.paymentsTable() })
    } catch (uploadError: unknown) {
      const message = uploadError instanceof Error ? uploadError.message : "Failed to upload receipt"
      toast.error(message)
    } finally {
      setReceiptUploading(false)
    }
  }

  const isAdminPath = basePath.startsWith("/admin")
  const filterableDepartments = currentUser.isAdmin
    ? departments
    : departments.filter((department) => department.id === currentUser.department_id)
  const backLink = isAdminPath
    ? { href: "/admin", label: "Back to Admin" }
    : { href: "/profile", label: "Back to Dashboard" }

  return (
    <DataTablePage
      title="Payments"
      description="Manage and track department payments and recurring subscriptions."
      icon={CreditCard}
      backLink={backLink}
      stats={<PaymentStatsCards stats={stats} formatCurrency={formatCurrency} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="h-8 gap-2" size="sm" onClick={() => setExportOptionsOpen(true)}>
            <Download className="h-4 w-4" />
            Export
          </Button>
          {currentUser.isAdmin ? (
            <Button onClick={() => setIsModalOpen(true)} className="h-8 gap-2" size="sm">
              <Plus className="h-4 w-4" />
              Add Payment
            </Button>
          ) : null}
        </div>
      }
    >
      <DataTable<ProcessedPayment>
        data={processedPayments}
        columns={columns}
        filters={filters}
        onProcessedDataChange={handleProcessedDataChange}
        getRowId={(row) => row.id}
        searchPlaceholder="Search title, issuer, department, or reference..."
        searchFn={(row, query) =>
          [row.title, row.issuerDisplay, row.departmentName, row.payment_reference || "", row.description || ""]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }
        isLoading={isLoading}
        error={initialError || (error instanceof Error ? error.message : null)}
        onRetry={() => {
          void refetch()
        }}
        pagination={{ pageSize: 12 }}
        viewToggle
        urlSync
        skeletonRows={6}
        emptyIcon={CreditCard}
        emptyTitle="No payments found"
        emptyDescription="No payments match the current search and filters."
        cardRenderer={(row) => (
          <div
            className="bg-card rounded-lg border p-5 shadow-sm transition-shadow hover:shadow-md"
            onClick={() => router.push(`${basePath}/${row.id}`, { scroll: false })}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{row.title}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{row.departmentName}</p>
              </div>
              <Badge className={getStatusColor(row.status)} variant="outline">
                {row.status}
              </Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs font-semibold uppercase">Type</p>
                <p className="font-medium">{row.paymentTypeLabel}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-semibold uppercase">Amount</p>
                <p className="font-medium">{formatCurrency(row.amount, row.currency)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-semibold uppercase">Amount Due</p>
                <p className="font-medium">{formatCurrency(row.amountDue, row.currency)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-semibold uppercase">Date / Next Due</p>
                <p className="font-medium">{row.dateLabel}</p>
              </div>
            </div>
          </div>
        )}
        expandable={{
          render: (row) => (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Issuer</p>
                  <p className="font-medium">{row.issuerDisplay}</p>
                  <p className="text-muted-foreground text-sm">{row.issuer_phone_number || "-"}</p>
                  <p className="text-muted-foreground text-sm">{row.issuer_address || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Receipt Status</p>
                  {row.payment_type === "one-time" ? (
                    row.hasReceipt ? (
                      <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                        Receipt Available
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-300 text-amber-700">
                        Missing Receipt
                      </Badge>
                    )
                  ) : (
                    <span className="text-sm">Not required</span>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Reference</p>
                  <p className="font-medium">{row.payment_reference || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Description</p>
                  <p className="text-sm">{row.description || "No description provided."}</p>
                </div>
              </div>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase">Payment Date</p>
                    <p className="font-medium">
                      {row.payment_date ? format(parseISO(row.payment_date), "MMM d, yyyy") : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase">Next Due</p>
                    <p className="font-medium">
                      {row.next_payment_due ? format(parseISO(row.next_payment_due), "MMM d, yyyy") : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase">Recurrence</p>
                    <p className="font-medium">{row.recurrence_period || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase">Documents</p>
                    <p className="font-medium">{row.documents?.length || 0}</p>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Documents</p>
                  {row.documents && row.documents.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.documents.map((document) => (
                        <Badge key={document.id} variant="outline">
                          {document.document_type}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm">No documents attached.</p>
                  )}
                </div>
              </div>
            </div>
          ),
        }}
      />

      <CreatePaymentDialog
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleSubmit}
        submitting={submitting}
        receiptFile={receiptFile}
        onReceiptFileChange={setReceiptFile}
        departments={departments}
        filterableDepartments={filterableDepartments}
        isAdmin={currentUser.isAdmin}
      />

      <ReceiptSelectionDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        payment={selectedPaymentForReceipt}
        onSelectReceipt={handleViewReceipt}
      />

      <Dialog open={receiptUploadDialogOpen} onOpenChange={setReceiptUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Missing Receipt</DialogTitle>
            <DialogDescription>
              Add the missing receipt for {selectedPaymentForReceiptUpload?.title || "this payment"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="missing-receipt-file">Receipt file</Label>
              <Input
                id="missing-receipt-file"
                type="file"
                accept="image/*,.pdf"
                onChange={(event) => setReceiptUploadFile(event.target.files?.[0] || null)}
                className="cursor-pointer"
              />
            </div>
            {receiptUploadFile ? (
              <p className="text-muted-foreground text-sm">Selected: {receiptUploadFile.name}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setReceiptUploadDialogOpen(false)
                setSelectedPaymentForReceiptUpload(null)
                setReceiptUploadFile(null)
              }}
              disabled={receiptUploading}
            >
              Cancel
            </Button>
            <Button onClick={handleUploadMissingReceipt} disabled={!receiptUploadFile || receiptUploading}>
              <Upload className="mr-2 h-4 w-4" />
              {receiptUploading ? "Uploading..." : "Upload Receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExportColumnsDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        exportType={exportType}
        selectedColumns={selectedColumns}
        onColumnChange={setSelectedColumns}
        onConfirm={() => {
          if (exportType) {
            handleExportConfirm(exportType)
          }
        }}
      />

      <ExportOptionsDialog
        open={exportOptionsOpen}
        onOpenChange={setExportOptionsOpen}
        title="Export Payments"
        options={[
          { id: "excel", label: "Excel (.xlsx)", icon: "excel" },
          { id: "pdf", label: "PDF", icon: "pdf" },
        ]}
        onSelect={(id) => {
          setExportType(id === "excel" ? "excel" : "pdf")
          setExportTypeOptionsOpen(true)
        }}
      />

      <ExportOptionsDialog
        open={exportTypeOptionsOpen}
        onOpenChange={setExportTypeOptionsOpen}
        title="Export Payment Type"
        options={[
          { id: "all", label: "All" },
          { id: "one-time", label: "One-time" },
          { id: "recurring", label: "Recurring" },
        ]}
        onSelect={(id) => {
          setExportPaymentType(id === "one-time" || id === "recurring" ? id : "all")
          setExportDialogOpen(true)
        }}
      />
    </DataTablePage>
  )
}
