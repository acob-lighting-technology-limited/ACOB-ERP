"use client"

import { useEffect, useMemo, useState } from "react"
import { Brain, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type CandidateOption = {
  first_name: string | null
  company_email: string | null
  employee_number: string | null
}

type Question = {
  id: string
  prompt: string
  options: Record<"A" | "B" | "C" | "D", string>
}

type SessionData = {
  attempt_id: string
  candidate: {
    first_name: string | null
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
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [session, setSession] = useState<SessionData | null>(null)
  const [result, setResult] = useState<ResultData | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, "A" | "B" | "C" | "D">>({})
  const [form, setForm] = useState({
    first_name: "",
    company_email: "",
    employee_number: "",
  })

  useEffect(() => {
    const loadOptions = async () => {
      setLoadingOptions(true)
      try {
        const response = await fetch("/api/hr/performance/cbt/session", { cache: "no-store" })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || "Failed to load CBT candidates")
        setCandidateOptions(payload.data || [])
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load CBT candidates")
      } finally {
        setLoadingOptions(false)
      }
    }

    void loadOptions()
  }, [])

  const selectedQuestion = session?.questions[currentIndex] || null
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
              Your score has been recorded for the current performance cycle.
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
                setForm({ first_name: "", company_email: "", employee_number: "" })
              }}
            >
              Start Another Session
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (session && selectedQuestion) {
    return (
      <main className="min-h-screen bg-black p-6 text-white">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm tracking-[0.3em] text-slate-300 uppercase">Standalone CBT</p>
              <h1 className="mt-2 text-3xl font-semibold">{session.candidate.first_name}, keep going</h1>
            </div>
            <div className="rounded-full border border-white/10 bg-neutral-900 px-4 py-2 text-sm">
              {answeredCount} / {session.questions.length} answered
            </div>
          </div>

          <Card className="border-white/10 bg-neutral-950 text-white shadow-2xl">
            <CardHeader>
              <CardTitle className="text-xl">
                Question {currentIndex + 1} of {session.questions.length}
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
                      <div>
                        <p className="text-sm font-medium text-slate-300">Option {optionKey}</p>
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
                    disabled={submitting || answeredCount === 0}
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
                Enter your first name, company email, and employee ID to start the objective CBT.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <ShieldCheck className="h-4 w-4 text-white" />
            Verification currently checks first name, company email, and employee ID together before the test opens.
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <Label htmlFor="first_name">First Name</Label>
              <Input
                id="first_name"
                value={form.first_name}
                onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))}
                className="border-white/10 bg-white/5 text-white"
              />
            </div>
            <div>
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
                    <SelectItem
                      key={`${option.company_email}-${option.employee_number}`}
                      value={option.company_email || ""}
                    >
                      {option.company_email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="employee_number">Employee ID</Label>
            <Input
              id="employee_number"
              value={form.employee_number}
              onChange={(event) => setForm((current) => ({ ...current, employee_number: event.target.value }))}
              className="border-white/10 bg-white/5 text-white"
            />
          </div>

          <Button
            className="w-full"
            disabled={starting || loadingOptions || !form.first_name || !form.company_email || !form.employee_number}
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
