import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"

const log = logger("hr-performance-cbt-session")

const StartSchema = z.object({
  last_name: z.string().trim().min(1, "Last name is required"),
  company_email: z.string().trim().email("Select a valid email"),
  review_cycle_id: z.string().uuid("Please select a valid review cycle"),
  dob_day: z.union([z.string(), z.number()]),
  dob_month: z.union([z.string(), z.number()]),
  dob_year: z.union([z.string(), z.number()]),
})

const SubmitSchema = z.object({
  attempt_id: z.string().uuid("Attempt is required"),
  answers: z.record(z.string().uuid(), z.enum(["A", "B", "C", "D"])),
})

type ProfileRow = {
  id: string
  last_name: string | null
  company_email: string | null
  birthday: string | null
}

type QuestionRow = {
  id: string
  review_cycle_id?: string | null
  prompt: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_option: "A" | "B" | "C" | "D"
}

type AttemptRow = {
  id: string
  profile_id: string
  review_cycle_id?: string | null
  status: "in_progress" | "submitted"
  question_ids: string[]
}

type CycleRow = {
  id: string
  name: string
}

function getServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are missing")
  }

  return createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function GET() {
  try {
    const supabase = getServiceClient()
    const [{ data: profiles, error: profilesError }, { data: cycles, error: cyclesError }] = await Promise.all([
      supabase
        .from("profiles")
        .select("last_name, company_email, birthday")
        .not("company_email", "is", null)
        .eq("employment_status", "active")
        .order("company_email", { ascending: true }),
      supabase
        .from("review_cycles")
        .select("id, name")
        .eq("status", "active")
        .order("start_date", { ascending: false }),
    ])

    if (profilesError) throw profilesError
    if (cyclesError) throw cyclesError

    return NextResponse.json({
      data: {
        candidates: (profiles || []).map((profile) => ({
          last_name: profile.last_name,
          company_email: profile.company_email,
          birthday: profile.birthday,
        })),
        cycles: (cycles || []).map((cycle) => ({
          id: cycle.id,
          name: cycle.name,
        })),
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to load CBT candidate options")
    return NextResponse.json({ error: "Failed to load CBT candidate options" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-cbt-session:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const parsed = StartSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const supabase = getServiceClient()
    const { last_name, company_email, review_cycle_id, dob_day, dob_month, dob_year } = parsed.data

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, last_name, company_email, birthday")
      .eq("company_email", company_email)
      .maybeSingle<ProfileRow>()

    if (profileError) throw profileError

    if (!profile) {
      return NextResponse.json({ error: "The email address entered does not match our records." }, { status: 400 })
    }

    const isLastNameMatch =
      String(profile.last_name || "")
        .trim()
        .toLowerCase() === last_name.trim().toLowerCase()

    const dayNum = Number(dob_day)
    const monthNum = Number(dob_month)
    const enteredMMDD = `${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`
    const isDobMatch = profile.birthday === enteredMMDD

    if (!isLastNameMatch && !isDobMatch) {
      return NextResponse.json(
        { error: "The last name and date of birth entered do not match our records." },
        { status: 400 }
      )
    }

    if (!isLastNameMatch) {
      return NextResponse.json({ error: "The last name entered does not match our records." }, { status: 400 })
    }

    if (!isDobMatch) {
      return NextResponse.json({ error: "The date of birth entered does not match our records." }, { status: 400 })
    }

    const { data: questions, error: questionsError } = await supabase
      .from("cbt_questions")
      .select("id, review_cycle_id, prompt, option_a, option_b, option_c, option_d, correct_option")
      .eq("review_cycle_id", review_cycle_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(10)
      .returns<QuestionRow[]>()

    if (questionsError) throw questionsError
    if (!questions || questions.length === 0) {
      return NextResponse.json({ error: "No CBT questions are available yet for this review cycle." }, { status: 400 })
    }

    const cbt_details = {
      last_name: last_name.trim(),
      company_email,
      dob_day: dayNum,
      dob_month: monthNum,
      dob_year: Number(dob_year),
    }

    const { data: attempt, error: attemptError } = await supabase
      .from("cbt_attempts")
      .insert({
        profile_id: profile.id,
        review_cycle_id,
        employee_number: "-",
        first_name_snapshot: profile.last_name || last_name,
        company_email,
        total_questions: questions.length,
        question_ids: questions.map((question) => question.id),
        cbt_details,
      })
      .select("id")
      .single<{ id: string }>()

    if (attemptError || !attempt) {
      return NextResponse.json({ error: attemptError?.message || "Failed to start CBT session" }, { status: 500 })
    }

    return NextResponse.json({
      data: {
        attempt_id: attempt.id,
        candidate: {
          first_name: profile.last_name,
          company_email: profile.company_email,
          employee_number: "-",
        },
        questions: questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          options: {
            A: question.option_a,
            B: question.option_b,
            C: question.option_c,
            D: question.option_d,
          },
        })),
      },
    })
  } catch (error) {
    log.error({ err: JSON.stringify(error, Object.getOwnPropertyNames(error || {})) }, "Failed to start CBT session")
    return NextResponse.json({ error: "Failed to start CBT session" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-cbt-session:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const parsed = SubmitSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, { status: 400 })
    }

    const supabase = getServiceClient()
    const { attempt_id, answers } = parsed.data

    const { data: attempt, error: attemptError } = await supabase
      .from("cbt_attempts")
      .select("id, profile_id, review_cycle_id, status, question_ids")
      .eq("id", attempt_id)
      .maybeSingle<AttemptRow>()

    if (attemptError) throw attemptError
    if (!attempt || attempt.status === "submitted") {
      return NextResponse.json({ error: "This CBT attempt has already been submitted." }, { status: 400 })
    }

    const { data: questions, error: questionsError } = await supabase
      .from("cbt_questions")
      .select("id, correct_option")
      .in("id", attempt.question_ids)
      .returns<Array<Pick<QuestionRow, "id" | "correct_option">>>()

    if (questionsError) throw questionsError

    const questionMap = new Map((questions || []).map((question) => [question.id, question.correct_option]))
    const totalQuestions = attempt.question_ids.length
    const correctAnswers = attempt.question_ids.reduce((count, questionId) => {
      return count + (answers[questionId] && answers[questionId] === questionMap.get(questionId) ? 1 : 0)
    }, 0)
    const score = totalQuestions === 0 ? 0 : Math.round((correctAnswers / totalQuestions) * 10000) / 100

    const now = new Date().toISOString()
    const { error: updateAttemptError } = await supabase
      .from("cbt_attempts")
      .update({
        status: "submitted",
        answers,
        total_questions: totalQuestions,
        correct_answers: correctAnswers,
        score,
        submitted_at: now,
      })
      .eq("id", attempt.id)

    if (updateAttemptError) throw updateAttemptError

    if (attempt.review_cycle_id) {
      const { data: existingReview } = await supabase
        .from("performance_reviews")
        .select("id")
        .eq("user_id", attempt.profile_id)
        .eq("review_cycle_id", attempt.review_cycle_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>()

      if (existingReview?.id) {
        await supabase.from("performance_reviews").update({ cbt_score: score }).eq("id", existingReview.id)
      } else {
        await supabase.from("performance_reviews").insert({
          user_id: attempt.profile_id,
          reviewer_id: attempt.profile_id,
          review_cycle_id: attempt.review_cycle_id,
          review_date: now.slice(0, 10),
          status: "draft",
          cbt_score: score,
        })
      }
    }

    return NextResponse.json({
      data: {
        score,
        correct_answers: correctAnswers,
        total_questions: totalQuestions,
      },
    })
  } catch (error) {
    log.error({ err: JSON.stringify(error, Object.getOwnPropertyNames(error || {})) }, "Failed to submit CBT session")
    return NextResponse.json({ error: "Failed to submit CBT session" }, { status: 500 })
  }
}
