"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Brain, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { formatWATDate } from "@/lib/utils/date"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { Textarea } from "@/components/ui/textarea"

type ReviewCycle = {
  id: string
  name: string
  review_type: string | null
  status?: string | null
  start_date?: string
  end_date?: string
}

type CbtQuestion = {
  id: string
  review_cycle_id?: string | null
  department?: string | null
  prompt: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_option: "A" | "B" | "C" | "D"
  explanation?: string | null
  is_active?: boolean
  created_at?: string
  is_bonus?: boolean
  targeted_emails?: string[] | null
}

const INITIAL_FORM = {
  review_cycle_id: "",
  prompt: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_option: "A" as "A" | "B" | "C" | "D",
  explanation: "",
  is_active: true,
  targeted_emails: "",
}

function formatDate(date: string | undefined) {
  if (!date) return "-"
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

function QuestionCard({
  question,
  cycleName,
  onEdit,
  onDelete,
  deletingId,
}: {
  question: CbtQuestion
  cycleName: string
  onEdit: (question: CbtQuestion) => void
  onDelete: (questionId: string) => void
  deletingId: string | null
}) {
  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold text-white">{question.prompt}</p>
          <p className="text-muted-foreground text-xs">{cycleName}</p>
          <p className="text-muted-foreground text-xs">Targeted: {question.targeted_emails?.join(", ") || "None"}</p>
          <p className="text-muted-foreground text-xs">Correct answer: Option {question.correct_option}</p>
        </div>
        <Badge variant={question.is_active === false ? "secondary" : "default"}>
          {question.is_active === false ? "Inactive" : "Active"}
        </Badge>
      </div>

      <div className="grid gap-2 text-sm text-slate-300">
        <p>
          <span className="font-medium text-white">A:</span> {question.option_a}
        </p>
        <p>
          <span className="font-medium text-white">B:</span> {question.option_b}
        </p>
        <p>
          <span className="font-medium text-white">C:</span> {question.option_c}
        </p>
        <p>
          <span className="font-medium text-white">D:</span> {question.option_d}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button size="sm" variant="outline" onClick={() => onEdit(question)}>
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => onDelete(question.id)}
          disabled={deletingId === question.id}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>
    </div>
  )
}

export default function AdminPmsCbtExtraQuestionPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [cycles, setCycles] = useState<ReviewCycle[]>([])
  const [questions, setQuestions] = useState<CbtQuestion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingQuestion, setEditingQuestion] = useState<CbtQuestion | null>(null)
  const [form, setForm] = useState(INITIAL_FORM)

  const loadPage = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [cyclesResponse, questionsResponse] = await Promise.all([
        fetch("/api/hr/performance/cycles", { cache: "no-store" }),
        fetch("/api/hr/performance/cbt/questions?is_bonus=true", { cache: "no-store" }),
      ])

      const cyclesPayload = (await cyclesResponse.json().catch(() => null)) as {
        data?: ReviewCycle[]
        error?: string
      } | null
      const questionsPayload = (await questionsResponse.json().catch(() => null)) as {
        data?: CbtQuestion[]
        error?: string
      } | null

      if (!cyclesResponse.ok) throw new Error(cyclesPayload?.error || "Failed to load review cycles")
      if (!questionsResponse.ok) throw new Error(questionsPayload?.error || "Failed to load CBT questions")

      const nextCycles = cyclesPayload?.data || []
      const nextQuestions = questionsPayload?.data || []

      setCycles(nextCycles)
      setQuestions(nextQuestions)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load CBT questions"
      setError(message)
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  // Automatically select the active cycle in the URL query params if none is selected
  useEffect(() => {
    if (cycles.length > 0 && !searchParams.get("review_cycle_id") && !searchParams.get("cycleId")) {
      const activeCycle = cycles.find((c) => c.status === "active")
      if (activeCycle) {
        router.replace(`/admin/hr/pms/cbt/extra?review_cycle_id=${encodeURIComponent(activeCycle.id)}`, {
          scroll: false,
        })
      }
    }
  }, [cycles, searchParams, router])

  const activeCycleId = useMemo(() => {
    return cycles.find((cycle) => cycle.status === "active")?.id || cycles[0]?.id || ""
  }, [cycles])

  const currentCycleId = useMemo(() => {
    return searchParams.get("review_cycle_id") || searchParams.get("cycleId") || activeCycleId
  }, [searchParams, activeCycleId])

  const cycleNameById = useMemo(() => new Map(cycles.map((cycle) => [cycle.id, cycle.name])), [cycles])
  const selectedCycle = useMemo(
    () => cycles.find((cycle) => cycle.id === currentCycleId) || null,
    [cycles, currentCycleId]
  )

  const filteredQuestions = useMemo(
    () => questions.filter((question) => !currentCycleId || question.review_cycle_id === currentCycleId),
    [questions, currentCycleId]
  )

  const activeQuestions = filteredQuestions.filter((question) => question.is_active !== false).length
  const latestQuestionDate = useMemo(() => {
    const dates = filteredQuestions
      .map((question) => question.created_at)
      .filter((value): value is string => Boolean(value))
    if (dates.length === 0) return "-"
    return formatDate([...dates].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0])
  }, [filteredQuestions])

  const cycleOptions = useMemo(() => cycles.map((cycle) => ({ value: cycle.id, label: cycle.name })), [cycles])

  const filters: DataTableFilter<CbtQuestion>[] = [
    {
      key: "review_cycle_id",
      label: "Cycle",
      options: cycleOptions,
      placeholder: "All Cycles",
      mode: "custom",
      filterFn: (row, values) => values.length === 0 || values.includes(row.review_cycle_id || ""),
    },
    {
      key: "correct_option",
      label: "Correct Answer",
      options: (["A", "B", "C", "D"] as const).map((value) => ({ value, label: `Option ${value}` })),
      placeholder: "All Answers",
    },
    {
      key: "is_active",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
      placeholder: "All Statuses",
      mode: "custom",
      filterFn: (row, values) => {
        if (values.length === 0) return true
        const status = row.is_active === false ? "inactive" : "active"
        return values.includes(status)
      },
    },
  ]

  const columns: DataTableColumn<CbtQuestion>[] = [
    {
      key: "prompt",
      label: "Question",
      sortable: true,
      accessor: (row) => row.prompt,
      render: (row) => <span className="font-medium">{row.prompt}</span>,
      resizable: true,
      initialWidth: 320,
    },
    {
      key: "targeted_emails",
      label: "Target Candidates",
      sortable: true,
      accessor: (row) => row.targeted_emails?.join(", ") || "",
      render: (row) => (
        <span className="text-muted-foreground text-xs break-all">
          {row.targeted_emails && row.targeted_emails.length > 0
            ? row.targeted_emails.join(", ")
            : "No candidates targeted"}
        </span>
      ),
      resizable: true,
      initialWidth: 260,
    },
    {
      key: "review_cycle_id",
      label: "Cycle",
      sortable: true,
      accessor: (row) => cycleNameById.get(row.review_cycle_id || "") || "Unassigned",
      render: (row) => cycleNameById.get(row.review_cycle_id || "") || "Unassigned",
      resizable: true,
      initialWidth: 200,
      hideOnMobile: true,
    },
    {
      key: "correct_option",
      label: "Correct",
      sortable: true,
      accessor: (row) => row.correct_option,
      render: (row) => <Badge variant="secondary">Option {row.correct_option}</Badge>,
      hideOnMobile: true,
    },
    {
      key: "is_active",
      label: "Status",
      sortable: true,
      accessor: (row) => (row.is_active === false ? "Inactive" : "Active"),
      render: (row) => (
        <Badge variant={row.is_active === false ? "secondary" : "default"}>
          {row.is_active === false ? "Inactive" : "Active"}
        </Badge>
      ),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      accessor: (row) => row.created_at || "",
      render: (row) => formatDate(row.created_at),
      hideOnMobile: true,
    },
  ]

  const rowActions: RowAction<CbtQuestion>[] = [
    { label: "Edit", icon: Pencil, onClick: (question) => openEditModal(question) },
    {
      label: "Delete",
      icon: Trash2,
      variant: "destructive",
      onClick: (question) => {
        void handleDelete(question.id)
      },
    },
  ]

  function resetForm(nextCycleId = currentCycleId) {
    setForm({ ...INITIAL_FORM, review_cycle_id: nextCycleId || activeCycleId })
    setEditingQuestion(null)
  }

  function openCreateModal() {
    resetForm()
    setIsModalOpen(true)
  }

  function openEditModal(question: CbtQuestion) {
    setEditingQuestion(question)
    setForm({
      review_cycle_id: question.review_cycle_id || currentCycleId,
      prompt: question.prompt,
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d,
      correct_option: question.correct_option,
      explanation: question.explanation || "",
      is_active: question.is_active !== false,
      targeted_emails: question.targeted_emails?.join(", ") || "",
    })
    setIsModalOpen(true)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)

    try {
      const endpoint = editingQuestion
        ? `/api/hr/performance/cbt/questions/${encodeURIComponent(editingQuestion.id)}`
        : "/api/hr/performance/cbt/questions"
      const method = editingQuestion ? "PATCH" : "POST"

      const parsedEmails = form.targeted_emails
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0)

      if (parsedEmails.length === 0) {
        throw new Error("At least one target email is required for bonus questions.")
      }

      const payload = {
        review_cycle_id: form.review_cycle_id,
        department: "Bonus",
        prompt: form.prompt,
        option_a: form.option_a,
        option_b: form.option_b,
        option_c: form.option_c,
        option_d: form.option_d,
        correct_option: form.correct_option,
        explanation: form.explanation || null,
        is_active: form.is_active,
        is_bonus: true,
        targeted_emails: parsedEmails,
      }

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const responsePayload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) throw new Error(responsePayload?.error || "Failed to save bonus question")

      toast.success(editingQuestion ? "Bonus question updated" : "Bonus question added")
      router.replace(`/admin/hr/pms/cbt/extra?review_cycle_id=${encodeURIComponent(form.review_cycle_id)}`, {
        scroll: false,
      })
      setIsModalOpen(false)
      resetForm(form.review_cycle_id)
      await loadPage()
    } catch (submitError) {
      toast.error(submitError instanceof Error ? submitError.message : "Failed to save bonus question")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(questionId: string) {
    setDeletingId(questionId)

    try {
      const response = await fetch(`/api/hr/performance/cbt/questions/${encodeURIComponent(questionId)}`, {
        method: "DELETE",
      })
      const responsePayload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) throw new Error(responsePayload?.error || "Failed to delete question")

      toast.success("Question deleted")
      await loadPage()
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Failed to delete question")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <DataTablePage
      title="CBT Bonus Questions Manager"
      description="Manage standalone, ungraded bonus/joke questions and specify which candidate emails can see them."
      icon={Brain}
      backLink={{ href: "/admin/hr/pms/cbt", label: "Back to PMS CBT Overview" }}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadPage()} disabled={isLoading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={openCreateModal}>
            <Plus className="h-4 w-4" />
            Add Bonus Question
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            title="Selected Cycle"
            value={selectedCycle?.name || "None"}
            icon={Brain}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            title="Bonus Questions"
            value={filteredQuestions.length}
            icon={Brain}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            title="Active"
            value={activeQuestions}
            icon={Brain}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            title="Latest Update"
            value={latestQuestionDate}
            icon={Brain}
            iconBgColor="bg-violet-500/10"
            iconColor="text-violet-500"
          />
        </div>
      }
    >
      <DataTable<CbtQuestion>
        key={isLoading ? "loading" : "ready"}
        data={filteredQuestions}
        columns={columns}
        filters={filters}
        getRowId={(question) => question.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search question text, candidate email, correct answer..."
        searchFn={(question, query) =>
          [
            cycleNameById.get(question.review_cycle_id || "") || "",
            question.prompt,
            question.targeted_emails?.join(" ") || "",
            question.correct_option,
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        }
        isLoading={isLoading}
        error={error}
        onRetry={() => void loadPage()}
        rowActions={rowActions}
        expandable={{
          render: (question) => (
            <div className="grid gap-4 text-sm md:grid-cols-2">
              <div className="space-y-2">
                <p>
                  <span className="font-medium text-white">Cycle:</span>{" "}
                  {cycleNameById.get(question.review_cycle_id || "") || "-"}
                </p>
                <p>
                  <span className="font-medium text-white">Target Candidates:</span>{" "}
                  {question.targeted_emails?.join(", ") || "-"}
                </p>
                <p>
                  <span className="font-medium text-white">Option A:</span> {question.option_a}
                </p>
                <p>
                  <span className="font-medium text-white">Option B:</span> {question.option_b}
                </p>
                <p>
                  <span className="font-medium text-white">Option C:</span> {question.option_c}
                </p>
                <p>
                  <span className="font-medium text-white">Option D:</span> {question.option_d}
                </p>
              </div>
              <div className="space-y-2">
                <p>
                  <span className="font-medium text-white">Correct Answer:</span> Option {question.correct_option}
                </p>
                <p>
                  <span className="font-medium text-white">Status:</span>{" "}
                  {question.is_active === false ? "Inactive" : "Active"}
                </p>
                <p>
                  <span className="font-medium text-white">Explanation:</span> {question.explanation || "-"}
                </p>
              </div>
            </div>
          ),
        }}
        viewToggle
        cardRenderer={(question) => (
          <QuestionCard
            question={question}
            cycleName={cycleNameById.get(question.review_cycle_id || "") || "Unassigned"}
            onEdit={openEditModal}
            onDelete={(questionId) => {
              void handleDelete(questionId)
            }}
            deletingId={deletingId}
          />
        )}
        emptyTitle="No CBT bonus questions in this cycle"
        emptyDescription="Choose a cycle and add targeted bonus questions for candidates."
        emptyIcon={Brain}
        skeletonRows={6}
        urlSync
      />

      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="max-w-2xl border-white/10 bg-neutral-950 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">
              {editingQuestion ? "Edit CBT Bonus Question" : "Add CBT Bonus Question"}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {editingQuestion
                ? "Update the selected CBT bonus question and manage targeted candidates."
                : "Add a new CBT bonus question and choose targeted candidates."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-white">Cycle</Label>
                <Select
                  value={form.review_cycle_id}
                  onValueChange={(value) => setForm((current) => ({ ...current, review_cycle_id: value }))}
                >
                  <SelectTrigger className="border-white/10 bg-neutral-900 text-white">
                    <SelectValue placeholder="Select cycle" />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-neutral-900 text-white">
                    {cycles.map((cycle) => (
                      <SelectItem key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="targeted_emails" className="text-white">
                  Target Candidate Emails
                </Label>
                <Input
                  id="targeted_emails"
                  placeholder="candidate1@example.com, candidate2@example.com"
                  value={form.targeted_emails}
                  onChange={(event) => setForm((current) => ({ ...current, targeted_emails: event.target.value }))}
                  className="border-white/10 bg-neutral-900 text-white"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt" className="text-white">
                Question
              </Label>
              <Textarea
                id="prompt"
                rows={3}
                value={form.prompt}
                onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                className="border-white/10 bg-neutral-900 text-white"
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="option_a" className="text-white">
                  Option A
                </Label>
                <Input
                  id="option_a"
                  value={form.option_a}
                  onChange={(event) => setForm((current) => ({ ...current, option_a: event.target.value }))}
                  className="border-white/10 bg-neutral-900 text-white"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="option_b" className="text-white">
                  Option B
                </Label>
                <Input
                  id="option_b"
                  value={form.option_b}
                  onChange={(event) => setForm((current) => ({ ...current, option_b: event.target.value }))}
                  className="border-white/10 bg-neutral-900 text-white"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="option_c" className="text-white">
                  Option C
                </Label>
                <Input
                  id="option_c"
                  value={form.option_c}
                  onChange={(event) => setForm((current) => ({ ...current, option_c: event.target.value }))}
                  className="border-white/10 bg-neutral-900 text-white"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="option_d" className="text-white">
                  Option D
                </Label>
                <Input
                  id="option_d"
                  value={form.option_d}
                  onChange={(event) => setForm((current) => ({ ...current, option_d: event.target.value }))}
                  className="border-white/10 bg-neutral-900 text-white"
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-white">Correct Answer</Label>
                <Select
                  value={form.correct_option}
                  onValueChange={(value: "A" | "B" | "C" | "D") =>
                    setForm((current) => ({ ...current, correct_option: value }))
                  }
                >
                  <SelectTrigger className="border-white/10 bg-neutral-900 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-neutral-900 text-white">
                    <SelectItem value="A">Option A</SelectItem>
                    <SelectItem value="B">Option B</SelectItem>
                    <SelectItem value="C">Option C</SelectItem>
                    <SelectItem value="D">Option D</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-white">Status</Label>
                <Select
                  value={form.is_active ? "active" : "inactive"}
                  onValueChange={(value) => setForm((current) => ({ ...current, is_active: value === "active" }))}
                >
                  <SelectTrigger className="border-white/10 bg-neutral-900 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-neutral-900 text-white">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="explanation" className="text-white">
                Explanation
              </Label>
              <Textarea
                id="explanation"
                rows={2}
                value={form.explanation}
                onChange={(event) => setForm((current) => ({ ...current, explanation: event.target.value }))}
                className="border-white/10 bg-neutral-900 text-white"
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsModalOpen(false)
                  resetForm()
                }}
                disabled={saving}
                className="border-white/10 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={saving}
                disabled={!form.review_cycle_id || !form.targeted_emails}
                className="bg-white text-black hover:bg-slate-200 hover:text-black"
              >
                {editingQuestion ? "Save Changes" : "Add Question"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
