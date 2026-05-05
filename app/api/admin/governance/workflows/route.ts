import { NextResponse } from "next/server"
import { createGovernanceClient, requireGovernanceActor } from "@/lib/governance/auth"
import { getWorkflows } from "@/lib/governance/resolver"
import { isGovernanceSetupMissing } from "@/lib/governance/errors"
import type { ModuleCode } from "@/types/governance"

export async function GET(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "read")
    if (actor instanceof NextResponse) return actor

    const { searchParams } = new URL(request.url)
    const moduleCode = (searchParams.get("module_code") || undefined) as ModuleCode | undefined
    const requesterKind = searchParams.get("requester_kind") || undefined

    const data = await getWorkflows(admin as any, moduleCode, requesterKind)
    return NextResponse.json({ data })
  } catch (error) {
    if (isGovernanceSetupMissing(error)) {
      return NextResponse.json(
        {
          data: [],
          warning:
            "Governance schema is not available in this database yet. Apply migration: 20260429110000_unified_approval_governance.sql",
        },
        { status: 200 }
      )
    }
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "mutate")
    if (actor instanceof NextResponse) return actor

    const payload = await request.json()

    const { data, error } = await ((admin as any).from("approval_workflows") as any)
      .insert({
        module_code: payload.module_code,
        requester_kind: payload.requester_kind,
        name: payload.name,
        description: payload.description ?? null,
        is_active: payload.is_active ?? true,
        version: payload.version ?? 1,
      })
      .select("*")
      .single()

    if (error) throw error
    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "mutate")
    if (actor instanceof NextResponse) return actor

    const payload = await request.json()
    if (!payload.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const { data, error } = await ((admin as any).from("approval_workflows") as any)
      .update({
        module_code: payload.module_code,
        requester_kind: payload.requester_kind,
        name: payload.name,
        description: payload.description ?? null,
        is_active: payload.is_active,
        version: payload.version,
      })
      .eq("id", payload.id)
      .select("*")
      .single()

    if (error) throw error
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "mutate")
    if (actor instanceof NextResponse) return actor

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const { error } = await ((admin as any).from("approval_workflows") as any).delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
