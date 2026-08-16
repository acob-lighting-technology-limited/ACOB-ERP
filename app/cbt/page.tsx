"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Brain, ChevronLeft, ChevronRight, AlertCircle, Clock, Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [answers, setAnswers] = useState<Record<string, "A" | "B" | "C" | "D">>({})
  const [form, setForm] = useState({
    company_email: "",
    review_cycle_id: "",
    password: "",
  })

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
      <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
        <Card className="w-full max-w-xl border-white/10 bg-neutral-950 text-white shadow-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">CBT Submitted</CardTitle>
            <CardDescription className="text-slate-300">
              Your score has been recorded for the performance cycle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-center">
            <div className="text-6xl font-semibold">{result.score}%</div>
            <p className="text-slate-300">
              You answered {result.correct_answers} out of {result.total_questions} questions correctly.
            </p>
            <Button
              onClick={() => {
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
              }}
            >
              Start Another Session
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (session && !testStarted) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
        <Card className="animate-in fade-in zoom-in w-full max-w-2xl border-white/10 bg-neutral-950 text-white shadow-2xl duration-300">
          <CardHeader className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-white/10 bg-neutral-900 p-3">
                <Brain className="h-6 w-6 animate-pulse text-white" />
              </div>
              <div>
                <CardTitle className="text-3xl">CBT Instructions</CardTitle>
                <CardDescription className="text-slate-300">
                  Please review the guidelines below before beginning your test.
                </CardDescription>
              </div>
            </div>
            {session.is_completed && (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-slate-300">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <div>
                  <p className="font-semibold text-white">Assessment Completed</p>
                  <p className="mt-0.5">You have already completed and submitted your test for this review cycle.</p>
                </div>
              </div>
            )}
            {session.is_resume && !session.is_completed && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-slate-300">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="font-semibold text-white">Active Session Detected</p>
                  <p className="mt-0.5">
                    You have an active test session in progress. You can resume your test starting from where you
                    stopped.
                  </p>
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-5">
              <h3 className="text-base font-semibold text-white">Test Information</h3>
              <div className="grid gap-3 text-sm text-slate-300">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span>Candidate Name</span>
                  <span className="font-medium text-white">{session.candidate.full_name}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span>Candidate Department</span>
                  <span className="font-medium text-white">{session.candidate.department}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span>Review Cycle</span>
                  <span className="font-medium text-white">{selectedCycleName}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span>Total Questions</span>
                  <span className="font-medium text-white">{session.questions.length}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span>{resumeTimeLeftSeconds !== null ? "Time Remaining" : "Total Time Allowed"}</span>
                  <span className="font-mono font-medium text-amber-400">
                    {resumeTimeLeftSeconds !== null
                      ? formatTimeLeft(resumeTimeLeftSeconds)
                      : `${((session.cbt_settings?.total_time_seconds ?? session.questions.length * 45) / 60)
                          .toFixed(1)
                          .replace(/\.0$/, "")} mins (overall timer)`}
                  </span>
                </div>
                {session.is_completed ? (
                  <>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span>Format</span>
                      <span className="font-medium text-white">Single-selection objective test</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Session Status</span>
                      <span className="font-medium text-emerald-400">Completed</span>
                    </div>
                  </>
                ) : !session.is_resume ? (
                  <div className="flex justify-between">
                    <span>Format</span>
                    <span className="font-medium text-white">Single-selection objective test</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span>Format</span>
                      <span className="font-medium text-white">Single-selection objective test</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span>Session Status</span>
                      <span className="font-medium text-amber-400">In Progress (Resuming)</span>
                    </div>
                    <div className="flex justify-between border-b border-white/5 pb-2">
                      <span>Resume Point</span>
                      <span className="font-medium text-white">Question {currentIndex + 1}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Answers Saved</span>
                      <span className="font-medium text-white">
                        {answeredCount} of {session.questions.length}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {!session.is_resume && !session.is_completed && (
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-white">Guidelines</h3>
                <ul className="list-disc space-y-2.5 pl-5 text-sm text-slate-300">
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
      <main className="relative flex min-h-screen items-center justify-center bg-black p-6 text-white">
        {submitting && (
          <div className="animate-in fade-in absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm duration-150">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-sm font-medium text-slate-200">Submitting your test…</p>
          </div>
        )}
        <div className="animate-in fade-in zoom-in w-full max-w-4xl space-y-6 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm tracking-wider text-slate-300 uppercase">
                ACOB CBT Assessment — {selectedCycleName} —{" "}
                {selectedQuestion.is_bonus ? "Bonus" : selectedQuestion.department || "General"}
              </p>
              <h1 className="mt-2 text-3xl font-semibold">{session.candidate.first_name}, keep going</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 font-mono text-sm font-semibold text-amber-400">
                <Clock className="h-4 w-4 animate-pulse text-amber-400" />
                <span>
                  {formatTimeLeft(
                    timeLeftSeconds ?? session.cbt_settings?.total_time_seconds ?? session.questions.length * 45
                  )}
                </span>
              </div>
              <div className="rounded-full border border-white/10 bg-neutral-900 px-4 py-2 text-sm">
                {answeredCountToShow} / {totalQuestionsToShow} answered
              </div>
              {tabSwitchCount > 0 && (
                <div className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  <span>
                    {tabSwitchCount} tab {tabSwitchCount === 1 ? "switch" : "switches"} recorded
                  </span>
                </div>
              )}
            </div>
          </div>

          <Card className="border-white/10 bg-neutral-950 text-white shadow-2xl">
            <CardHeader>
              <CardTitle className="text-xl">
                Question {currentIndex + 1} of {totalQuestionsToShow}
              </CardTitle>
              <CardDescription className="text-slate-300">{selectedQuestion.prompt}</CardDescription>
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
                          ? "border-white bg-neutral-900"
                          : "border-white/10 bg-neutral-950 hover:bg-neutral-900"
                      }`}
                    >
                      <div
                        className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                          isSelected ? "border-white bg-white text-black" : "border-slate-500 text-slate-300"
                        }`}
                      >
                        {optionKey}
                      </div>
                      <div className="mt-0.5 flex-1">
                        <p className="text-sm text-slate-100">{selectedQuestion.options[optionKey]}</p>
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
    <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <Card className="w-full max-w-2xl border-white/10 bg-neutral-950 text-white shadow-2xl">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-neutral-900 p-3">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-3xl">CBT Login Verification</CardTitle>
              <CardDescription className="text-slate-300">
                Select your review cycle, email address, and enter your password to start the assessment.
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
              <SelectTrigger id="review_cycle_id" className="border-white/10 bg-white/5 text-white">
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
                <SelectTrigger id="company_email" className="border-white/10 bg-white/5 text-white">
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
                  className="h-10 border-white/10 bg-white/5 pr-10 text-white"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 transition hover:text-white"
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
            Start CBT
          </Button>

          <p className="text-center text-sm text-slate-400">
            The CBT runs one question at a time and your final submission updates your CBT score automatically.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
