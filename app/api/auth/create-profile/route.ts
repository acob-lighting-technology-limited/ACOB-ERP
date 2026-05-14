import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("auth-create-profile")

export async function POST(_request: Request) {
  const rl = await rateLimit(`auth-create-profile:${getClientId(_request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { data: existingProfile } = await supabase.from("profiles").select("id").eq("id", user.id).single()

    if (existingProfile) {
      return NextResponse.json({ message: "Profile already exists" }, { status: 200 })
    }

    const { error: insertError } = await supabase.from("profiles").insert({
      id: user.id,
      company_email: user.email,
      first_name: "",
      last_name: "",
      other_names: "",
      department: "",
      designation: "",
      phone_number: "",
      additional_phone: "",
      residential_address: "",
      office_location: "",
    })

    if (insertError) {
      log.error({ err: String(insertError) }, "[v0] Profile creation error:")
      return NextResponse.json({ error: insertError.message }, { status: 400 })
    }

    return NextResponse.json({ message: "Profile created successfully" }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "[v0] Unexpected error:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
