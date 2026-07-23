"use client"

import React, { useEffect, useState, useCallback, use } from "react"
import type { Requisition } from "@/lib/requisitions/types"
import { RequisitionPdfDocument } from "../_components/requisition-pdf-document"
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [requisition, setRequisition] = useState<Requisition | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)

  const fetchDetail = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/requisitions/${id}`)
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || json.message || "Failed to load requisition")
      }

      setRequisition(json.data)
    } catch (err: any) {
      setError(err.message || "Error fetching requisition")
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const handleApprove = async (comments?: string) => {
    if (!requisition) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/requisitions/${requisition.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", comments }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || json.message || "Failed to approve stage")
      }

      await fetchDetail()
    } catch (err: any) {
      alert(err.message || "Failed to approve requisition")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async (comments?: string) => {
    if (!requisition) return
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/requisitions/${requisition.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", comments }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || json.message || "Failed to reject requisition")
      }

      await fetchDetail()
    } catch (err: any) {
      alert(err.message || "Failed to reject requisition")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        <p className="text-muted-foreground text-sm">Loading ACOB Requisition Form...</p>
      </div>
    )
  }

  if (error || !requisition) {
    return (
      <div className="bg-card mx-auto my-12 max-w-xl space-y-4 rounded-xl border p-6 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
        <h3 className="text-lg font-bold">Requisition Not Found</h3>
        <p className="text-muted-foreground text-xs">{error || "The requested requisition does not exist."}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/requisition" className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to Requisitions
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-8">
      {/* Header back button (Hidden on Print) */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" asChild className="gap-2 text-xs">
          <Link href="/requisition">
            <ArrowLeft className="h-4 w-4" /> Back to Requisitions
          </Link>
        </Button>
      </div>

      <RequisitionPdfDocument
        requisition={requisition}
        onApprove={handleApprove}
        onReject={handleReject}
        isApprover={true} // Enabled for authorized reviewers
        isSubmitting={isSubmitting}
      />
    </div>
  )
}
