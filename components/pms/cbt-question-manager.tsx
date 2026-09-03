"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Brain, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { formatWATDate, toLocalISODate } from "@/lib/utils/date"
import { toast } from "sonner"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, RowAction } from "@/components/ui/data-table"
import { useCycleFilters } from "@/components/pms/use-cycle-filters"
import { pickCurrentCycle } from "@/lib/pms/cadence"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { apiFetch } from "@/lib/api-client"
import { useDepartments } from "@/hooks/use-departments"
import { getCanonicalDepartmentOrder } from "@/shared/departments"

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
}

function formatDate(date: string | undefined) {
  if (!date) return "-"
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

function getPreferredCycleId(cycles: ReviewCycle[], requestedCycleId: string | null) {
  if (requestedCycleId && cycles.some((cycle) => cycle.id === requestedCycleId)) return requestedCycleId

  const q1Cycle = cycles.find((cycle) => cycle.name.toLowerCase().includes("q1"))
  if (q1Cycle) return q1Cycle.id

  const activeCycle = cycles.find((cycle) => cycle.status === "active")
  if (activeCycle) return activeCycle.id

  return cycles[0]?.id || ""
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
    <div className="group bg-card text-card-foreground border-border/60 hover:border-primary/40 h-full space-y-3 rounded-xl border p-4 shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold">{question.prompt}</p>
          <p className="text-muted-foreground text-xs">{cycleName}</p>
          <p className="text-muted-foreground text-xs">Department: {question.department || "General"}</p>
          <p className="text-muted-foreground text-xs">Correct answer: Option {question.correct_option}</p>
        </div>
        <Badge variant={question.is_active === false ? "secondary" : "default"}>
          {question.is_active === false ? "Inactive" : "Active"}
        </Badge>
      </div>

      <div className="grid gap-2 text-sm">
        <p>
          <span className="font-medium">A:</span> {question.option_a}
        </p>
        <p>
          <span className="font-medium">B:</span> {question.option_b}
        </p>
        <p>
          <span className="font-medium">C:</span> {question.option_c}
        </p>
        <p>
          <span className="font-medium">D:</span> {question.option_d}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
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

interface CbtQuestionManagerProps {
  /** The parent PMS CBT index route, e.g. "/admin/hr/pms/cbt" or "/dept/[id]/hr/pms/cbt". */
  basePath: string
  /**
   * When set, this page is being used by a department lead: the Department
   * field is locked to their department instead of a free choice, and the
   * org-wide "Manage Cycles" action (which creates review cycles, not
   * questions) is hidden.
   */
  lockDepartment?: string
}

export function CbtQuestionManager({ basePath, lockDepartment }: CbtQuestionManagerProps) {
  const { departments: dynamicDepartments } = useDepartments()
  const departmentsList = lockDepartment
    ? [lockDepartment]
    : dynamicDepartments.length > 0
      ? dynamicDepartments
      : getCanonicalDepartmentOrder()

  const questionPath = `${basePath}/question`

  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedCycleId = searchParams.get("cycleId")
  const [cycles, setCycles] = useState<ReviewCycle[]>([])
  const [questions, setQuestions] = useState<CbtQuestion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editingQuestion, setEditingQuestion] = useState<CbtQuestion | null>(null)
  const initialForm = useMemo(
    () => ({
      review_cycle_id: "",
      department: lockDepartment || "",
      prompt: "",
      option_a: "",
      option_b: "",
      option_c: "",
      option_d: "",
      correct_option: "A" as "A" | "B" | "C" | "D",
      explanation: "",
      is_active: true,
    }),
    [lockDepartment]
  )
  const [form, setForm] = useState(initialForm)

  const loadPage = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [cyclesResponse, questionsResponse] = await Promise.all([
        apiFetch("/api/hr/performance/cycles", { cache: "no-store" }),
        apiFetch("/api/hr/performance/cbt/questions", { cache: "no-store" }),
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

  // Land on the quarter that contains today. PMS is scored quarterly, and
  // half-year/annual cycles cover the same dates, so "first active cycle" can
  // silently open the page on the wrong window.
  const activeCycleId = useMemo(() => pickCurrentCycle(cycles, toLocalISODate(), "quarterly")?.id || "", [cycles])

  useEffect(() => {
    if (cycles.length > 0 && !searchParams.get("review_cycle_id") && !searchParams.get("cycleId")) {
      if (activeCycleId) {
        router.replace(`${questionPath}?review_cycle_id=${encodeURIComponent(activeCycleId)}`, {
          scroll: false,
        })
      }
    }
  }, [cycles, searchParams, router, activeCycleId, questionPath])

  const { filters: cycleFilters, selectedCycleId } = useCycleFilters<CbtQuestion>({
    cycles,
    getRowCycleId: (row) => row.review_cycle_id,
    cycleKey: "review_cycle_id",
  })

  // The table's cycle filter is the source of truth; the URL keeps a deep link
  // working and seeds the "add question" form.
  const currentCycleId = useMemo(() => {
    return selectedCycleId || searchParams.get("review_cycle_id") || searchParams.get("cycleId") || activeCycleId
  }, [selectedCycleId, searchParams, activeCycleId])

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

  const filters: DataTableFilter<CbtQuestion>[] = [
    ...cycleFilters,
    {
      key: "department",
      label: "Department",
      options: departmentsList.map((dept) => ({ value: dept, label: dept })),
      placeholder: "All Departments",
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
      key: "department",
      label: "Department",
      sortable: true,
      accessor: (row) => row.department || "General",
      render: (row) => <Badge variant="outline">{row.department || "General"}</Badge>,
      resizable: true,
      initialWidth: 180,
    },
    {
      key: "review_cycle_id",
      label: "Cycle",
      sortable: true,
      accessor: (row) => cycleNameById.get(row.review_cycle_id || "") || "Unassigned",
      render: (row) => cycleNameById.get(row.review_cycle_id || "") || "Unassigned",
      resizable: true,
      initialWidth: 240,
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
        setDeleteConfirmId(question.id)
      },
    },
  ]

  function resetForm(nextCycleId = currentCycleId) {
    setForm({ ...initialForm, review_cycle_id: nextCycleId || activeCycleId })
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
      department: question.department || lockDepartment || "",
      prompt: question.prompt,
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d,
      correct_option: question.correct_option,
      explanation: question.explanation || "",
      is_active: question.is_active !== false,
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
      const payload = editingQuestion ? form : form

      const response = await apiFetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const responsePayload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) throw new Error(responsePayload?.error || "Failed to save question")

      toast.success(editingQuestion ? "Question updated" : "Question added")
      router.replace(`${questionPath}?review_cycle_id=${encodeURIComponent(form.review_cycle_id)}`, {
        scroll: false,
      })
      setIsModalOpen(false)
      resetForm(form.review_cycle_id)
      await loadPage()
    } catch (submitError) {
      toast.error(submitError instanceof Error ? submitError.message : "Failed to save question")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(questionId: string) {
    setDeletingId(questionId)

    try {
      const response = await apiFetch(`/api/hr/performance/cbt/questions/${encodeURIComponent(questionId)}`, {
        method: "DELETE",
      })
      const responsePayload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) throw new Error(responsePayload?.error || "Failed to delete question")

      toast.success("Question deleted")
      setDeleteConfirmId(null)
      await loadPage()
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "Failed to delete question")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <DataTablePage
      title="CBT Question Bank"
      description="Choose a PMS cycle, then add, edit, or delete CBT questions for that cycle. Q1 can stay editable while the team is still working there."
      icon={Brain}
      backLink={{ href: basePath, label: "Back to PMS CBT" }}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadPage()} disabled={isLoading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {!lockDepartment && (
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/hr/pms/cycles">Manage Cycles</Link>
            </Button>
          )}
          <Button size="sm" onClick={openCreateModal}>
            <Plus className="h-4 w-4" />
            Add Question
          </Button>
        </div>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            variant="compact"
            title="Selected Cycle"
            value={selectedCycle?.name || "None"}
            icon={Brain}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="Questions"
            value={filteredQuestions.length}
            icon={Brain}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
          <StatCard
            variant="compact"
            title="Active"
            value={activeQuestions}
            icon={Brain}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
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
        data={questions}
        columns={columns}
        filters={filters}
        getRowId={(question) => question.id}
        pagination={{ pageSize: 50 }}
        searchPlaceholder="Search question text, options, explanation, or answer..."
        searchFn={(question, query) =>
          [
            cycleNameById.get(question.review_cycle_id || "") || "",
            question.prompt,
            question.option_a,
            question.option_b,
            question.option_c,
            question.option_d,
            question.explanation || "",
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
                  <span className="font-medium">Cycle:</span> {cycleNameById.get(question.review_cycle_id || "") || "-"}
                </p>
                <p>
                  <span className="font-medium">Department:</span> {question.department || "-"}
                </p>
                <p>
                  <span className="font-medium">Option A:</span> {question.option_a}
                </p>
                <p>
                  <span className="font-medium">Option B:</span> {question.option_b}
                </p>
                <p>
                  <span className="font-medium">Option C:</span> {question.option_c}
                </p>
                <p>
                  <span className="font-medium">Option D:</span> {question.option_d}
                </p>
              </div>
              <div className="space-y-2">
                <p>
                  <span className="font-medium">Correct Answer:</span> Option {question.correct_option}
                </p>
                <p>
                  <span className="font-medium">Status:</span> {question.is_active === false ? "Inactive" : "Active"}
                </p>
                <p>
                  <span className="font-medium">Explanation:</span> {question.explanation || "-"}
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
        emptyTitle="No CBT questions in this cycle"
        emptyDescription="Choose a cycle and add questions to start building its CBT test."
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingQuestion ? "Edit CBT Question" : "Add CBT Question"}</DialogTitle>
            <DialogDescription>
              {editingQuestion
                ? "Update the selected CBT question and keep it under the right cycle."
                : "Add a new CBT question and choose the PMS cycle it belongs to."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Cycle</Label>
                <Select
                  value={form.review_cycle_id}
                  onValueChange={(value) => setForm((current) => ({ ...current, review_cycle_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cycle" />
                  </SelectTrigger>
                  <SelectContent>
                    {cycles
                      .filter((cycle) => !cycle.review_type || cycle.review_type.toLowerCase() === "quarterly")
                      .map((cycle) => (
                        <SelectItem key={cycle.id} value={cycle.id}>
                          {cycle.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={form.department}
                  disabled={Boolean(lockDepartment)}
                  onValueChange={(value) => setForm((current) => ({ ...current, department: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentsList.map((dept) => (
                      <SelectItem key={dept} value={dept}>
                        {dept}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt">Question</Label>
              <Textarea
                id="prompt"
                rows={4}
                value={form.prompt}
                onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))}
                required
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="option_a">Option A</Label>
                <Input
                  id="option_a"
                  value={form.option_a}
                  onChange={(event) => setForm((current) => ({ ...current, option_a: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="option_b">Option B</Label>
                <Input
                  id="option_b"
                  value={form.option_b}
                  onChange={(event) => setForm((current) => ({ ...current, option_b: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="option_c">Option C</Label>
                <Input
                  id="option_c"
                  value={form.option_c}
                  onChange={(event) => setForm((current) => ({ ...current, option_c: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="option_d">Option D</Label>
                <Input
                  id="option_d"
                  value={form.option_d}
                  onChange={(event) => setForm((current) => ({ ...current, option_d: event.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Correct Answer</Label>
                <Select
                  value={form.correct_option}
                  onValueChange={(value: "A" | "B" | "C" | "D") =>
                    setForm((current) => ({ ...current, correct_option: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">Option A</SelectItem>
                    <SelectItem value="B">Option B</SelectItem>
                    <SelectItem value="C">Option C</SelectItem>
                    <SelectItem value="D">Option D</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.is_active ? "active" : "inactive"}
                  onValueChange={(value) => setForm((current) => ({ ...current, is_active: value === "active" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="explanation">Explanation</Label>
              <Textarea
                id="explanation"
                rows={3}
                value={form.explanation}
                onChange={(event) => setForm((current) => ({ ...current, explanation: event.target.value }))}
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
              >
                Cancel
              </Button>
              <Button type="submit" loading={saving} disabled={!form.review_cycle_id || !form.department}>
                {editingQuestion ? "Save Changes" : "Add Question"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(isOpen) => !isOpen && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete CBT Question?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this CBT question? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deletingId !== null}
              onClick={(e) => {
                e.preventDefault()
                if (deleteConfirmId) void handleDelete(deleteConfirmId)
              }}
            >
              {deletingId !== null ? "Deleting..." : "Delete Question"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataTablePage>
  )
}
