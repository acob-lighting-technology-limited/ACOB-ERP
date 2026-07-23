"use client"

import React from "react"
import type { Requisition } from "@/lib/requisitions/types"
import { getStageLabel } from "@/lib/requisitions/workflow"
import { CheckCircle2, Clock, XCircle, FileText, Download, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"

interface RequisitionPdfDocumentProps {
  requisition: Requisition
  onApprove?: (comments?: string) => void
  onReject?: (comments?: string) => void
  isApprover?: boolean
  isSubmitting?: boolean
}

export function RequisitionPdfDocument({
  requisition,
  onApprove,
  onReject,
  isApprover,
  isSubmitting,
}: RequisitionPdfDocumentProps) {
  const [comments, setComments] = React.useState("")
  const [showRejectInput, setShowRejectInput] = React.useState(false)

  const handlePrint = () => {
    window.print()
  }

  const getStatusBadge = () => {
    if (requisition.status === "approved") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Fully Approved
        </span>
      )
    }
    if (requisition.status === "rejected") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-600">
          <XCircle className="h-3.5 w-3.5" /> Rejected
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600">
        <Clock className="h-3.5 w-3.5" /> {getStageLabel(requisition.current_stage_code)}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Controls (Hidden on Print) */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 print:hidden">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm font-medium">Status:</span>
          {getStatusBadge()}
          <span className="text-muted-foreground border-l pl-3 text-xs">
            Ref: <strong className="text-foreground font-mono">{requisition.requisition_number}</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        </div>
      </div>

      {/* Approver Action Panel (Hidden on Print) */}
      {isApprover && requisition.status === "pending" && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 print:hidden">
          <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Action Required: You are tasked with approving this stage ({getStageLabel(requisition.current_stage_code)})
          </h4>
          <textarea
            placeholder="Add comments or feedback (optional for approval, required for rejection)..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            className="bg-background text-foreground w-full rounded-lg border p-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-500"
            rows={2}
          />
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="destructive"
              size="sm"
              disabled={isSubmitting}
              onClick={() => {
                if (!comments.trim()) {
                  alert("Please provide comments explaining the rejection.")
                  return
                }
                onReject?.(comments)
              }}
            >
              Reject Requisition
            </Button>

            <Button
              variant="default"
              size="sm"
              disabled={isSubmitting}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => onApprove?.(comments)}
            >
              Approve Stage
            </Button>
          </div>
        </div>
      )}

      {/* Printable Digital Form Document */}
      <div className="print-document-container mx-auto max-w-4xl rounded-xl border bg-white p-6 font-sans leading-normal text-slate-900 shadow-sm md:p-10">
        {/* Header Branding */}
        <div className="mb-4 flex flex-col items-start justify-between gap-4 border-b border-slate-300 pb-4 md:flex-row">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tracking-tight text-emerald-700">ACOB</span>
              <span className="text-2xl font-bold tracking-tight text-slate-800">LIGHTING</span>
            </div>
            <div className="text-xs font-semibold tracking-wider text-emerald-600 uppercase">technology limited</div>
            <div className="font-serif text-[10px] text-slate-500 italic">...Lighting up Nigeria</div>
            <div className="mt-1 font-mono text-[10px] text-slate-400">RC: 1324192</div>
          </div>

          <div className="space-y-0.5 text-right text-[11px] text-slate-600">
            <p>Plot 2, Block 14 Extension, Federal Ministry of Works and Housing Sites and Services Scheme,</p>
            <p>Gwarinpa Phase 2, Abuja FCT.</p>
            <p>Email: info@acoblighting.com, infoacob@gmail.com</p>
            <p>Phone: +234 704 920 2634, +234 803 290 2825</p>
            <p>Website: www.acoblighting.com</p>
          </div>
        </div>

        {/* Department Header Box */}
        <div className="mb-4 flex justify-end">
          <div className="border border-slate-900 bg-slate-50 px-4 py-1.5 text-xs font-semibold tracking-wider uppercase">
            DEPARTMENT: <span className="ml-2 font-bold text-slate-900">{requisition.department}</span>
          </div>
        </div>

        {/* Title Bar */}
        <div className="mb-6 border border-slate-900 bg-slate-100 py-2 text-center text-lg font-extrabold tracking-wide uppercase">
          PAYMENT REQUEST FORM
        </div>

        {/* Form Body Fields */}
        <div className="space-y-4 text-xs">
          {/* Requested By & Sign */}
          <div className="grid grid-cols-1 gap-4 border-b border-slate-200 pb-2 md:grid-cols-3">
            <div className="md:col-span-2">
              <span className="font-bold tracking-wider text-slate-700 uppercase">REQUESTED BY: </span>
              <span className="border-b border-slate-400 px-2 pb-0.5 font-semibold text-slate-900">
                {requisition.requester?.full_name || "N/A"}
              </span>
            </div>
            <div>
              <span className="font-bold tracking-wider text-slate-700 uppercase">SIGN: </span>
              <span className="border-b border-slate-400 px-2 pb-0.5 font-serif text-slate-700 italic">
                [Digitally Signed]
              </span>
            </div>
          </div>

          {/* Amount In Words */}
          <div className="border-b border-slate-200 pb-2">
            <span className="font-bold tracking-wider text-slate-700 uppercase">AMOUNT IN WORDS: </span>
            <span className="mt-1 block border-b border-slate-400 px-2 pb-0.5 font-semibold text-slate-900 md:mt-0 md:inline">
              {requisition.amount_in_words}
            </span>
          </div>

          {/* Purpose */}
          <div className="border-b border-slate-200 pb-2">
            <span className="font-bold tracking-wider text-slate-700 uppercase">PURPOSE: </span>
            <span className="mt-1 block leading-relaxed font-medium whitespace-pre-wrap text-slate-900">
              {requisition.purpose}
            </span>
          </div>

          {/* Project, Date, Amount */}
          <div className="my-4 grid grid-cols-1 gap-2 border border-slate-900 bg-slate-50 p-2 font-semibold sm:grid-cols-3">
            <div>
              <span className="block text-[10px] text-slate-600 uppercase">PROJECT:</span>
              <span className="text-slate-900">{requisition.project_name}</span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-600 uppercase">DATE:</span>
              <span className="text-slate-900">
                {new Date(requisition.created_at).toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-600 uppercase">AMOUNT (₦):</span>
              <span className="text-sm font-bold text-emerald-700">
                ₦{Number(requisition.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Beneficiary Details Section */}
          <div className="mt-6 space-y-2">
            <h4 className="text-center text-xs font-bold tracking-wider text-slate-900 uppercase">
              BENEFICIARY DETAILS:
            </h4>
            <div className="overflow-hidden border border-slate-900">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-slate-900 bg-slate-100 font-bold text-slate-800 uppercase">
                    <th className="w-1/3 border-r border-slate-900 p-2">ACCOUNT NAME</th>
                    <th className="w-1/3 border-r border-slate-900 p-2">ACCOUNT NO</th>
                    <th className="w-1/3 p-2">BANK NAME</th>
                  </tr>
                </thead>
                <tbody>
                  {requisition.beneficiary_details && requisition.beneficiary_details.length > 0 ? (
                    requisition.beneficiary_details.map((b, idx) => (
                      <tr key={idx} className="border-b border-slate-300 last:border-0">
                        <td className="border-r border-slate-900 p-2 font-medium">{b.account_name}</td>
                        <td className="border-r border-slate-900 p-2 font-mono">{b.account_number}</td>
                        <td className="p-2 font-medium">{b.bank_name}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="p-2 text-center text-slate-400 italic">
                        No beneficiary details provided
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Attached Supporting Documents / Receipts */}
          {requisition.attachments && requisition.attachments.length > 0 && (
            <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 print:hidden">
              <h5 className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <FileText className="h-4 w-4 text-emerald-600" /> Attached Receipts & Supporting Documents:
              </h5>
              <div className="flex flex-wrap gap-2">
                {requisition.attachments.map((file, i) => (
                  <a
                    key={i}
                    href={file.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border bg-slate-50 px-3 py-1.5 text-xs text-slate-800 transition hover:bg-slate-100"
                  >
                    <Download className="h-3.5 w-3.5 text-slate-500" />
                    <span>{file.file_name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Footer Approval Grid */}
          <div className="mt-10 space-y-4 border-t border-slate-300 pt-6">
            <div className="grid grid-cols-2 gap-4 text-[11px] md:grid-cols-4">
              {/* Reviewed By (Admin & HR Lead) */}
              <div className="space-y-1.5 rounded border border-slate-400 bg-slate-50/50 p-2.5">
                <span className="block border-b border-slate-300 pb-1 text-[10px] font-bold text-slate-600 uppercase">
                  REVIEWED BY:
                </span>
                {requisition.reviewed_at ? (
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">
                      {requisition.reviewer_profile?.full_name || "Admin & HR Lead"}
                    </p>
                    <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> Reviewed
                    </p>
                    <p className="font-mono text-[9px] text-slate-400">
                      {new Date(requisition.reviewed_at).toLocaleDateString("en-GB")}
                    </p>
                    {requisition.reviewed_comments && (
                      <p className="text-[9px] text-slate-500 italic">&quot;{requisition.reviewed_comments}&quot;</p>
                    )}
                  </div>
                ) : (
                  <p className="py-2 text-[10px] text-slate-400 italic">Pending Review</p>
                )}
              </div>

              {/* Authorized By (Corporate Services Lead) */}
              <div className="space-y-1.5 rounded border border-slate-400 bg-slate-50/50 p-2.5">
                <span className="block border-b border-slate-300 pb-1 text-[10px] font-bold text-slate-600 uppercase">
                  AUTHORIZED BY:
                </span>
                {requisition.authorized_at ? (
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">
                      {requisition.authorizer_profile?.full_name || "HCS Lead"}
                    </p>
                    <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> Authorized
                    </p>
                    <p className="font-mono text-[9px] text-slate-400">
                      {new Date(requisition.authorized_at).toLocaleDateString("en-GB")}
                    </p>
                    {requisition.authorized_comments && (
                      <p className="text-[9px] text-slate-500 italic">&quot;{requisition.authorized_comments}&quot;</p>
                    )}
                  </div>
                ) : (
                  <p className="py-2 text-[10px] text-slate-400 italic">Pending Authorization</p>
                )}
              </div>

              {/* Verified By (Accounts Lead) */}
              <div className="space-y-1.5 rounded border border-slate-400 bg-slate-50/50 p-2.5">
                <span className="block border-b border-slate-300 pb-1 text-[10px] font-bold text-slate-600 uppercase">
                  VERIFIED BY:
                </span>
                {requisition.verified_at ? (
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">
                      {requisition.verifier_profile?.full_name || "Accounts Lead"}
                    </p>
                    <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> Verified
                    </p>
                    <p className="font-mono text-[9px] text-slate-400">
                      {new Date(requisition.verified_at).toLocaleDateString("en-GB")}
                    </p>
                    {requisition.verified_comments && (
                      <p className="text-[9px] text-slate-500 italic">&quot;{requisition.verified_comments}&quot;</p>
                    )}
                  </div>
                ) : (
                  <p className="py-2 text-[10px] text-slate-400 italic">Pending Verification</p>
                )}
              </div>

              {/* Approved By (Executive Management / MD) */}
              <div className="space-y-1.5 rounded border border-slate-400 bg-slate-50/50 p-2.5">
                <span className="block border-b border-slate-300 pb-1 text-[10px] font-bold text-slate-600 uppercase">
                  APPROVED BY:
                </span>
                {requisition.approved_at ? (
                  <div className="space-y-1">
                    <p className="font-bold text-slate-900">
                      {requisition.approver_profile?.full_name || "Executive Management (MD)"}
                    </p>
                    <p className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                      <CheckCircle2 className="h-3 w-3" /> Approved
                    </p>
                    <p className="font-mono text-[9px] text-slate-400">
                      {new Date(requisition.approved_at).toLocaleDateString("en-GB")}
                    </p>
                    {requisition.approved_comments && (
                      <p className="text-[9px] text-slate-500 italic">&quot;{requisition.approved_comments}&quot;</p>
                    )}
                  </div>
                ) : (
                  <p className="py-2 text-[10px] text-slate-400 italic">Pending Executive Approval</p>
                )}
              </div>
            </div>

            <div className="pt-4 text-center text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              ATTACH RELEVANT SUPPORTING DOCUMENTS
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
