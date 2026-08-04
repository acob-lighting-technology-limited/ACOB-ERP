import { NextRequest, NextResponse } from "next/server"
import { groq } from "@ai-sdk/groq"
import { streamText } from "ai"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { getAcobotSystemPrompt } from "@/lib/acobot/system-prompt"
import { buildAcobotContext } from "@/lib/acobot/context"

export const dynamic = "force-dynamic"
const log = logger("acobot")
// Flagship Llama 3.3 70B model on Groq — fast, high intelligence, 1,000 req/day free tier.
const MODEL_ID = "llama-3.3-70b-versatile"

type ChatRole = "system" | "user" | "assistant"
type ChatMessage = { role: ChatRole; content: string }

type ProfileRow = {
  first_name?: string | null
  full_name?: string | null
  role?: string | null
  department?: string | null
  is_department_lead?: boolean | null
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/** Persist one Q&A turn to acobot_logs. Best-effort — never blocks the chat. */
async function logAcobotTurn(
  supabase: SupabaseServerClient,
  row: {
    user_id: string
    email: string
    full_name: string | null
    role: string | null
    department: string | null
    question: string
    answer: string
    had_context: boolean
    ip_address: string | null
    user_agent: string | null
  }
): Promise<void> {
  try {
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { error } = await dataClient.from("acobot_logs").insert({ ...row, model: MODEL_ID })
    if (error) log.error({ err: error.message }, "failed to write acobot log")
  } catch (err) {
    log.error({ err: String(err) }, "acobot log insert threw")
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false
  const m = value as Record<string, unknown>
  return (m.role === "user" || m.role === "assistant" || m.role === "system") && typeof m.content === "string"
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth — AcoBot is staff-only.
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // 2. Rate limit per user (server-side, in addition to the client guard).
    const rl = await rateLimit(`acobot:${user.id || getClientId(request)}`, { limit: 30, windowSec: 60 })
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "You're sending messages too fast. Please wait a moment.", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": "60" } }
      )
    }

    if (!process.env.GROQ_API_KEY) {
      log.error({}, "GROQ_API_KEY is not configured")
      return NextResponse.json({ error: "ACOBot is not configured" }, { status: 500 })
    }

    // 3. Validate body.
    const body = (await request.json()) as { messages?: unknown; currentPath?: unknown }
    const currentPath = typeof body.currentPath === "string" ? body.currentPath : null
    const incoming = Array.isArray(body.messages) ? body.messages : []
    const messages: ChatMessage[] = incoming
      .filter(isChatMessage)
      // Never trust a client-supplied system prompt — we set our own below.
      .filter((m) => m.role !== "system")
    if (messages.length === 0) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 })
    }

    // 4. Who is asking — for greeting + scope hints in the system prompt.
    const { data: profileData } = await supabase
      .from("profiles")
      .select("first_name, full_name, role, department, is_department_lead")
      .eq("id", user.id)
      .maybeSingle()
    const profile = (profileData as ProfileRow | null) ?? null
    const userName = profile?.first_name || profile?.full_name || user.email?.split("@")[0] || null

    const systemPrompt = getAcobotSystemPrompt({
      userName,
      role: profile?.role,
      isDepartmentLead: Boolean(profile?.is_department_lead),
      currentPath,
    })

    // 5. Permission-aware live data for the latest user message (phases 2 & 3).
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    const finalMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages]
    let hadContext = false
    if (lastUser) {
      try {
        const context = await buildAcobotContext({
          request,
          supabase,
          userId: user.id,
          message: lastUser.content,
        })
        if (context) {
          finalMessages.push({ role: "system", content: context })
          hadContext = true
        }
      } catch (err) {
        // Graceful degradation — answer without live data rather than failing.
        log.error({ err: String(err) }, "context injection failed")
      }
    }

    // 6. Stream the answer (Groq, same model the website uses) and log the turn.
    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
    const userAgent = request.headers.get("user-agent")
    const result = await streamText({
      model: groq(MODEL_ID),
      messages: finalMessages,
      maxTokens: 1000,
      temperature: 0.6,
      onFinish: async ({ text }) => {
        if (!lastUser) return
        await logAcobotTurn(supabase, {
          user_id: user.id,
          email: user.email || "",
          full_name: profile?.full_name || userName,
          role: profile?.role ?? null,
          department: profile?.department ?? null,
          question: lastUser.content,
          answer: text,
          had_context: hadContext,
          ip_address: ipAddress,
          user_agent: userAgent,
        })
      },
    })

    return result.toDataStreamResponse()
  } catch (err) {
    log.error({ err: String(err) }, "acobot request failed")
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 })
  }
}
