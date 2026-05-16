import { NextRequest, NextResponse } from "next/server"
import { getClientId, rateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-attendance-admin-records:${getClientId(request)}`, { limit: 10, windowSec: 60 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  }

  return NextResponse.json(
    { error: "Manual attendance score entry is deprecated. Attendance is computed from attendance records." },
    { status: 410 }
  )
}
