"use client"

import { useState, use } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Calendar, FileText, MoreVertical, Trash2, CheckCircle, Edit, Printer } from "lucide-react"
import { toast } from "sonner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  addMonths,
  addYears,
  addQuarters,
  format,
  parseISO,
  differenceInDays,
  startOfDay,
  isValid,
  isBefore,
} from "date-fns"
import { PageHeader } from "@/components/layout/page-header"
import { PageLoader } from "@/components/ui/query-states"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ScheduleList } from "@/components/payments/schedule-list"
import { PaymentEditDialog } from "@/components/payments/payment-edit-dialog"
import { PaymentUploadDialog } from "@/components/payments/payment-upload-dialog"
import { PrintReceiptDialog } from "@/components/payments/print-receipt-dialog"
import { PaymentInfoCard } from "@/components/payments/payment-info-card"
import { PaymentMetaCard } from "@/components/payments/payment-meta-card"
import { usePaymentSchedule } from "@/components/payments/use-payment-schedule"
import { apiFetch } from "@/lib/api-client"
import type {
  Payment,
  Department,
  Category,
  PaymentDocument,
  PaymentEditFormData,
} from "@/components/payments/payment-types"

interface PaymentPageData {
  payment: Payment | null
  departments: Department[]
  categories: Category[]
}

async function fetchPaymentPageData(id: string): Promise<PaymentPageData> {
  const [paymentRes, deptRes, catRes] = await Promise.all([
    apiFetch(`/api/payments/${id}`),
    apiFetch("/api/departments"),
    apiFetch("/api/payments/categories"),
  ])

  const paymentJson = await paymentRes.json()
  const payment: Payment | null = paymentRes.ok ? (paymentJson.data ?? null) : null
  if (!paymentRes.ok) {
    throw new Error(paymentJson.error ?? "Failed to fetch payment details")
  }

  const departments: Department[] = deptRes.ok ? ((await deptRes.json()).data ?? []) : []
  const categories: Category[] = catRes.ok ? ((await catRes.json()).data ?? []) : []

  return { payment, departments, categories }
}

export default function PaymentDetailsPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params)
  const router = useRouter()
  const queryClient = useQueryClient()

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Upload State
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [uploadDate, setUploadDate] = useState<Date | null>(null)
  const [uploadType, setUploadType] = useState<"invoice" | "receipt">("invoice")
  const [uploading, setUploading] = useState(false)
  const [replaceDocumentId, setReplaceDocumentId] = useState<string | null>(null)

  // Edit State
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [editFormData, setEditFormData] = useState<PaymentEditFormData>({
    department_id: "",
    payment_type: "",
    category: "",
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

  const { data: pageData, isLoading: loading } = useQuery({
    queryKey: QUERY_KEYS.appPaymentDetail(params.id),
    queryFn: () => fetchPaymentPageData(params.id),
  })

  const payment = pageData?.payment ?? null
  const departments = pageData?.departments ?? []
  const categories = pageData?.categories ?? []

  const schedule = usePaymentSchedule(payment)

  const downloadPaymentDocument = (doc: PaymentDocument) => {
    const filename = doc.file_name || doc.file_path.split("/").pop() || "document.pdf"
    const toastId = toast.loading("Preparing download...")
    const link = document.createElement("a")
    link.href = `/api/payments/${params.id}/documents/${doc.id}/download`
    link.download = filename
    link.style.display = "none"
    link.rel = "noopener noreferrer"
    document.body.appendChild(link)
    link.click()
    window.setTimeout(() => {
      document.body.removeChild(link)
    }, 100)
    window.setTimeout(() => {
      toast.dismiss(toastId)
    }, 6000)
  }

  const handleEditClick = () => {
    if (!payment) return
    setEditFormData({
      department_id: payment.department_id,
      payment_type: payment.payment_type,
      category: payment.category,
      title: payment.title,
      description: payment.description || "",
      amount: payment.amount.toString(),
      currency: payment.currency,
      recurrence_period: payment.recurrence_period || "monthly",
      next_payment_due: payment.next_payment_due ? format(parseISO(payment.next_payment_due), "yyyy-MM-dd") : "",
      payment_date: payment.payment_date ? format(parseISO(payment.payment_date), "yyyy-MM-dd") : "",
      issuer_name: payment.issuer_name || "",
      issuer_phone_number: payment.issuer_phone_number || "",
      issuer_address: payment.issuer_address || "",
      payment_reference: payment.payment_reference || "",
      notes: payment.notes || "",
    })
    setEditDialogOpen(true)
  }

  const handleUpdate = async (submittedFormData: PaymentEditFormData) => {
    try {
      setUpdating(true)
      const payload = {
        ...submittedFormData,
        payment_type: submittedFormData.payment_type,
        category: submittedFormData.category,
        amount: parseFloat(submittedFormData.amount),
        next_payment_due: submittedFormData.next_payment_due || null,
        payment_date: submittedFormData.payment_date || null,
      }

      const response = await apiFetch(`/api/payments/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        toast.success("Payment updated successfully")
        setEditDialogOpen(false)
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.appPaymentDetail(params.id) })
      } else {
        const data = await response.json()
        toast.error(data.error || "Failed to update payment")
      }
    } catch {
      toast.error("Error updating payment")
    } finally {
      setUpdating(false)
    }
  }

  const handleDelete = async () => {
    try {
      setDeleteLoading(true)
      const response = await apiFetch(`/api/payments/${params.id}`, { method: "DELETE" })

      if (response.ok) {
        toast.success("Payment deleted successfully")
        router.push("/payments")
      } else {
        const data = await response.json()
        toast.error(data.error || "Failed to delete payment")
      }
    } catch {
      toast.error("Error deleting payment")
    } finally {
      setDeleteLoading(false)
      setDeleteDialogOpen(false)
    }
  }

  const markAsPaid = async (targetDate?: Date) => {
    if (!payment) return

    if (payment.payment_type === "recurring" && payment.next_payment_due && payment.recurrence_period) {
      const dateToPay = targetDate instanceof Date ? targetDate : parseISO(payment.next_payment_due)
      const dateStr = format(dateToPay, "yyyy-MM-dd")
      const hasReceipt = payment.documents?.some((d) => d.applicable_date === dateStr && d.document_type === "receipt")

      if (!hasReceipt) {
        toast.error("Please upload a payment receipt first.", {
          action: { label: "Upload", onClick: () => handleUploadClick(dateToPay, "receipt") },
          duration: 5000,
        })
        handleUploadClick(dateToPay, "receipt")
        return
      }

      const currentDue = parseISO(payment.next_payment_due)
      let nextDue: Date
      switch (payment.recurrence_period) {
        case "monthly":
          nextDue = addMonths(currentDue, 1)
          break
        case "quarterly":
          nextDue = addQuarters(currentDue, 1)
          break
        case "yearly":
          nextDue = addYears(currentDue, 1)
          break
        default:
          nextDue = addMonths(currentDue, 1)
      }

      try {
        const response = await apiFetch(`/api/payments/${params.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            next_payment_due: format(nextDue, "yyyy-MM-dd"),
            last_payment_date: format(dateToPay, "yyyy-MM-dd"),
            status: "due",
            amount_paid: (payment.amount_paid || 0) + payment.amount,
          }),
        })

        if (response.ok) {
          toast.success("Payment recorded! Schedule advanced.")
          queryClient.invalidateQueries({ queryKey: QUERY_KEYS.appPaymentDetail(params.id) })
        } else {
          toast.error("Failed to update payment")
        }
      } catch {
        toast.error("Error processing payment")
      }
    } else {
      updateStatus("paid")
    }
  }

  const updateStatus = async (newStatus: string) => {
    if (!payment) return
    try {
      const response = await apiFetch(`/api/payments/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          amount_paid: newStatus === "paid" ? payment.amount : newStatus === "due" ? 0 : payment.amount_paid,
        }),
      })

      if (response.ok) {
        toast.success(`Payment marked as ${newStatus}`)
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.appPaymentDetail(params.id) })
      } else {
        toast.error("Failed to update status")
      }
    } catch {
      toast.error("Error updating status")
    }
  }

  const handleUploadClick = (date: Date, type: "invoice" | "receipt") => {
    setUploadDate(date)
    setUploadType(type)
    setReplaceDocumentId(null)
    setUploadDialogOpen(true)
  }

  const handleReplaceClick = (date: Date, type: "invoice" | "receipt", docId: string) => {
    setUploadDate(date)
    setUploadType(type)
    setReplaceDocumentId(docId)
    setUploadDialogOpen(true)
  }

  const handleFileUpload = async (e: React.FormEvent, inputRef: React.RefObject<HTMLInputElement | null>) => {
    e.preventDefault()
    if (!inputRef.current?.files?.[0] || !uploadDate) return

    const file = inputRef.current.files[0]
    const formData = new FormData()
    formData.append("file", file)
    formData.append("document_type", uploadType)
    formData.append("applicable_date", format(uploadDate, "yyyy-MM-dd"))

    if (replaceDocumentId) {
      formData.append("replace_document_id", replaceDocumentId)
    }

    setUploading(true)
    try {
      const response = await apiFetch(`/api/payments/${params.id}/documents`, { method: "POST", body: formData })

      if (response.ok) {
        toast.success(replaceDocumentId ? `${uploadType} replaced successfully` : `${uploadType} uploaded successfully`)
        setUploadDialogOpen(false)
        setReplaceDocumentId(null)
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.appPaymentDetail(params.id) })
      } else {
        const data = await response.json()
        toast.error(data.error || "Upload failed")
      }
    } catch {
      toast.error("Error uploading file")
    } finally {
      setUploading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      case "due":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      case "overdue":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      case "cancelled":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
      default:
        return ""
    }
  }

  const formatCurrency = (amount: number, currency: string = "NGN") => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(amount)
  }

  const getRealStatus = (p: Payment): "due" | "paid" | "overdue" | "cancelled" => {
    if (p.status === "paid" || p.status === "cancelled") return p.status

    const dateStr = p.payment_type === "recurring" ? p.next_payment_due : p.payment_date
    if (!dateStr) return "due"

    const date = parseISO(dateStr)
    if (!isValid(date)) return "due"

    const today = startOfDay(new Date())
    const daysDiff = differenceInDays(date, today)

    if (isBefore(date, today)) return "overdue"
    if (daysDiff <= 7) return "due"
    return "paid"
  }

  if (loading) return <PageLoader />

  if (!payment) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Payment not found</p>
        <Link href="/payments">
          <Button variant="outline">Back to Payments</Button>
        </Link>
      </div>
    )
  }

  const realStatus = getRealStatus(payment)

  const hasReceiptForMark = (() => {
    if (payment.payment_type === "one-time") {
      return payment.documents?.some((d) => d.document_type === "receipt") ?? false
    } else if (payment.next_payment_due) {
      const dateStr = format(parseISO(payment.next_payment_due), "yyyy-MM-dd")
      return payment.documents?.some((d) => d.applicable_date === dateStr && d.document_type === "receipt") ?? false
    }
    return false
  })()

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && router.push("/payments", { scroll: false })}>
      <DialogContent
        className="max-h-[82vh] w-[96vw] max-w-3xl overflow-y-auto p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="from-background via-background to-muted/20 bg-gradient-to-br p-3 md:p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            <PageHeader
              title={payment.title}
              description={
                payment.payment_type === "recurring"
                  ? `Repeats ${payment.recurrence_period}`
                  : `One-time payment on ${payment.payment_date ? format(parseISO(payment.payment_date), "PPP") : "N/A"}`
              }
              backLink={{ href: "/payments", label: "Back to Payments" }}
              actions={
                <div className="flex flex-wrap gap-2">
                  <Badge className={getStatusColor(realStatus)}>{realStatus}</Badge>
                  {payment.payment_type === "recurring" && payment.next_payment_due && (
                    <Badge
                      variant="outline"
                      className="border-primary/20 text-primary bg-primary/5 border-2 px-2 py-0.5 text-sm font-medium"
                    >
                      Next Due: {format(parseISO(payment.next_payment_due), "MMM d, yyyy")}
                    </Badge>
                  )}
                  {(realStatus === "due" || realStatus === "overdue") && hasReceiptForMark && (
                    <Button onClick={() => markAsPaid()}>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      {payment.payment_type === "recurring" ? "Mark Current Due as Paid" : "Mark as Paid"}
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleEditClick}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Payment
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPrintDialogOpen(true)}>
                        <Printer className="mr-2 h-4 w-4" />
                        Download Receipt
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600 focus:text-red-600"
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Payment
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              }
            />

            <div className="grid gap-6 md:grid-cols-3">
              <div className="space-y-6 md:col-span-2">
                {payment.payment_type === "recurring" && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Calendar className="h-5 w-5" />
                          Upcoming Schedule
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScheduleList
                          items={schedule.filter((i) => i.status !== "paid")}
                          onUpload={handleUploadClick}
                          onView={(_, doc) => downloadPaymentDocument(doc)}
                          onMarkPaid={markAsPaid}
                          onReplace={handleReplaceClick}
                        />
                      </CardContent>
                    </Card>

                    {schedule.some((i) => i.status === "paid") && (
                      <Card className="mt-6">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Payment History
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScheduleList
                            items={schedule.filter((i) => i.status === "paid")}
                            onUpload={handleUploadClick}
                            onView={(_, doc) => downloadPaymentDocument(doc)}
                            onReplace={handleReplaceClick}
                          />
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}

                <PaymentInfoCard payment={payment} formatCurrency={formatCurrency} />
              </div>

              <div className="space-y-6">
                <PaymentMetaCard payment={payment} />
              </div>
            </div>
          </div>

          <PaymentEditDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            formData={editFormData}
            onFormDataChange={setEditFormData}
            onSubmit={handleUpdate}
            updating={updating}
            departments={departments}
            categories={categories}
            showPaymentTypeField={true}
          />

          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the payment record and remove it from our
                  servers.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
                <Button variant="destructive" onClick={handleDelete} loading={deleteLoading}>
                  Delete
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <PaymentUploadDialog
            open={uploadDialogOpen}
            onOpenChange={(open) => {
              setUploadDialogOpen(open)
              if (!open) setReplaceDocumentId(null)
            }}
            uploadDate={uploadDate}
            uploadType={uploadType}
            uploading={uploading}
            replaceDocumentId={replaceDocumentId}
            onSubmit={handleFileUpload}
          />

          <PrintReceiptDialog
            open={printDialogOpen}
            onOpenChange={setPrintDialogOpen}
            schedule={schedule}
            onDownloadDocument={downloadPaymentDocument}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
