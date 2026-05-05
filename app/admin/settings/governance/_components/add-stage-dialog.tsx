"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { GovernanceDepartment } from "@/types/governance"
import { StageDialog, type StageFormPayload } from "./stage-dialog"

export function AddStageDialog({
  disabled,
  nextOrder,
  departments,
  onCreate,
}: {
  disabled: boolean
  nextOrder: number
  departments: GovernanceDepartment[]
  onCreate: (payload: StageFormPayload) => Promise<void>
}) {
  return (
    <StageDialog
      title="Add Stage"
      nextOrder={nextOrder}
      departments={departments}
      onSubmit={onCreate}
      trigger={
        <Button size="sm" disabled={disabled}>
          <Plus className="mr-1 h-4 w-4" /> Add Stage
        </Button>
      }
    />
  )
}
