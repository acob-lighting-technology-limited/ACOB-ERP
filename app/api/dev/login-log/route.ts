import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { writeLoginLog, type LoginAuthMethod } from "@/lib/auth/login-log"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const DevLoginLogSchema = z.object({
  authMethod: z.enum(["otp", "password"]).optional(),
})

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`dev-login-log:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  let authMethod: LoginAuthMethod = "password"
  try {
    const body = await request.json()
    const parsed = DevLoginLogSchema.safeParse(body)
    if (parsed.success && parsed.data.authMethod) {
      authMethod = parsed.data.authMethod
    }
  } catch {
    // Body is optional for this endpoint.
  }

  // writeLoginLog is fail-open and logs its own failures.
  await writeLoginLog({
    supabase,
    headers: request.headers,
    userId: user.id,
    authMethod,
    source: "auth_login",
    userEmail: user.email,
  })

  return NextResponse.json({ ok: true })
}
