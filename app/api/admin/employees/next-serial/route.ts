import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"

const log = logger("admin-employees-next-serial")

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const supabase = await createClient()

    // Check authentication
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check authorization - restrict to admins
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

    if (!profile || !["developer", "super_admin", "admin"].includes(profile.role)) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 })
    }

    // Call the database function to get the next serial
    const { data, error } = await supabase.rpc("next_employee_number")

    if (error) {
      log.error({ err: String(error) }, "Error fetching next serial:")
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ serial: data })
  } catch (error) {
    log.error({ err: String(error) }, "Internal error fetching next serial:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
