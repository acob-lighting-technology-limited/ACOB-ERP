"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, Phone, MapPin, Calendar, Receipt } from "lucide-react"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import type { Department } from "./payment-types"
import { PAYMENT_TYPES } from "@/lib/validation"

export interface CreatePaymentFormData {
  department_id: string
  payment_type: "one-time" | "recurring" | ""
  title: string
  description: string
  amount: string
  currency: string
  recurrence_period: string
  next_payment_due: string
  payment_date: string
  issuer_name: string
  issuer_phone_number: string
  issuer_address: string
  payment_reference: string
  notes: string
}

interface CreatePaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  formData: CreatePaymentFormData
  onFormDataChange: (data: CreatePaymentFormData) => void
  onSubmit: (data: CreatePaymentFormData) => void
  submitting: boolean
  receiptFile: File | null
  onReceiptFileChange: (file: File | null) => void
  departments: Department[]
  filterableDepartments: Department[]
  isAdmin: boolean
}

const CreatePaymentDialogSchema = z
  .object({
    department_id: z.string().trim().min(1, "Department is required"),
    payment_type: z.enum(PAYMENT_TYPES),
    title: z.string().trim().min(1, "Title is required"),
    description: z.string(),
    amount: z.string().trim().min(1, "Amount is required"),
    currency: z.string().trim().min(1, "Currency is required"),
    recurrence_period: z.string(),
    next_payment_due: z.string(),
    payment_date: z.string(),
    issuer_name: z.string().trim().min(1, "Issuer Name is required"),
    issuer_phone_number: z.string().trim().min(1, "Issuer Phone is required"),
    issuer_address: z.string(),
    payment_reference: z.string(),
    notes: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.payment_type === "recurring" && (!value.recurrence_period || !value.next_payment_due)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["next_payment_due"], message: "Next payment due is required" })
    }
    if (value.payment_type === "one-time" && !value.payment_date) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payment_date"], message: "Payment date is required" })
    }
  })

export function CreatePaymentDialog({
  open,
  onOpenChange,
  formData,
  onFormDataChange,
  onSubmit,
  submitting,
  receiptFile,
  onReceiptFileChange,
  departments,
  filterableDepartments,
  isAdmin,
}: CreatePaymentDialogProps) {
  const form = useForm<CreatePaymentFormData>({
    resolver: zodResolver(CreatePaymentDialogSchema),
    defaultValues: formData,
  })

  useEffect(() => {
    form.reset(formData)
  }, [form, formData])

  useEffect(() => {
    const subscription = form.watch((value) => {
      onFormDataChange({ ...formData, ...value } as CreatePaymentFormData)
    })
    return () => subscription.unsubscribe()
  }, [form, formData, onFormDataChange])

  const values = form.watch()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Payment</DialogTitle>
          <DialogDescription>Create a new payment record. Issuer Name and Phone are required.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="department">Department</Label>
              <Select
                value={values.department_id}
                onValueChange={(value) => form.setValue("department_id", value, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Department" />
                </SelectTrigger>
                <SelectContent>
                  {(isAdmin ? departments : filterableDepartments).map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-type">Type</Label>
              <Select
                value={values.payment_type}
                onValueChange={(value: "one-time" | "recurring") =>
                  form.setValue("payment_type", value, { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one-time">One-time</SelectItem>
                  <SelectItem value="recurring">Recurring</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Payment Title</Label>
            <Input
              id="title"
              value={values.title}
              onChange={(e) => form.setValue("title", e.target.value, { shouldValidate: true })}
              placeholder="e.g., Office Rent 2024"
              required
            />
          </div>

          <div className="bg-muted/20 mt-2 grid grid-cols-2 gap-4 rounded-md border p-3">
            <div className="text-muted-foreground col-span-2 mb-1 text-sm font-semibold">Issuer Details</div>
            <div className="space-y-2">
              <Label htmlFor="issuer_name">Issuer Name *</Label>
              <div className="relative">
                <Building2 className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
                <Input
                  id="issuer_name"
                  className="pl-9"
                  value={values.issuer_name}
                  onChange={(e) => form.setValue("issuer_name", e.target.value, { shouldValidate: true })}
                  placeholder="Company or Person Name"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="issuer_phone">Issuer Phone *</Label>
              <div className="relative">
                <Phone className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
                <Input
                  id="issuer_phone"
                  className="pl-9"
                  value={values.issuer_phone_number}
                  onChange={(e) => form.setValue("issuer_phone_number", e.target.value, { shouldValidate: true })}
                  placeholder="+234..."
                  required
                />
              </div>
            </div>
            <div className="col-span-2 space-y-2">
              <Label htmlFor="issuer_address">Issuer Address</Label>
              <div className="relative">
                <MapPin className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
                <Input
                  id="issuer_address"
                  className="pl-9"
                  value={values.issuer_address}
                  onChange={(e) => form.setValue("issuer_address", e.target.value)}
                  placeholder="Address (Optional)"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <div className="relative">
                <span className="text-muted-foreground absolute top-2.5 left-3 font-semibold">₦</span>
                <Input
                  id="amount"
                  type="number"
                  className="pl-8"
                  value={values.amount}
                  onChange={(e) => form.setValue("amount", e.target.value, { shouldValidate: true })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select
                value={values.currency}
                onValueChange={(value) => form.setValue("currency", value, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NGN">NGN (₦)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {values.payment_type === "recurring" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="period">Recurrence Period</Label>
                <Select
                  value={values.recurrence_period}
                  onValueChange={(value) => form.setValue("recurrence_period", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="start_date">Next Payment Due</Label>
                <div className="relative">
                  <Calendar className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
                  <Input
                    id="start_date"
                    type="date"
                    className="pl-9"
                    value={values.next_payment_due}
                    onChange={(e) => form.setValue("next_payment_due", e.target.value, { shouldValidate: true })}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="payment_date">Payment Date</Label>
              <div className="relative">
                <Calendar className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
                <Input
                  id="payment_date"
                  type="date"
                  className="pl-9"
                  value={values.payment_date}
                  onChange={(e) => form.setValue("payment_date", e.target.value, { shouldValidate: true })}
                />
              </div>
            </div>
          )}

          {values.payment_type === "one-time" && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
              <div className="space-y-2">
                <Label htmlFor="receipt" className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-green-600" />
                  Payment Receipt *
                </Label>
                <p className="text-muted-foreground mb-2 text-sm">
                  Since this is a one-time payment, please upload the payment receipt as proof of payment.
                </p>
                <Input
                  id="receipt"
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => onReceiptFileChange(e.target.files?.[0] || null)}
                  className="cursor-pointer"
                />
                {receiptFile && (
                  <p className="text-sm text-green-600 dark:text-green-400">Selected: {receiptFile.name}</p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="payment_reference">Reference Number (Optional)</Label>
            <Input
              id="payment_reference"
              value={values.payment_reference}
              onChange={(e) => form.setValue("payment_reference", e.target.value)}
              placeholder="e.g., TXN123456789"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={values.description}
              onChange={(e) => form.setValue("description", e.target.value)}
              placeholder="Additional details..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create Payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
