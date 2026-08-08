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
  first_name: string | null
  last_name: string | null
  company_email: string | null
  birthday: string | null
  department: string | null
}

type QuestionRow = {
  id: string
  review_cycle_id?: string | null
  prompt: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_option?: "A" | "B" | "C" | "D"
  department?: string | null
  is_bonus?: boolean
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

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`hr-performance-cbt-session-get:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed)
    return NextResponse.json(
      { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
      { status: 429 }
    )
  try {
    const supabase = getServiceClient()
    const [{ data: profiles, error: profilesError }, { data: cycles, error: cyclesError }] = await Promise.all([
      supabase
        .from("profiles")
        .select("company_email")
        .not("company_email", "is", null)
        .eq("employment_status", "active")
        .order("company_email", { ascending: true }),
      // Every cycle is offered, not just the active one: a candidate may need to
      // sit an assessment for an earlier cycle. The active cycle is still the
      // default selection (default_cycle_id below).
      supabase.from("review_cycles").select("id, name, status, start_date").order("start_date", { ascending: false }),
    ])

    if (profilesError) throw profilesError
    if (cyclesError) throw cyclesError

    const allCycles = (cycles || []) as { id: string; name: string; status: string | null }[]

    // Only offer cycles that actually have questions — picking an empty one
    // yields a test with nothing in it.
    const { data: questionCycles } = await supabase
      .from("cbt_questions")
      .select("review_cycle_id")
      .eq("is_active", true)

    const cycleIdsWithQuestions = new Set(
      ((questionCycles || []) as { review_cycle_id: string | null }[])
        .map((row) => row.review_cycle_id)
        .filter((id): id is string => Boolean(id))
    )
    const selectableCycles = allCycles.filter((cycle) => cycleIdsWithQuestions.has(cycle.id))

    const defaultCycle = selectableCycles.find((cycle) => cycle.status === "active") ?? selectableCycles[0] ?? null

    return NextResponse.json({
      data: {
        candidates: (profiles || []).map((profile) => ({
          company_email: profile.company_email,
        })),
        cycles: selectableCycles.map((cycle) => ({
          id: cycle.id,
          name: cycle.name,
          status: cycle.status,
          is_default: cycle.id === defaultCycle?.id,
        })),
        default_cycle_id: defaultCycle?.id ?? null,
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

    const { data: cycle, error: cycleError } = await supabase
      .from("review_cycles")
      .select("id, status")
      .eq("id", review_cycle_id)
      .maybeSingle<CycleRow & { status: string }>()

    if (cycleError) throw cycleError
    // Candidates may sit an assessment for an earlier cycle, so status is no
    // longer a gate — the cycle only has to exist and have questions.
    if (!cycle) {
      return NextResponse.json({ error: "The selected review cycle could not be found." }, { status: 400 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, company_email, birthday, department")
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

    // 0. Check for existing submitted attempt
    const { data: submittedAttempt, error: submittedError } = await supabase
      .from("cbt_attempts")
      .select("id, question_ids")
      .eq("profile_id", profile.id)
      .eq("review_cycle_id", review_cycle_id)
      .eq("status", "submitted")
      .limit(1)
      .maybeSingle<{ id: string; question_ids: string[] }>()

    if (submittedError) throw submittedError
    if (submittedAttempt) {
      const { data: questionsData, error: questionsError } = await supabase
        .from("cbt_questions")
        .select("id, review_cycle_id, prompt, option_a, option_b, option_c, option_d, department")
        .in("id", submittedAttempt.question_ids || [])
        .returns<QuestionRow[]>()

      if (questionsError) throw questionsError

      return NextResponse.json({
        data: {
          attempt_id: submittedAttempt.id,
          is_resume: false,
          is_completed: true,
          candidate: {
            first_name: profile.first_name || profile.last_name || "",
            last_name: profile.last_name || "",
            full_name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.last_name || "",
            department: profile.department || "",
            company_email: profile.company_email,
            employee_number: "-",
          },
          questions: (questionsData || []).map((question) => ({
            id: question.id,
            prompt: question.prompt,
            department: question.department || "",
            options: {
              A: question.option_a,
              B: question.option_b,
              C: question.option_c,
              D: question.option_d,
            },
          })),
        },
      })
    }

    // 1. Check for existing in_progress attempt
    const { data: existingAttempt, error: existingAttemptError } = await supabase
      .from("cbt_attempts")
      .select("id, question_ids")
      .eq("profile_id", profile.id)
      .eq("review_cycle_id", review_cycle_id)
      .eq("status", "in_progress")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; question_ids: string[] }>()

    if (existingAttemptError) throw existingAttemptError

    let sessionAttemptId = ""
    let sessionQuestions: QuestionRow[] = []
    let isResume = false

    if (existingAttempt) {
      isResume = true
      sessionAttemptId = existingAttempt.id
      const { data: questionsData, error: questionsError } = await supabase
        .from("cbt_questions")
        .select("id, review_cycle_id, prompt, option_a, option_b, option_c, option_d, department, is_bonus")
        .in("id", existingAttempt.question_ids)
        .returns<QuestionRow[]>()

      if (questionsError) throw questionsError
      if (!questionsData || questionsData.length === 0) {
        return NextResponse.json(
          { error: "Failed to load assigned questions for your existing session." },
          { status: 500 }
        )
      }

      const questionMap = new Map(questionsData.map((q) => [q.id, q]))
      sessionQuestions = existingAttempt.question_ids
        .map((qId) => questionMap.get(qId))
        .filter((q): q is QuestionRow => !!q)
    } else {
      // 2. Fetch all active standard questions for the review cycle
      const { data: allQuestions, error: questionsError } = await supabase
        .from("cbt_questions")
        .select("id, review_cycle_id, prompt, option_a, option_b, option_c, option_d, department, is_bonus")
        .eq("review_cycle_id", review_cycle_id)
        .eq("is_active", true)
        .eq("is_bonus", false)
        .returns<QuestionRow[]>()

      if (questionsError) throw questionsError
      if (!allQuestions || allQuestions.length === 0) {
        return NextResponse.json(
          { error: "No CBT questions are available yet for this review cycle." },
          { status: 400 }
        )
      }

      // Query active bonus questions matching candidate's email
      const { data: bonusQuestions, error: bonusError } = await supabase
        .from("cbt_questions")
        .select("id, review_cycle_id, prompt, option_a, option_b, option_c, option_d, department, is_bonus")
        .eq("review_cycle_id", review_cycle_id)
        .eq("is_active", true)
        .eq("is_bonus", true)
        .contains("targeted_emails", [company_email])
        .returns<QuestionRow[]>()

      if (bonusError) throw bonusError

      // 3. Select 1 random question per department (up to 10), and pad to exactly 10 if fewer than 10 departments
      if (allQuestions.length <= 10) {
        sessionQuestions = [...allQuestions].sort(() => 0.5 - Math.random())
      } else {
        const deptMap = new Map<string, QuestionRow[]>()
        for (const q of allQuestions) {
          const dept = q.department || ""
          if (!deptMap.has(dept)) {
            deptMap.set(dept, [])
          }
          deptMap.get(dept)!.push(q)
        }

        const departments = Array.from(deptMap.keys()).sort(() => 0.5 - Math.random())
        const selectedDepts = departments.slice(0, 10)
        const chosenQuestions: QuestionRow[] = []

        for (const dept of selectedDepts) {
          const questionsInDept = deptMap.get(dept) || []
          if (questionsInDept.length > 0) {
            const randomQ = questionsInDept[Math.floor(Math.random() * questionsInDept.length)]
            chosenQuestions.push(randomQ)
          }
        }

        if (chosenQuestions.length < 10) {
          const remainingPool = allQuestions.filter((q) => !chosenQuestions.some((cq) => cq.id === q.id))
          const needed = 10 - chosenQuestions.length
          const padding = [...remainingPool].sort(() => 0.5 - Math.random()).slice(0, needed)
          chosenQuestions.push(...padding)
        }

        sessionQuestions = chosenQuestions.slice(0, 10)
      }

      // 4. Append targeted bonus questions if any exist
      if (bonusQuestions && bonusQuestions.length > 0) {
        sessionQuestions = [...sessionQuestions, ...bonusQuestions]
      }

      const cbt_details = {
        last_name: last_name.trim(),
        company_email,
        dob_day: dayNum,
        dob_month: monthNum,
        dob_year: Number(dob_year),
      }

      const { data: newAttempt, error: attemptError } = await supabase
        .from("cbt_attempts")
        .insert({
          profile_id: profile.id,
          review_cycle_id,
          employee_number: "-",
          first_name_snapshot: profile.first_name || profile.last_name || last_name,
          company_email,
          total_questions: sessionQuestions.length,
          question_ids: sessionQuestions.map((q) => q.id),
          cbt_details,
        })
        .select("id")
        .single<{ id: string }>()

      if (attemptError || !newAttempt) {
        return NextResponse.json({ error: attemptError?.message || "Failed to start CBT session" }, { status: 500 })
      }

      sessionAttemptId = newAttempt.id
    }

    return NextResponse.json({
      data: {
        attempt_id: sessionAttemptId,
        is_resume: isResume,
        candidate: {
          first_name: profile.first_name || profile.last_name || "",
          last_name: profile.last_name || "",
          full_name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.last_name || "",
          department: profile.department || "",
          company_email: profile.company_email,
          employee_number: "-",
        },
        questions: sessionQuestions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          department: question.department || "",
          is_bonus: question.is_bonus || false,
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
      .select("id, correct_option, is_bonus")
      .in("id", attempt.question_ids)
      .returns<Array<Pick<QuestionRow, "id" | "correct_option" | "is_bonus">>>()

    if (questionsError) throw questionsError

    const questionMap = new Map((questions || []).map((question) => [question.id, question.correct_option]))
    const gradedQuestions = (questions || []).filter((q) => !q.is_bonus)
    const gradedQuestionIds = gradedQuestions.map((q) => q.id)

    const totalQuestions = gradedQuestionIds.length
    const correctAnswers = gradedQuestionIds.reduce((count, questionId) => {
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
