"use client"

import { useEffect, useMemo, useState } from "react"
import { Brain, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type CandidateOption = {
  company_email: string | null
}

type ReviewCycleOption = {
  id: string
  name: string
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

const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
]

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => String(i + 1))

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
  const [answers, setAnswers] = useState<Record<string, "A" | "B" | "C" | "D">>({})
  const [form, setForm] = useState({
    last_name: "",
    company_email: "",
    review_cycle_id: "",
    dob_day: "",
    dob_month: "",
    dob_year: "",
  })

  const selectedCycleName = useMemo(() => {
    return cycles.find((c) => c.id === form.review_cycle_id)?.name || "Selected Cycle"
  }, [cycles, form.review_cycle_id])

  useEffect(() => {
    const loadOptions = async () => {
      setLoadingOptions(true)
      try {
        const response = await fetch("/api/hr/performance/cbt/session", { cache: "no-store" })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || "Failed to load CBT candidates")
        setCandidateOptions(payload.data?.candidates || [])
        setCycles(payload.data?.cycles || [])
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
    } catch (e) {
      console.error("Failed to load saved CBT state:", e)
    }
  }, [session])

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
  const answeredCount = useMemo(
    () => (session ? session.questions.filter((question) => Boolean(answers[question.id])).length : 0),
    [answers, session]
  )

  const startSession = async () => {
    setStarting(true)
    try {
      const response = await fetch("/api/hr/performance/cbt/session", {
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

  const submitSession = async () => {
    if (!session) return
    setSubmitting(true)
    try {
      const response = await fetch("/api/hr/performance/cbt/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attempt_id: session.attempt_id,
          answers,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Failed to submit CBT")
      setResult(payload.data)
      setSession(null)
      try {
        localStorage.removeItem("acob_cbt_state")
      } catch (e) {}
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit CBT")
    } finally {
      setSubmitting(false)
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
                  last_name: "",
                  company_email: "",
                  review_cycle_id: "",
                  dob_day: "",
                  dob_month: "",
                  dob_year: "",
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
                    last_name: "",
                    company_email: "",
                    review_cycle_id: "",
                    dob_day: "",
                    dob_month: "",
                    dob_year: "",
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
      <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
        <div className="animate-in fade-in zoom-in w-full max-w-4xl space-y-6 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm tracking-wider text-slate-300 uppercase">
                ACOB CBT Assessment — {selectedCycleName} —{" "}
                {selectedQuestion.is_bonus ? "Bonus" : selectedQuestion.department || "General"}
              </p>
              <h1 className="mt-2 text-3xl font-semibold">{session.candidate.first_name}, keep going</h1>
            </div>
            <div className="rounded-full border border-white/10 bg-neutral-900 px-4 py-2 text-sm">
              {answeredCountToShow} / {totalQuestionsToShow} answered
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

  const isFormValid =
    form.last_name &&
    form.company_email &&
    form.review_cycle_id &&
    form.dob_day &&
    form.dob_month &&
    /^\d{4}$/.test(form.dob_year)

  return (
    <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <Card className="w-full max-w-2xl border-white/10 bg-neutral-950 text-white shadow-2xl">
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-neutral-900 p-3">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-3xl">CBT Verification</CardTitle>
              <CardDescription className="text-slate-300">
                Select your review cycle, email address, and verify using your last name and date of birth.
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
              <Label htmlFor="last_name">Last Name</Label>
              <Input
                id="last_name"
                value={form.last_name}
                onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))}
                className="h-10 border-white/10 bg-white/5 text-white"
                placeholder="Enter last name"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Date of Birth</Label>
            <div className="grid grid-cols-3 gap-3">
              <Select
                value={form.dob_day}
                onValueChange={(value) => setForm((current) => ({ ...current, dob_day: value }))}
              >
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue placeholder="Day (DD)" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((day) => (
                    <SelectItem key={day} value={day}>
                      {day.padStart(2, "0")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={form.dob_month}
                onValueChange={(value) => setForm((current) => ({ ...current, dob_month: value }))}
              >
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                id="dob_year"
                type="password"
                maxLength={4}
                value={form.dob_year}
                onChange={(event) =>
                  setForm((current) => ({ ...current, dob_year: event.target.value.replace(/\D/g, "") }))
                }
                placeholder="Year (YYYY)"
                className="h-10 border-white/10 bg-white/5 text-white"
              />
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
