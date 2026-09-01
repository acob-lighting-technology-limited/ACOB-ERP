"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, ClipboardList, Clock3, Search, Send, SlidersHorizontal } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { logger } from "@/lib/logger"
import { formatWATDate } from "@/lib/utils/date"
import { loadUserTasks } from "@/components/tasks/user-tasks-data"
import { TaskStatusControl } from "@/components/tasks/TaskStatusControl"
import { UserTaskDetailsDialog } from "@/components/tasks/UserTaskDetailsDialog"
import { TASK_STATUS_CONFIG } from "@/lib/tasks/constants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { StatCard } from "@/components/ui/stat-card"
import type { Task, TaskUserProfile } from "@/types/task"

const log = logger("task5-content")
const priorities = ["low", "medium", "high", "urgent"]

export function Task5Content({
  initialTasks,
  userId,
  userProfile,
}: {
  initialTasks: Task[]
  userId: string
  userProfile: TaskUserProfile | null
}) {
  const [tasks, setTasks] = useState(initialTasks)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("open")
  const [priority, setPriority] = useState("all")
  const [selected, setSelected] = useState<Task | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [updates, setUpdates] = useState<
    {
      id: string
      content?: string
      update_type: string
      created_at: string
      user?: { first_name: string; last_name: string }
    }[]
  >([])
  const [isPostingComment, setIsPostingComment] = useState(false)
  const supabase = createClient()

  const stats = useMemo(
    () => ({
      total: tasks.length,
      pending: tasks.filter((task) => task.status === "pending").length,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      completed: tasks.filter((task) => task.status === "completed").length,
    }),
    [tasks]
  )
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tasks.filter((task) => {
      const isOpen = !["completed", "cancelled", "reassigned"].includes(task.status)
      if (status === "open" && !isOpen) return false
      if (status !== "open" && status !== "all" && task.status !== status) return false
      if (priority !== "all" && task.priority !== priority) return false
      return (
        !query ||
        [task.title, task.description, task.work_item_number, task.goal_title].some((value) =>
          value?.toLowerCase().includes(query)
        )
      )
    })
  }, [priority, search, status, tasks])

  const reload = async () => {
    try {
      setTasks(await loadUserTasks(supabase, userId, userProfile))
    } catch (error) {
      log.error({ error: String(error) }, "task refresh failed")
      toast.error("Could not refresh tasks")
    }
  }
  const canReview = (task: Task) => {
    const role = userProfile?.role?.toLowerCase() || ""
    if (["admin", "super_admin", "developer"].includes(role)) return true
    const scope = [userProfile?.department, ...(userProfile?.lead_departments || [])].filter(Boolean)
    return Boolean(userProfile?.is_department_lead && task.department && scope.includes(task.department))
  }
  const openTask = async (task: Task) => {
    setSelected(task)
    const { data } = await supabase
      .from("task_updates")
      .select("id, content, update_type, created_at")
      .eq("task_id", task.id)
      .order("created_at", { ascending: false })
    setUpdates((data || []) as typeof updates)
    setIsDetailsOpen(true)
  }
  const addComment = async (content: string) => {
    if (!selected || !content.trim()) return
    setIsPostingComment(true)
    try {
      const { error } = await supabase
        .from("task_updates")
        .insert({ task_id: selected.id, user_id: userId, update_type: "comment", content: content.trim() })
      if (error) throw error
      toast.success("Comment added")
      await reload()
    } catch (error) {
      log.error({ error: String(error) }, "task comment failed")
      toast.error("Could not add comment")
    } finally {
      setIsPostingComment(false)
    }
  }
  const activeFilters = Number(status !== "open") + Number(priority !== "all")

  return (
    <PageWrapper maxWidth="full" background="gradient" spacing="compact" className="pb-12">
      <PageHeader
        title="My Tasks"
        description="Choose the next piece of work, then update it without losing context."
        icon={ClipboardList}
        backLink={{ href: "/pms", label: "Performance" }}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard
          title="All tasks"
          value={stats.total}
          icon={ClipboardList}
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-500"
          variant="compact"
        />
        <StatCard
          title="To start"
          value={stats.pending}
          icon={Clock3}
          iconBgColor="bg-amber-500/10"
          iconColor="text-amber-500"
          variant="compact"
        />
        <StatCard
          title="In progress"
          value={stats.inProgress}
          icon={Send}
          iconBgColor="bg-sky-500/10"
          iconColor="text-sky-500"
          variant="compact"
        />
        <StatCard
          title="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          iconBgColor="bg-emerald-500/10"
          iconColor="text-emerald-500"
          variant="compact"
        />
      </div>

      <div className="bg-background/95 sticky top-0 z-10 -mx-4 flex gap-2 px-4 py-2 backdrop-blur sm:static sm:mx-0 sm:px-0 sm:py-0">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-10 pl-9"
            placeholder="Search tasks"
          />
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button size="icon" variant="outline" className="h-10 w-10 shrink-0" aria-label="Filter tasks">
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilters > 0 && (
                <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px]">
                  {activeFilters}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Filter tasks</SheetTitle>
            </SheetHeader>
            <div className="space-y-4 px-4 py-3">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open tasks</SelectItem>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(TASK_STATUS_CONFIG).map(([value, item]) => (
                    <SelectItem key={value} value={value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priorities</SelectItem>
                  {priorities.map((item) => (
                    <SelectItem key={item} value={item} className="capitalize">
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SheetFooter className="flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setStatus("open")
                  setPriority("all")
                }}
              >
                Reset
              </Button>
              <SheetClose asChild>
                <Button className="flex-1">Show tasks</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {filtered.length} {filtered.length === 1 ? "task" : "tasks"}
        </p>
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          <Button size="sm" variant={status === "open" ? "secondary" : "ghost"} onClick={() => setStatus("open")}>
            Open
          </Button>
          <Button size="sm" variant={status === "all" ? "secondary" : "ghost"} onClick={() => setStatus("all")}>
            All
          </Button>
          <Button
            size="sm"
            variant={status === "completed" ? "secondary" : "ghost"}
            onClick={() => setStatus("completed")}
          >
            Done
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Nothing here yet</p>
            <p className="text-muted-foreground mt-1 text-sm">Try a different search or filter.</p>
            <Button
              variant="link"
              onClick={() => {
                setSearch("")
                setStatus("open")
                setPriority("all")
              }}
            >
              Clear filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((task) => {
            const config = TASK_STATUS_CONFIG[task.status as keyof typeof TASK_STATUS_CONFIG]
            return (
              <Card key={task.id} className="group hover:border-primary/40 transition-colors">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm leading-snug font-semibold">{task.title}</p>
                      {task.goal_title && (
                        <p className="text-muted-foreground mt-1 truncate text-xs">{task.goal_title}</p>
                      )}
                    </div>
                    <Badge
                      variant={task.priority === "urgent" || task.priority === "high" ? "destructive" : "outline"}
                      className="shrink-0 capitalize"
                    >
                      {task.priority}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={config?.badgeVariant || "outline"} className="max-w-[60%] truncate">
                      {config?.label || task.status}
                    </Badge>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {task.due_date ? `Due ${formatWATDate(task.due_date)}` : "No deadline"}
                    </span>
                  </div>
                  <div>
                    <TaskStatusControl
                      task={task}
                      canReview={canReview(task)}
                      onChanged={() => void reload()}
                      size="sm"
                    />
                  </div>
                  <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => void openTask(task)}>
                    View task details
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
      <UserTaskDetailsDialog
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        selectedTask={selected}
        taskUpdates={updates}
        canReview={selected ? canReview(selected) : false}
        onChanged={() => void reload()}
        onAddComment={addComment}
        isPostingComment={isPostingComment}
      />
    </PageWrapper>
  )
}
