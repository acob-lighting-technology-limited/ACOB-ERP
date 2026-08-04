"use client"

import React, { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { numberToNairaWords } from "@/lib/requisitions/number-to-words"
import type { BeneficiaryDetail, RequisitionAttachment } from "@/lib/requisitions/types"
import { Plus, Trash2, Upload, FileText, Loader2, AlertCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

interface NewRequisitionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userDepartment?: string | null
  onSuccess?: () => void
}

export function NewRequisitionDialog({ open, onOpenChange, userDepartment, onSuccess }: NewRequisitionDialogProps) {
  const [department, setDepartment] = useState(userDepartment || "General")
  const [projectName, setProjectName] = useState("")
  const [amount, setAmount] = useState<string>("")
  const [amountInWords, setAmountInWords] = useState<string>("")
  const [purpose, setPurpose] = useState("")
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryDetail[]>([
    { account_name: "", account_number: "", bank_name: "" },
  ])
  const [attachments, setAttachments] = useState<RequisitionAttachment[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Update amount in words when numeric amount changes
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setAmount(val)
    const num = parseFloat(val)
    if (!isNaN(num) && num > 0) {
      setAmountInWords(numberToNairaWords(num))
    } else {
      setAmountInWords("")
    }
  }

  const handleAddBeneficiary = () => {
    setBeneficiaries((prev) => [...prev, { account_name: "", account_number: "", bank_name: "" }])
  }

  const handleRemoveBeneficiary = (index: number) => {
    if (beneficiaries.length <= 1) return
    setBeneficiaries((prev) => prev.filter((_, i) => i !== index))
  }

  const handleBeneficiaryChange = (index: number, field: keyof BeneficiaryDetail, value: string) => {
    setBeneficiaries((prev) => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      return updated
    })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsUploading(true)
    setErrorMsg(null)

    try {
      const supabase = createClient()
      const uploaded: RequisitionAttachment[] = []

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileExt = file.name.split(".").pop()
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
        const filePath = `receipts/${fileName}`

        const { data, error } = await supabase.storage
          .from("requisition_documents")
          .upload(filePath, file, { cacheControl: "3600", upsert: false })

        if (error) {
          throw new Error(`Upload failed for ${file.name}: ${error.message}`)
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("requisition_documents").getPublicUrl(filePath)

        uploaded.push({
          file_name: file.name,
          file_url: publicUrl,
          file_type: file.type,
          file_size: file.size,
        })
      }

      setAttachments((prev) => [...prev, ...uploaded])
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to upload file(s)")
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg("Please enter a valid amount greater than 0.")
      return
    }

    if (!purpose.trim()) {
      setErrorMsg("Please state the purpose for this requisition.")
      return
    }

    if (!projectName.trim()) {
      setErrorMsg("Please provide the project or cost center name.")
      return
    }

    // Check beneficiary validation
    for (const b of beneficiaries) {
      if (!b.account_name.trim() || !b.account_number.trim() || !b.bank_name.trim()) {
        setErrorMsg("All beneficiary rows must have Account Name, Account Number, and Bank Name filled.")
        return
      }
    }

    // MANDATORY RECEIPT VALIDATION
    if (attachments.length === 0) {
      setErrorMsg("Mandatory Requirement: You must attach at least one supporting receipt or invoice document.")
      return
    }

    setIsSubmitting(true)

    try {
      const res = await fetch("/api/requisitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department,
          project_name: projectName,
          amount: numAmount,
          amount_in_words: amountInWords || numberToNairaWords(numAmount),
          purpose,
          beneficiary_details: beneficiaries,
          attachments,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || json.message || "Failed to submit requisition")
      }

      onOpenChange(false)
      onSuccess?.()
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to submit requisition")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">New Payment Request Form</DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            Fill out the digital requisition details. Supporting receipt / invoice attachment is mandatory.
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold">Department</Label>
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Admin & HR"
                required
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Project / Cost Center</Label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Solar Maintenance Phase 1"
                required
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold">Amount (₦)</Label>
              <Input
                type="number"
                step="0.01"
                min="1"
                value={amount}
                onChange={handleAmountChange}
                placeholder="e.g. 150000"
                required
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Amount in Words</Label>
              <Input
                value={amountInWords}
                onChange={(e) => setAmountInWords(e.target.value)}
                placeholder="One Hundred and Fifty Thousand Naira Only"
                required
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Purpose / Justification</Label>
            <Textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Describe the detailed purpose for this payment request..."
              rows={3}
              required
              className="mt-1 text-xs"
            />
          </div>

          {/* Beneficiary Details Dynamic Table */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
                Beneficiary Details
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddBeneficiary}
                className="h-7 gap-1 text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> Add Row
              </Button>
            </div>

            {beneficiaries.map((b, idx) => (
              <div
                key={idx}
                className="bg-muted/30 relative grid grid-cols-1 gap-2 rounded-lg border p-2 sm:grid-cols-3"
              >
                <div>
                  <Input
                    placeholder="Account Name"
                    value={b.account_name}
                    onChange={(e) => handleBeneficiaryChange(idx, "account_name", e.target.value)}
                    required
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Input
                    placeholder="Account Number"
                    value={b.account_number}
                    onChange={(e) => handleBeneficiaryChange(idx, "account_number", e.target.value)}
                    required
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Bank Name"
                    value={b.bank_name}
                    onChange={(e) => handleBeneficiaryChange(idx, "bank_name", e.target.value)}
                    required
                    className="h-8 text-xs"
                  />
                  {beneficiaries.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveBeneficiary(idx)}
                      className="h-8 w-8 shrink-0 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Mandatory Supporting Document Attachment */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                Attach Supporting Receipts / Documents * (Mandatory)
              </Label>
              <span className="text-muted-foreground text-[10px]">PDF, PNG, JPG up to 10MB</span>
            </div>

            <div className="hover:bg-muted/30 relative rounded-lg border-2 border-dashed p-4 text-center transition">
              <input
                type="file"
                multiple
                accept="application/pdf,image/*"
                onChange={handleFileUpload}
                disabled={isUploading}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <div className="pointer-events-none flex flex-col items-center justify-center gap-1.5">
                {isUploading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                ) : (
                  <Upload className="text-muted-foreground h-6 w-6" />
                )}
                <span className="text-xs font-medium">
                  {isUploading ? "Uploading files..." : "Click or drag receipts & invoices here"}
                </span>
              </div>
            </div>

            {attachments.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {attachments.map((att, i) => (
                  <div key={i} className="bg-card flex items-center justify-between rounded border p-2 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="truncate font-medium">{att.file_name}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveAttachment(i)}
                      className="h-6 w-6 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 border-t pt-4">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting || isUploading}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...
                </>
              ) : (
                "Submit Requisition"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
