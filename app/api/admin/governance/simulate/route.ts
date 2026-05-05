import { NextResponse } from "next/server"
import { createGovernanceClient, requireGovernanceActor } from "@/lib/governance/auth"
import { simulateApprovalChain, simulatePathAccess } from "@/lib/governance/resolver"
import { isGovernanceSetupMissing } from "@/lib/governance/errors"
import type { ModuleCode } from "@/types/governance"
import type { UserRole } from "@/types/database"

export async function POST(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "read")
    if (actor instanceof NextResponse) return actor

    const payload = await request.json()

    if (payload.mode === "approval") {
      const data = await simulateApprovalChain(
        admin as any,
        payload.module_code as ModuleCode,
        payload.requester_kind,
        payload.department ?? null
      )
      return NextResponse.json({ data })
    }

    if (payload.mode === "path") {
      const data = await simulatePathAccess(
        admin as any,
        payload.role as UserRole,
        payload.path,
        payload.method ?? "GET"
      )
      return NextResponse.json({ data })
    }

    return NextResponse.json({ error: "Unsupported simulation mode" }, { status: 400 })
  } catch (error) {
    if (isGovernanceSetupMissing(error)) {
      return NextResponse.json(
        {
          data: null,
          warning:
            "Governance schema is not available in this database yet. Apply migration: 20260429110000_unified_approval_governance.sql",
        },
        { status: 200 }
      )
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
