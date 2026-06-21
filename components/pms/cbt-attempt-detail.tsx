"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { CheckCircle2, XCircle, AlertCircle, Loader2, Info } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatWATDateTime } from "@/lib/utils/date"

interface CbtAttemptDetailProps {
  profileId: string
  reviewCycleId: string
}

type Question = {
  id: string
  prompt: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_option: "A" | "B" | "C" | "D"
  explanation?: string | null
}

type Attempt = {
  id: string
  question_ids: string[]
  answers: Record<string, "A" | "B" | "C" | "D"> | null
  score: number
  correct_answers: number
  total_questions: number
  submitted_at: string | null
}

export function CbtAttemptDetail({ profileId, reviewCycleId }: CbtAttemptDetailProps) {
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadDetail() {
      setIsLoading(true)
      setError(null)
      try {
        const supabase = createClient()

        // 1. Fetch attempt
        const { data: attemptData, error: attemptErr } = await supabase
          .from("cbt_attempts")
          .select("id, question_ids, answers, score, correct_answers, total_questions, submitted_at")
          .eq("profile_id", profileId)
          .eq("review_cycle_id", reviewCycleId)
          .eq("status", "submitted")
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (attemptErr) throw attemptErr
        if (!attemptData) {
          if (isMounted) {
            setAttempt(null)
            setIsLoading(false)
          }
          return
        }

        const typedAttempt = attemptData as unknown as Attempt

        // 2. Fetch questions
        if (typedAttempt.question_ids && typedAttempt.question_ids.length > 0) {
          const { data: questionsData, error: questionsErr } = await supabase
            .from("cbt_questions")
            .select("id, prompt, option_a, option_b, option_c, option_d, correct_option, explanation")
            .in("id", typedAttempt.question_ids)

          if (questionsErr) throw questionsErr

          const rawQuestions = (questionsData || []) as unknown as Question[]

          // Order questions according to attempt.question_ids
          const orderedQuestions = typedAttempt.question_ids
            .map((qId) => rawQuestions.find((q) => q.id === qId))
            .filter((q): q is Question => !!q)

          if (isMounted) {
            setAttempt(typedAttempt)
            setQuestions(orderedQuestions)
          }
        } else {
          if (isMounted) {
            setAttempt(typedAttempt)
            setQuestions([])
          }
        }
      } catch (err) {
        console.error("Error loading CBT attempt details:", err)
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to load CBT details")
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadDetail()

    return () => {
      isMounted = false
    }
  }, [profileId, reviewCycleId])

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading CBT detailed response...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border-destructive/20 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border p-4 text-sm">
        <AlertCircle className="h-4 w-4" />
        <span>{error}</span>
      </div>
    )
  }

  if (!attempt) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm italic">
        No completed CBT attempt details found for this cycle.
      </div>
    )
  }

  return (
    <div className="bg-muted/20 space-y-6 rounded-lg border p-4 sm:p-6">
      {/* Summary Row */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h4 className="text-foreground text-sm font-semibold">CBT Performance Summary</h4>
          {attempt.submitted_at && (
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              Completed at: {formatWATDateTime(attempt.submitted_at)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-muted-foreground block text-xs">Score</span>
            <span className="text-foreground text-lg font-bold">{attempt.score}%</span>
          </div>
          <div className="bg-border h-8 w-[1px]" />
          <div className="text-right">
            <span className="text-muted-foreground block text-xs">Correct</span>
            <span className="text-foreground text-lg font-semibold">
              {attempt.correct_answers} / {attempt.total_questions}
            </span>
          </div>
        </div>
      </div>

      {/* Questions List */}
      <div className="space-y-4">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">Detailed Responses</p>

        {questions.length === 0 ? (
          <p className="text-muted-foreground text-xs italic">No questions found for this attempt.</p>
        ) : (
          <div className="space-y-4">
            {questions.map((question, idx) => {
              const chosen = attempt.answers?.[question.id] || null
              const correct = question.correct_option
              const isCorrect = chosen === correct

              const getOptionStyle = (optionLetter: "A" | "B" | "C" | "D") => {
                const baseClass = "flex items-start gap-2 rounded-lg border p-2.5 text-xs transition-colors"
                if (chosen === optionLetter) {
                  return isCorrect
                    ? `${baseClass} bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400`
                    : `${baseClass} bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400`
                }
                if (correct === optionLetter) {
                  return `${baseClass} bg-emerald-500/5 text-emerald-700 border-emerald-500/20 dark:text-emerald-400 border-dashed`
                }
                return `${baseClass} bg-background text-foreground border-border`
              }

              return (
                <div key={question.id} className="bg-card space-y-3 rounded-xl border p-4 shadow-sm">
                  {/* Question Prompt */}
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground bg-muted flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 text-xs font-semibold">
                      {idx + 1}
                    </span>
                    <p className="text-foreground flex-1 text-sm leading-relaxed font-medium">{question.prompt}</p>
                    <div>
                      {chosen ? (
                        isCorrect ? (
                          <Badge
                            variant="outline"
                            className="gap-1 border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-500"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Correct
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="gap-1 border-red-500/20 bg-red-500/10 text-[10px] text-red-500"
                          >
                            <XCircle className="h-3 w-3" /> Incorrect
                          </Badge>
                        )
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-500"
                        >
                          Unanswered
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Options */}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(["A", "B", "C", "D"] as const).map((letter) => {
                      const optionText =
                        letter === "A"
                          ? question.option_a
                          : letter === "B"
                            ? question.option_b
                            : letter === "C"
                              ? question.option_c
                              : question.option_d

                      return (
                        <div key={letter} className={getOptionStyle(letter)}>
                          <span className="min-w-[16px] font-bold uppercase">{letter}.</span>
                          <span className="flex-1">{optionText}</span>
                        </div>
                      )
                    })}
                  </div>

                  {/* Explanation */}
                  {question.explanation && (
                    <div className="bg-muted/50 flex items-start gap-2 rounded-lg border p-3 text-xs">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                      <div className="space-y-0.5">
                        <span className="text-foreground font-semibold">Explanation:</span>
                        <p className="text-muted-foreground leading-relaxed">{question.explanation}</p>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
