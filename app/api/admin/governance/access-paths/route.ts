import { NextResponse } from "next/server"
import { createGovernanceClient, requireGovernanceActor } from "@/lib/governance/auth"
import { getAccessPaths } from "@/lib/governance/resolver"
import { isGovernanceSetupMissing } from "@/lib/governance/errors"

export async function GET(request: Request) {
  try {
    const { supabase, admin } = await createGovernanceClient()
    const actor = await requireGovernanceActor(supabase as any, "read")
    if (actor instanceof NextResponse) return actor

    const paths = await getAccessPaths(admin as any)

    const pathIds = paths.map((p) => p.id)
    let rules: unknown[] = []
    if (pathIds.length > 0) {
      const { data, error } = await ((admin as any).from("access_path_role_rules") as any)
        .select("*")
        .in("access_path_id", pathIds)
      if (error) throw error
      rules = data || []
    }

    return NextResponse.json({ data: { paths, rules } })
  } catch (error) {
    if (isGovernanceSetupMissing(error)) {
      return NextResponse.json(
        {
          data: { paths: [], rules: [] },
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

    const { data: pathRow, error: pathError } = await ((admin as any).from("access_paths") as any)
      .insert({
        path_pattern: payload.path_pattern,
        path_kind: payload.path_kind,
        methods: payload.methods,
        description: payload.description ?? null,
        priority: payload.priority ?? 100,
        is_active: payload.is_active ?? true,
      })
      .select("*")
      .single()

    if (pathError) throw pathError

    if (Array.isArray(payload.rules) && payload.rules.length > 0) {
      const { error: rulesError } = await ((admin as any).from("access_path_role_rules") as any).insert(
        payload.rules.map((rule: { role_code: string; effect: "allow" | "deny"; is_active?: boolean }) => ({
          access_path_id: pathRow.id,
          role_code: rule.role_code,
          effect: rule.effect,
          is_active: rule.is_active ?? true,
        }))
      )
      if (rulesError) throw rulesError
    }

    return NextResponse.json({ data: pathRow }, { status: 201 })
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

    const { data, error } = await ((admin as any).from("access_paths") as any)
      .update({
        path_pattern: payload.path_pattern,
        path_kind: payload.path_kind,
        methods: payload.methods,
        description: payload.description,
        priority: payload.priority,
        is_active: payload.is_active,
      })
      .eq("id", payload.id)
      .select("*")
      .single()

    if (error) throw error

    if (Array.isArray(payload.rules)) {
      const { error: deleteError } = await ((admin as any).from("access_path_role_rules") as any)
        .delete()
        .eq("access_path_id", payload.id)
      if (deleteError) throw deleteError

      if (payload.rules.length > 0) {
        const { error: insertError } = await ((admin as any).from("access_path_role_rules") as any).insert(
          payload.rules.map((rule: { role_code: string; effect: "allow" | "deny"; is_active?: boolean }) => ({
            access_path_id: payload.id,
            role_code: rule.role_code,
            effect: rule.effect,
            is_active: rule.is_active ?? true,
          }))
        )
        if (insertError) throw insertError
      }
    }

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

    const { error } = await ((admin as any).from("access_paths") as any).delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
