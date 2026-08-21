"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Brain, ChevronLeft, ChevronRight, AlertCircle, Clock, Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { apiFetch } from "@/lib/api-client"

type CandidateOption = {
  company_email: string | null
}

type ReviewCycleOption = {
  id: string
  name: string
  status?: string | null
  /** The cycle preselected for the candidate; others remain choosable. */
  is_default?: boolean
}

type Question = {
  id: string
  prompt: string
  options: Record<"A" | "B" | "C" | "D", string>
  department?: string
  is_bonus?: boolean
}

type SessionData = {
  attempt_id: string
  is_resume?: boolean
  is_completed?: boolean
  cbt_settings?: {
    time_per_question_seconds: number
    total_questions_count: number
    total_time_seconds: number
  }
  candidate: {
    first_name: string | null
    last_name: string | null
    full_name: string | null
    department: string | null
    company_email: string | null
    employee_number: string | null
  }
  questions: Question[]
}

type ResultData = {
  score: number
  correct_answers: number
  total_questions: number
}

export default function CbtPage() {
  const [candidateOptions, setCandidateOptions] = useState<CandidateOption[]>([])
  const [cycles, setCycles] = useState<ReviewCycleOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [session, setSession] = useState<SessionData | null>(null)
  const [testStarted, setTestStarted] = useState(false)
  const [result, setResult] = useState<ResultData | null>(null)
  const [redirectCountdown, setRedirectCountdown] = useState(10)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [answers, setAnswers] = useState<Record<string, "A" | "B" | "C" | "D">>({})
  const [form, setForm] = useState({
    company_email: "",
    review_cycle_id: "",
    password: "",
  })

  const resetToStart = useCallback(() => {
    setResult(null)
    setTestStarted(false)
    try {
      localStorage.removeItem("acob_cbt_state")
    } catch (e) {}
    setForm({
      company_email: "",
      review_cycle_id: "",
      password: "",
    })
  }, [])

  useEffect(() => {
    if (!result) {
      setRedirectCountdown(10)
      return
    }

    setRedirectCountdown(10)
    const interval = setInterval(() => {
      setRedirectCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          resetToStart()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [result, resetToStart])

  const selectedCycleName = useMemo(() => {
    return cycles.find((c) => c.id === form.review_cycle_id)?.name || "Selected Cycle"
  }, [cycles, form.review_cycle_id])

  useEffect(() => {
    const loadOptions = async () => {
      setLoadingOptions(true)
      try {
        const response = await apiFetch("/api/hr/performance/cbt/session", { cache: "no-store" })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || "Failed to load CBT candidates")
        setCandidateOptions(payload.data?.candidates || [])
        const loadedCycles: ReviewCycleOption[] = payload.data?.cycles || []
        setCycles(loadedCycles)
        // Preselect the current cycle so the common case is one tap, while
        // still allowing an earlier cycle to be chosen before starting.
        const defaultCycleId: string | null = payload.data?.default_cycle_id ?? null
        if (defaultCycleId) {
          setForm((current) => (current.review_cycle_id ? current : { ...current, review_cycle_id: defaultCycleId }))
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load CBT candidates")
      } finally {
        setLoadingOptions(false)
      }
    }

    void loadOptions()
  }, [])

  const selectedQuestion = session?.questions[currentIndex] || null

  // Load saved CBT state from localStorage on session start
  useEffect(() => {
    if (!session) return

    try {
      const saved = localStorage.getItem("acob_cbt_state")
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.attempt_id === session.attempt_id) {
          if (typeof parsed.currentIndex === "number") {
            setCurrentIndex(parsed.currentIndex)
          }
          if (parsed.answers) {
            setAnswers(parsed.answers)
          }
        }
      }
      const savedTabSwitches = localStorage.getItem(`acob_cbt_tabswitch_${session.attempt_id}`)
      if (savedTabSwitches && !isNaN(Number(savedTabSwitches))) {
        tabSwitchCountRef.current = Number(savedTabSwitches)
        setTabSwitchCount(Number(savedTabSwitches))
      }
    } catch (e) {
      console.error("Failed to load saved CBT state:", e)
    }
  }, [session])

  // Track when the candidate leaves the tab (switches tab / minimizes /
  // switches app) during an active test, and warn them it's recorded and
  // visible to admins — see the "Tab Switches" column on the admin CBT page.
  const [tabSwitchCount, setTabSwitchCount] = useState(0)
  const tabSwitchCountRef = useRef(0)

  useEffect(() => {
    if (!session || !testStarted) return

    let leftWhileHidden = false

    const handleVisibilityChange = () => {
      if (document.hidden) {
        tabSwitchCountRef.current += 1
        setTabSwitchCount(tabSwitchCountRef.current)
        leftWhileHidden = true
        try {
          localStorage.setItem(`acob_cbt_tabswitch_${session.attempt_id}`, String(tabSwitchCountRef.current))
        } catch (e) {}
      } else if (leftWhileHidden) {
        leftWhileHidden = false
        toast.warning(
          `Tab switch detected (${tabSwitchCountRef.current} so far). This is recorded and visible to admins reviewing your test.`
        )
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [session, testStarted])

  // Save CBT state to localStorage on answers or currentIndex change
  useEffect(() => {
    if (!session || !testStarted) return

    try {
      localStorage.setItem(
        "acob_cbt_state",
        JSON.stringify({
          attempt_id: session.attempt_id,
          currentIndex,
          answers,
        })
      )
    } catch (e) {
      console.error("Failed to save CBT state:", e)
    }
  }, [session, currentIndex, answers, testStarted])

  // Prevent accidental tab closure or reload during the active test
  useEffect(() => {
    if (!session || !testStarted) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = "Are you sure you want to leave? Your CBT progress on this screen will be lost."
      return event.returnValue
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [session, testStarted])

  const submitSession = useCallback(async () => {
    if (!session) return
    setSubmitting(true)
    try {
      const response = await apiFetch("/api/hr/performance/cbt/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attempt_id: session.attempt_id,
          answers,
          tab_switch_count: tabSwitchCountRef.current,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to submit CBT")
      setResult(payload.data)
      setSession(null)
      try {
        localStorage.removeItem("acob_cbt_state")
        localStorage.removeItem(`acob_cbt_tabswitch_${session.attempt_id}`)
      } catch (e) {}
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit CBT")
    } finally {
      setSubmitting(false)
    }
  }, [answers, session])

  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number | null>(null)

  // Manage overall exam timer
  const autoSubmittedRef = useRef(false)

  useEffect(() => {
    if (!session || !testStarted) {
      setTimeLeftSeconds(null)
      return
    }

    const totalSeconds = session.cbt_settings?.total_time_seconds ?? session.questions.length * 45
    const storageKey = `acob_cbt_timer_${session.attempt_id}`

    // Store an absolute deadline, not a remaining-seconds snapshot. A
    // snapshot only ticks down while setInterval actually fires, and browsers
    // throttle/suspend timers in backgrounded tabs — so a snapshot model
    // effectively "pauses" the clock the moment you switch away, letting
    // someone leave the tab open for hours with no time cost. A fixed
    // deadline keeps draining in real wall-clock time regardless of
    // backgrounding, while still surviving a reload with no bonus or loss
    // (remaining is always just expiresAt - now).
    let expiresAt: number
    const storedExpiresAt = localStorage.getItem(storageKey)
    if (storedExpiresAt && !isNaN(Number(storedExpiresAt))) {
      expiresAt = Number(storedExpiresAt)
    } else {
      expiresAt = Date.now() + totalSeconds * 1000
      localStorage.setItem(storageKey, String(expiresAt))
    }

    autoSubmittedRef.current = false

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
      setTimeLeftSeconds(remaining)

      // Guarded by the ref (not clearInterval here, to dodge referencing
      // `interval` before its declaration below runs) — the effect's own
      // cleanup clears the interval once `session` is set to null on submit.
      if (remaining <= 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true
        toast.warning("Time's up! Your CBT assessment is being automatically submitted.")
        try {
          localStorage.removeItem(storageKey)
        } catch (e) {}
        void submitSession()
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [session, testStarted, submitSession])

  const formatTimeLeft = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }

  const answeredCount = useMemo(
    () => (session ? session.questions.filter((question) => Boolean(answers[question.id])).length : 0),
    [answers, session]
  )

  // Graded-only count for the pre-test instructions screen — bonus questions
  // stay invisible until the candidate actually lands on one mid-test, so
  // showing the full total here (including bonus) would tip them off early.
  const standardQuestionsCount = useMemo(
    () => (session ? session.questions.filter((q) => !q.is_bonus).length : 0),
    [session]
  )

  // On the resume screen, show what's actually left on the clock rather than
  // the full allowance — the deadline keeps counting down in real time even
  // while the candidate is away, so this reflects genuine elapsed time.
  const resumeTimeLeftSeconds = useMemo(() => {
    if (!session || !session.is_resume || session.is_completed) return null
    try {
      const storedExpiresAt = localStorage.getItem(`acob_cbt_timer_${session.attempt_id}`)
      if (!storedExpiresAt || isNaN(Number(storedExpiresAt))) return null
      return Math.max(0, Math.floor((Number(storedExpiresAt) - Date.now()) / 1000))
    } catch (e) {
      return null
    }
  }, [session])

  const startSession = async () => {
    setStarting(true)
    try {
      const response = await apiFetch("/api/hr/performance/cbt/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to start CBT")
      setSession(payload.data)
      setTestStarted(false)
      setCurrentIndex(0)
      setAnswers({})
      setResult(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start CBT")
    } finally {
      setStarting(false)
    }
  }

  if (result) {
    return (
      <main className="bg-background text-foreground relative flex min-h-screen items-center justify-center p-6">
        <div className="fixed top-4 right-4 z-40">
          <ThemeToggle />
        </div>
        <Card className="w-full max-w-xl shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">CBT Submitted</CardTitle>
            <CardDescription>Your score has been recorded for the performance cycle.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-center">
            <div className="text-primary text-6xl font-semibold">{result.score}%</div>
            <p className="text-muted-foreground">
              You answered <span className="text-foreground font-semibold">{result.correct_answers}</span> out of{" "}
              <span className="text-foreground font-semibold">{result.total_questions}</span> questions correctly.
            </p>
            <div className="flex flex-col items-center gap-3">
              <Button onClick={resetToStart}>Start Another Session ({redirectCountdown}s)</Button>
              <p className="text-muted-foreground text-xs">
                Redirecting back to start screen in{" "}
                <span className="text-foreground font-mono font-semibold">{redirectCountdown}s</span>…
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (session && !testStarted) {
    return (
      <main className="bg-background text-foreground relative flex min-h-screen items-center justify-center p-6">
        <div className="fixed top-4 right-4 z-40">
          <ThemeToggle />
        </div>
        <Card className="animate-in fade-in zoom-in w-full max-w-2xl shadow-2xl duration-300">
          <CardHeader className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="bg-muted/60 rounded-2xl border p-3">
                <Brain className="text-primary h-6 w-6 animate-pulse" />
              </div>
              <div>
                <CardTitle className="text-3xl">CBT Instructions</CardTitle>
                <CardDescription>Please review the guidelines below before beginning your test.</CardDescription>
              </div>
            </div>
            {session.is_completed && (
              <div className="text-foreground flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">Assessment Completed</p>
                  <p className="text-muted-foreground mt-0.5">
                    You have already completed and submitted your test for this review cycle.
                  </p>
                </div>
              </div>
            )}
            {session.is_resume && !session.is_completed && (
              <div className="text-foreground flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-semibold text-amber-800 dark:text-amber-300">Active Session Detected</p>
                  <p className="text-muted-foreground mt-0.5">
                    You have an active test session in progress. You can resume your test starting from where you
                    stopped.
                  </p>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted/40 space-y-3 rounded-xl border p-5">
              <h3 className="text-foreground text-base font-semibold">Test Information</h3>
              <div className="text-muted-foreground grid gap-3 text-sm">
                <div className="border-border/60 flex justify-between border-b pb-2">
                  <span>Candidate Name</span>
                  <span className="text-foreground font-medium">{session.candidate.full_name}</span>
                </div>
                <div className="border-border/60 flex justify-between border-b pb-2">
                  <span>Candidate Department</span>
                  <span className="text-foreground font-medium">{session.candidate.department}</span>
                </div>
                <div className="border-border/60 flex justify-between border-b pb-2">
                  <span>Review Cycle</span>
                  <span className="text-foreground font-medium">{selectedCycleName}</span>
                </div>
                <div className="border-border/60 flex justify-between border-b pb-2">
                  <span>Total Questions</span>
                  <span className="text-foreground font-medium">{standardQuestionsCount}</span>
                </div>
                <div className="border-border/60 flex justify-between border-b pb-2">
                  <span>{resumeTimeLeftSeconds !== null ? "Time Remaining" : "Total Time Allowed"}</span>
                  <span className="font-mono font-medium text-amber-600 dark:text-amber-400">
                    {resumeTimeLeftSeconds !== null
                      ? formatTimeLeft(resumeTimeLeftSeconds)
                      : `${((session.cbt_settings?.total_time_seconds ?? session.questions.length * 45) / 60)
                          .toFixed(1)
                          .replace(/\.0$/, "")} mins (overall timer)`}
                  </span>
                </div>
                {session.is_completed ? (
                  <>
                    <div className="border-border/60 flex justify-between border-b pb-2">
                      <span>Format</span>
                      <span className="text-foreground font-medium">Single-selection objective test</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Session Status</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">Completed</span>
                    </div>
                  </>
                ) : !session.is_resume ? (
                  <div className="flex justify-between">
                    <span>Format</span>
                    <span className="text-foreground font-medium">Single-selection objective test</span>
                  </div>
                ) : (
                  <>
                    <div className="border-border/60 flex justify-between border-b pb-2">
                      <span>Format</span>
                      <span className="text-foreground font-medium">Single-selection objective test</span>
                    </div>
                    <div className="border-border/60 flex justify-between border-b pb-2">
                      <span>Session Status</span>
                      <span className="font-medium text-amber-600 dark:text-amber-400">In Progress (Resuming)</span>
                    </div>
                    <div className="border-border/60 flex justify-between border-b pb-2">
                      <span>Resume Point</span>
                      <span className="text-foreground font-medium">Question {currentIndex + 1}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Answers Saved</span>
                      <span className="text-foreground font-medium">
                        {Math.min(answeredCount, standardQuestionsCount)} of {standardQuestionsCount}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {!session.is_resume && !session.is_completed && (
              <div className="space-y-3">
                <h3 className="text-foreground text-base font-semibold">Guidelines</h3>
                <ul className="text-muted-foreground list-disc space-y-2.5 pl-5 text-sm">
                  <li>Make sure you have a stable network connection before starting.</li>
                  <li>
                    You can navigate back and forth between questions using <strong>Previous</strong> and{" "}
                    <strong>Next</strong> buttons.
                  </li>
                  <li>Your selected answer will be saved automatically as you navigate.</li>
                  <li>Do not reload, close, or navigate away from this browser window until you submit the test.</li>
                </ul>
              </div>
            )}

            <Button
              className="mt-4 h-11 w-full text-base font-semibold"
              onClick={() => {
                if (session.is_completed) {
                  setSession(null)
                  setForm({
                    company_email: "",
                    review_cycle_id: "",
                    password: "",
                  })
                } else {
                  setTestStarted(true)
                }
              }}
            >
              {session.is_completed ? "Back to CBT" : session.is_resume ? "Resume" : "Start Test"}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (session && testStarted && selectedQuestion) {
    const standardQuestions = session.questions.filter((q) => !q.is_bonus)
    const isCurrentBonus = selectedQuestion.is_bonus
    const totalQuestionsToShow = isCurrentBonus ? session.questions.length : standardQuestions.length
    const answeredCountToShow = isCurrentBonus
      ? answeredCount
      : standardQuestions.filter((q) => Boolean(answers[q.id])).length

    return (
      <main className="bg-background text-foreground relative flex min-h-screen items-center justify-center p-6">
        <div className="fixed top-4 right-4 z-40">
          <ThemeToggle />
        </div>
        {submitting && (
          <div className="animate-in fade-in bg-background/80 absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 backdrop-blur-sm duration-150">
            <div className="border-primary/20 border-t-primary h-8 w-8 animate-spin rounded-full border-2" />
            <p className="text-foreground text-sm font-medium">Submitting your test…</p>
          </div>
        )}
        <div className="animate-in fade-in zoom-in w-full max-w-4xl space-y-6 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-muted-foreground text-sm tracking-wider uppercase">
                ACOB CBT Assessment — {selectedCycleName} —{" "}
                {selectedQuestion.is_bonus ? "Bonus" : selectedQuestion.department || "General"}
              </p>
              <h1 className="text-foreground mt-2 text-3xl font-semibold">
                {session.candidate.first_name}, keep going
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">
                <Clock className="h-4 w-4 animate-pulse text-amber-600 dark:text-amber-400" />
                <span>
                  {formatTimeLeft(
                    timeLeftSeconds ?? session.cbt_settings?.total_time_seconds ?? session.questions.length * 45
                  )}
                </span>
              </div>
              <div className="bg-muted/60 text-muted-foreground rounded-full border px-4 py-2 text-sm">
                <span className="text-foreground font-medium">{answeredCountToShow}</span> / {totalQuestionsToShow}{" "}
                answered
              </div>
              {tabSwitchCount > 0 && (
                <div className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  <span>
                    {tabSwitchCount} tab {tabSwitchCount === 1 ? "switch" : "switches"} recorded
                  </span>
                </div>
              )}
            </div>
          </div>

          <Card className="shadow-2xl">
            <CardHeader>
              <CardTitle className="text-xl">
                Question {currentIndex + 1} of {totalQuestionsToShow}
              </CardTitle>
              <CardDescription className="text-foreground text-base leading-relaxed font-normal">
                {selectedQuestion.prompt}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                {(["A", "B", "C", "D"] as const).map((optionKey) => {
                  const isSelected = answers[selectedQuestion.id] === optionKey

                  return (
                    <button
                      key={optionKey}
                      type="button"
                      onClick={() => setAnswers((current) => ({ ...current, [selectedQuestion.id]: optionKey }))}
                      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
                        isSelected
                          ? "border-primary bg-primary/10 text-foreground ring-primary ring-1"
                          : "border-border bg-card text-foreground hover:bg-muted/60"
                      }`}
                    >
                      <div
                        className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/40 bg-muted/50 text-muted-foreground"
                        }`}
                      >
                        {optionKey}
                      </div>
                      <div className="mt-0.5 flex-1">
                        <p className="text-sm">{selectedQuestion.options[optionKey]}</p>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={() => setCurrentIndex((current) => Math.max(current - 1, 0))}
                  disabled={currentIndex === 0}
                >
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Previous
                </Button>

                {currentIndex === session.questions.length - 1 ? (
                  <Button
                    onClick={() => void submitSession()}
                    disabled={submitting || answeredCount < session.questions.length}
                    loading={submitting}
                  >
                    Submit CBT
                  </Button>
                ) : (
                  <Button
                    onClick={() => setCurrentIndex((current) => Math.min(current + 1, session.questions.length - 1))}
                  >
                    Next
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  const isFormValid = Boolean(form.company_email && form.review_cycle_id && form.password)

  return (
    <main className="bg-background text-foreground relative flex min-h-screen items-center justify-center p-6">
      <div className="fixed top-4 right-4 z-40">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-2xl shadow-2xl">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="bg-muted/60 rounded-2xl border p-3">
              <Brain className="text-primary h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-3xl">CBT Login Verification</CardTitle>
              <CardDescription>
                Select your review cycle, email address, and enter your password to proceed to the instructions.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="review_cycle_id">Review Cycle</Label>
            <Select
              value={form.review_cycle_id}
              onValueChange={(value) => setForm((current) => ({ ...current, review_cycle_id: value }))}
            >
              <SelectTrigger id="review_cycle_id">
                <SelectValue placeholder={loadingOptions ? "Loading cycles..." : "Select review cycle"} />
              </SelectTrigger>
              <SelectContent>
                {cycles.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.status && c.status !== "active" ? " (past)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="company_email">Company Email</Label>
              <Select
                value={form.company_email}
                onValueChange={(value) => setForm((current) => ({ ...current, company_email: value }))}
              >
                <SelectTrigger id="company_email">
                  <SelectValue placeholder={loadingOptions ? "Loading emails..." : "Select your email"} />
                </SelectTrigger>
                <SelectContent>
                  {candidateOptions.map((option) => (
                    <SelectItem key={option.company_email || ""} value={option.company_email || ""}>
                      {option.company_email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  className="h-10 pr-10"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={starting || loadingOptions || !isFormValid}
            onClick={() => void startSession()}
            loading={starting}
          >
            Continue to Instructions
          </Button>

          <p className="text-muted-foreground text-center text-xs">
            Your exam timer will not start until you review the instructions on the next screen and click Start Test.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
