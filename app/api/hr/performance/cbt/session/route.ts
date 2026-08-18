import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { writeLoginLog, REAUTH_SOURCE } from "@/lib/auth/login-log"
import { getCbtSettings } from "@/lib/cbt-config"

const log = logger("hr-performance-cbt-session")

const StartSchema = z
  .object({
    company_email: z.string().trim().email("Select a valid email"),
    review_cycle_id: z.string().uuid("Please select a valid review cycle"),
    password: z.string().min(1).optional(),
    last_name: z.string().trim().min(1).optional(),
    dob_day: z.union([z.string(), z.number()]).optional(),
    dob_month: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((data, ctx) => {
    // Two verification paths: password (the primary /cbt flow) or last
    // name + date of birth (the /cbt2 fallback for candidates who don't
    // know/have a password). Exactly one must be fully supplied. profiles.
    // birthday is stored as MM-DD only (no year), so year isn't collected —
    // day + month is the full comparison.
    const hasDob = Boolean(data.last_name && data.dob_day && data.dob_month)
    if (!data.password && !hasDob) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter your password, or your last name and date of birth",
      })
    }
  })

const SubmitSchema = z.object({
  attempt_id: z.string().uuid("Attempt is required"),
  answers: z.record(z.string().uuid(), z.enum(["A", "B", "C", "D"])),
  tab_switch_count: z.number().int().min(0).optional(),
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
  cbt_details: Record<string, unknown> | null
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

    // selectableCycles is ordered newest-first (start_date desc). Default to
    // the OLDEST cycle with questions, not the newest — candidates work
    // through missed cycles in order, starting from the earliest gap.
    const defaultCycle = [...selectableCycles].reverse()[0] ?? null

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
    const { company_email, review_cycle_id, password, last_name, dob_day, dob_month } = parsed.data

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

    if (password) {
      // Authenticate candidate password against Supabase Auth
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

      if (supabaseUrl && anonKey) {
        const authClient = createAdminClient(supabaseUrl, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
          email: company_email,
          password,
        })

        if (authError) {
          return NextResponse.json(
            { error: "Incorrect password. Please enter the password associated with your company account." },
            { status: 400 }
          )
        }

        // This check lands in auth.audit_log_entries as a `login` even though the
        // candidate is only unlocking an assessment. Tag it so reconciliation
        // against the audit log doesn't read it as a missing sign-in.
        if (authData?.user) {
          await writeLoginLog({
            supabase,
            headers: request.headers,
            userId: authData.user.id,
            authMethod: "password",
            source: REAUTH_SOURCE,
            userEmail: authData.user.email,
          })
        }
      }
    } else {
      // Fallback verification for candidates who don't know/have a password
      // (the /cbt2 flow): last name + date of birth, matched against the
      // profile on file — same check the original /cbt used before password
      // auth was added.
      const isLastNameMatch =
        String(profile.last_name || "")
          .trim()
          .toLowerCase() ===
        String(last_name || "")
          .trim()
          .toLowerCase()

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

    const loadAttemptQuestions = async (questionIds: string[]): Promise<QuestionRow[]> => {
      const { data: questionsData, error: questionsError } = await supabase
        .from("cbt_questions")
        .select("id, review_cycle_id, prompt, option_a, option_b, option_c, option_d, department, is_bonus")
        .in("id", questionIds)
        .returns<QuestionRow[]>()

      if (questionsError) throw questionsError
      const questionMap = new Map((questionsData || []).map((q) => [q.id, q]))
      return questionIds.map((qId) => questionMap.get(qId)).filter((q): q is QuestionRow => !!q)
    }

    if (existingAttempt) {
      isResume = true
      sessionAttemptId = existingAttempt.id
      sessionQuestions = await loadAttemptQuestions(existingAttempt.question_ids)

      if (sessionQuestions.length === 0) {
        return NextResponse.json(
          { error: "Failed to load assigned questions for your existing session." },
          { status: 500 }
        )
      }
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
      // Load active CBT settings (questions count, per-question duration)
      const cbtSettings = await getCbtSettings(supabase)
      const targetCount = cbtSettings.total_questions_count

      // 3. Select questions based on targetCount
      if (allQuestions.length <= targetCount) {
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
        const selectedDepts = departments.slice(0, targetCount)
        const chosenQuestions: QuestionRow[] = []

        for (const dept of selectedDepts) {
          const questionsInDept = deptMap.get(dept) || []
          if (questionsInDept.length > 0) {
            const randomQ = questionsInDept[Math.floor(Math.random() * questionsInDept.length)]
            chosenQuestions.push(randomQ)
          }
        }

        if (chosenQuestions.length < targetCount) {
          const remainingPool = allQuestions.filter((q) => !chosenQuestions.some((cq) => cq.id === q.id))
          const needed = targetCount - chosenQuestions.length
          const padding = [...remainingPool].sort(() => 0.5 - Math.random()).slice(0, needed)
          chosenQuestions.push(...padding)
        }

        sessionQuestions = chosenQuestions.slice(0, targetCount)
      }

      // 4. Append targeted bonus questions if any exist
      if (bonusQuestions && bonusQuestions.length > 0) {
        sessionQuestions = [...sessionQuestions, ...bonusQuestions]
      }

      const cbt_details = {
        company_email,
        verified_by: password ? "password" : "dob",
      }

      const { data: newAttempt, error: attemptError } = await supabase
        .from("cbt_attempts")
        .insert({
          profile_id: profile.id,
          review_cycle_id,
          employee_number: "-",
          first_name_snapshot: profile.first_name || profile.last_name || "Candidate",
          company_email,
          cbt_details,
          question_ids: sessionQuestions.map((q) => q.id),
          status: "in_progress",
        })
        .select("id")
        .single<{ id: string }>()

      if (attemptError) {
        // Two logins on the same account starting this cycle at the same
        // instant can both reach this insert; the DB's unique partial index
        // (cbt_attempts_profile_cycle_in_progress_uidx) lets only one through.
        // The loser resumes the winner's attempt instead of erroring out.
        if (attemptError.code === "23505") {
          const { data: raceAttempt, error: raceError } = await supabase
            .from("cbt_attempts")
            .select("id, question_ids")
            .eq("profile_id", profile.id)
            .eq("review_cycle_id", review_cycle_id)
            .eq("status", "in_progress")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle<{ id: string; question_ids: string[] }>()

          if (raceError) throw raceError
          if (!raceAttempt) throw attemptError

          isResume = true
          sessionAttemptId = raceAttempt.id
          sessionQuestions = await loadAttemptQuestions(raceAttempt.question_ids)
        } else {
          throw attemptError
        }
      } else {
        sessionAttemptId = newAttempt.id
      }
    }

    const activeCbtSettings = await getCbtSettings(supabase)
    const effectiveQuestionCount = sessionQuestions.filter((q) => !q.is_bonus).length
    const totalTimeSeconds = effectiveQuestionCount * activeCbtSettings.time_per_question_seconds

    return NextResponse.json({
      data: {
        attempt_id: sessionAttemptId,
        is_resume: isResume,
        cbt_settings: {
          time_per_question_seconds: activeCbtSettings.time_per_question_seconds,
          total_questions_count: activeCbtSettings.total_questions_count,
          total_time_seconds: totalTimeSeconds,
        },
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
    const { attempt_id, answers, tab_switch_count } = parsed.data

    const { data: attempt, error: attemptError } = await supabase
      .from("cbt_attempts")
      .select("id, profile_id, review_cycle_id, status, question_ids, cbt_details")
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

    // Bonus/joke questions are scored too, but kept out of `score` above —
    // they're targeted at specific candidates for fun, not part of the real
    // assessment, so they shouldn't move an actual performance evaluation.
    // Tracked in cbt_details and reviewed separately at
    // /admin/hr/pms/cbt/extra/scores.
    const bonusQuestionIds = (questions || []).filter((q) => q.is_bonus).map((q) => q.id)
    const bonusTotalQuestions = bonusQuestionIds.length
    const bonusCorrectAnswers = bonusQuestionIds.reduce((count, questionId) => {
      return count + (answers[questionId] && answers[questionId] === questionMap.get(questionId) ? 1 : 0)
    }, 0)
    const bonusScore =
      bonusTotalQuestions === 0 ? null : Math.round((bonusCorrectAnswers / bonusTotalQuestions) * 10000) / 100

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
        cbt_details: {
          ...(attempt.cbt_details || {}),
          tab_switch_count: tab_switch_count ?? 0,
          bonus_total_questions: bonusTotalQuestions,
          bonus_correct_answers: bonusCorrectAnswers,
          bonus_score: bonusScore,
        },
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
