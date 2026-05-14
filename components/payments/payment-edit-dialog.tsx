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
import { Building2, Phone, MapPin, DollarSign } from "lucide-react"
import { FormFieldGroup } from "@/components/ui/patterns"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import type { Department, Category, PaymentEditFormData } from "./payment-types"

interface PaymentEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  formData: PaymentEditFormData
  onFormDataChange: (data: PaymentEditFormData) => void
  onSubmit: (data: PaymentEditFormData) => void
  updating: boolean
  departments: Department[]
  categories: Category[]
  /** When true, shows a payment_type select instead of using category as type */
  showPaymentTypeField?: boolean
}

const PaymentEditDialogSchema = z.object({
  department_id: z.string().trim().min(1, "Department is required"),
  payment_type: z.union([z.literal(""), z.enum(["one-time", "recurring"])]),
  category: z.string().trim().min(1, "Category is required"),
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

export function PaymentEditDialog({
  open,
  onOpenChange,
  formData,
  onFormDataChange,
  onSubmit,
  updating,
  departments,
  categories,
  showPaymentTypeField = false,
}: PaymentEditDialogProps) {
  const form = useForm<PaymentEditFormData>({
    resolver: zodResolver(PaymentEditDialogSchema),
    defaultValues: formData,
  })
  useEffect(() => {
    form.reset(formData)
  }, [form, formData])
  useEffect(() => {
    const subscription = form.watch((value) => {
      onFormDataChange({ ...formData, ...value } as PaymentEditFormData)
    })
    return () => subscription.unsubscribe()
  }, [form, formData, onFormDataChange])

  const values = form.watch()
  const recurringState = showPaymentTypeField ? values.payment_type === "recurring" : values.category === "recurring"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Payment</DialogTitle>
          <DialogDescription>Update the payment details below.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormFieldGroup label="Department">
              <Select
                value={values.department_id}
                onValueChange={(value) => form.setValue("department_id", value, { shouldValidate: true })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormFieldGroup>

            {showPaymentTypeField ? (
              <div className="space-y-2">
                <Label htmlFor="payment_type">Payment Type</Label>
                <Select
                  value={values.payment_type}
                  onValueChange={(value: "one-time" | "recurring") => form.setValue("payment_type", value)}
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
            ) : (
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={values.category}
                  onValueChange={(value: "one-time" | "recurring") => form.setValue("category", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one-time">One-time</SelectItem>
                    <SelectItem value="recurring">Recurring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {showPaymentTypeField && (
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select value={values.category} onValueChange={(value) => form.setValue("category", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.name}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={values.title}
                onChange={(e) => form.setValue("title", e.target.value, { shouldValidate: true })}
              />
            </div>
          </div>

          {/* Issuer Fields */}
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
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <div className="relative">
                <DollarSign className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
                <Input
                  id="amount"
                  type="number"
                  className="pl-9"
                  value={values.amount}
                  onChange={(e) => form.setValue("amount", e.target.value, { shouldValidate: true })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select value={values.currency} onValueChange={(value) => form.setValue("currency", value)}>
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

          {recurringState ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="recurrence">Recurrence Period</Label>
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
                <Label htmlFor="next_due">Next Payment Due</Label>
                <Input
                  id="next_due"
                  type="date"
                  value={values.next_payment_due}
                  onChange={(e) => form.setValue("next_payment_due", e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="payment_date">Payment Date</Label>
              <Input
                id="payment_date"
                type="date"
                value={values.payment_date}
                onChange={(e) => form.setValue("payment_date", e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={values.description}
              onChange={(e) => form.setValue("description", e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updating}>
              {updating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
