"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, Loader2, MessageSquare, Send, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn } from "@/components/ui/data-table"
import { apiFetch } from "@/lib/api-client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCycleFilters, type CycleFilterCycle } from "@/components/pms/use-cycle-filters"

type Profile = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
}

type Cycle = CycleFilterCycle

type PeerFeedbackRow = {
  id: string
  subject_user_id: string
  review_cycle_id: string
  score: number
  collaboration: number | null
  communication: number | null
  teamwork: number | null
  professionalism: number | null
  comments: string | null
  status: string
  created_at: string
  subject?: Profile | null
  reviewer?: Profile | null
}

function formatName(profile: Profile | null | undefined) {
  if (!profile) return "Unknown"
  return `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || "Unknown"
}

export default function PeerFeedbackPage() {
  const [colleagues, setColleagues] = useState<Profile[]>([])
  const [cycles, setCycles] = useState<Cycle[]>([])
  const [myFeedback, setMyFeedback] = useState<PeerFeedbackRow[]>([])
  const [receivedFeedback, setReceivedFeedback] = useState<PeerFeedbackRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<"received" | "given">("received")

  // Form state
  const [selectedColleague, setSelectedColleague] = useState("")
  const [selectedCycle, setSelectedCycle] = useState("")
  const [score, setScore] = useState("")
  const [collaboration, setCollaboration] = useState("")
  const [communication, setCommunication] = useState("")
  const [teamwork, setTeamwork] = useState("")
  const [professionalism, setProfessionalism] = useState("")
  const [comments, setComments] = useState("")

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [profilesRes, cyclesRes, myFeedbackRes, receivedRes] = await Promise.all([
        apiFetch("/api/hr/profiles?all=true"),
        apiFetch("/api/hr/performance/cycles"),
        apiFetch("/api/hr/performance/peer-feedback?as_reviewer=true"),
        apiFetch("/api/hr/performance/peer-feedback"),
      ])
      const [profilesData, cyclesData, myFeedbackData, receivedData] = await Promise.all([
        profilesRes.json().catch(() => ({})),
        cyclesRes.json().catch(() => ({})),
        myFeedbackRes.json().catch(() => ({})),
        receivedRes.json().catch(() => ({})),
      ])
      setColleagues((profilesData?.data || []) as Profile[])
      setCycles((cyclesData?.data || []) as Cycle[])
      setMyFeedback((myFeedbackData?.data || []) as PeerFeedbackRow[])
      setReceivedFeedback((receivedData?.data || []) as PeerFeedbackRow[])
    } catch {
      toast.error("Failed to load data")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const alreadySubmittedKeys = useMemo(
    () => new Set(myFeedback.map((f) => `${f.subject_user_id}:${f.review_cycle_id}`)),
    [myFeedback]
  )

  function resetForm() {
    setSelectedColleague("")
    setSelectedCycle("")
    setScore("")
    setCollaboration("")
    setCommunication("")
    setTeamwork("")
    setProfessionalism("")
    setComments("")
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedColleague || !selectedCycle || !score) {
      toast.error("Please select a colleague, cycle, and provide an overall score")
      return
    }
    const parsedScore = Number(score)
    if (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100) {
      toast.error("Score must be a number between 0 and 100")
      return
    }

    setIsSubmitting(true)
    try {
      const response = await apiFetch("/api/hr/performance/peer-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_user_id: selectedColleague,
          review_cycle_id: selectedCycle,
          score: parsedScore,
          collaboration: collaboration ? Number(collaboration) : null,
          communication: communication ? Number(communication) : null,
          teamwork: teamwork ? Number(teamwork) : null,
          professionalism: professionalism ? Number(professionalism) : null,
          comments: comments || null,
        }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
      if (!response.ok) throw new Error(payload?.error || "Failed to submit")
      toast.success(payload?.message || "Peer feedback submitted")
      setIsDialogOpen(false)
      resetForm()
      void loadData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit")
    } finally {
      setIsSubmitting(false)
    }
  }

  const avgReceived =
    receivedFeedback.length > 0
      ? Math.round((receivedFeedback.reduce((sum, f) => sum + f.score, 0) / receivedFeedback.length) * 100) / 100
      : null

  const { filters: cycleFilters } = useCycleFilters<PeerFeedbackRow>({
    cycles,
    getRowCycleId: (f) => f.review_cycle_id,
    cycleKey: "review_cycle",
    cycleLabel: "Quarter",
  })

  const givenColumns = useMemo<DataTableColumn<PeerFeedbackRow>[]>(
    () => [
      {
        key: "subject",
        label: "Colleague",
        sortable: true,
        accessor: (f) => formatName(f.subject),
        render: (f) => <span className="font-medium">{formatName(f.subject)}</span>,
      },
      {
        key: "score",
        label: "Overall Score",
        sortable: true,
        accessor: (f) => f.score,
        render: (f) => <Badge variant="secondary">{f.score}%</Badge>,
      },
      {
        key: "created_at",
        label: "Submitted",
        sortable: true,
        accessor: (f) => f.created_at,
        render: (f) => (
          <span className="text-muted-foreground text-xs">{new Date(f.created_at).toLocaleDateString()}</span>
        ),
        hideOnMobile: true,
      },
    ],
    []
  )

  const receivedColumns = useMemo<DataTableColumn<PeerFeedbackRow>[]>(
    () => [
      {
        key: "score",
        label: "Overall Score",
        sortable: true,
        accessor: (f) => f.score,
        render: (f) => (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Anonymous Peer</span>
            <Badge variant="secondary">{f.score}%</Badge>
          </div>
        ),
      },
      {
        key: "collaboration",
        label: "Collaboration",
        accessor: (f) => f.collaboration ?? -1,
        render: (f) => <span className="text-xs">{f.collaboration !== null ? `${f.collaboration}%` : "-"}</span>,
        hideOnMobile: true,
      },
      {
        key: "teamwork",
        label: "Teamwork",
        accessor: (f) => f.teamwork ?? -1,
        render: (f) => <span className="text-xs">{f.teamwork !== null ? `${f.teamwork}%` : "-"}</span>,
        hideOnMobile: true,
      },
      {
        key: "created_at",
        label: "Received",
        sortable: true,
        accessor: (f) => f.created_at,
        render: (f) => (
          <span className="text-muted-foreground text-xs">{new Date(f.created_at).toLocaleDateString()}</span>
        ),
        hideOnMobile: true,
      },
    ],
    []
  )

  const rows = activeTab === "given" ? myFeedback : receivedFeedback

  return (
    <DataTablePage
      title="Peer Feedback"
      description="Give feedback to colleagues and view feedback you've received this cycle."
      icon={MessageSquare}
      backLink={{ href: "/pms", label: "Back to PMS" }}
      spacing="tight"
      actionsPlacement="inline-always"
      tabs={[
        { key: "received", label: "Feedback Received", icon: Users },
        { key: "given", label: "Feedback Given", icon: Send },
      ]}
      activeTab={activeTab}
      onTabChange={(tab) => setActiveTab(tab as "received" | "given")}
      actions={
        <Button onClick={() => setIsDialogOpen(true)} size="sm">
          <Send className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Give Feedback</span>
        </Button>
      }
      stats={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard variant="compact" title="Given by You" value={myFeedback.length} icon={Send} />
          <StatCard variant="compact" title="Received" value={receivedFeedback.length} icon={Users} />
          <StatCard
            variant="compact"
            title="Avg Received Score"
            value={avgReceived !== null ? `${avgReceived}%` : "-"}
            icon={MessageSquare}
          />
        </div>
      }
    >
      {activeTab === "given" ? (
        <DataTable<PeerFeedbackRow>
          data={rows}
          columns={givenColumns}
          filters={cycleFilters}
          getRowId={(f) => f.id}
          searchPlaceholder="Search colleague name..."
          searchFn={(f, query) => formatName(f.subject).toLowerCase().includes(query.toLowerCase())}
          isLoading={isLoading}
          onRetry={() => void loadData()}
          emptyTitle="No Feedback Given Yet"
          emptyDescription={'No peer feedback submitted yet. Use the "Give Feedback" button to start.'}
          emptyIcon={Send}
          viewToggle
          stickyToolbar
          contactsView
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            title: (f) => formatName(f.subject),
            trailing: (f) => <Badge variant="secondary">{f.score}%</Badge>,
            detail: {
              title: (f) => formatName(f.subject),
              fields: (f) => [
                { label: "Overall score", value: `${f.score}%` },
                { label: "Comments", value: f.comments || "No comments left." },
                { label: "Submitted", value: new Date(f.created_at).toLocaleDateString() },
              ],
            },
          }}
          cardRenderer={(f) => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{formatName(f.subject)}</span>
                <Badge variant="secondary">{f.score}%</Badge>
              </div>
              {f.comments && <p className="text-muted-foreground line-clamp-2 text-xs">{f.comments}</p>}
              <div className="border-border/40 text-muted-foreground flex items-center justify-between border-t pt-2 text-xs">
                <span>Submitted</span>
                <span>{new Date(f.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          )}
          urlSync
        />
      ) : (
        <DataTable<PeerFeedbackRow>
          data={rows}
          columns={receivedColumns}
          filters={cycleFilters}
          getRowId={(f) => f.id}
          searchPlaceholder="Search feedback..."
          searchFn={() => true}
          isLoading={isLoading}
          onRetry={() => void loadData()}
          emptyTitle="No Feedback Received Yet"
          emptyDescription="No peer feedback received yet for the current cycle."
          emptyIcon={Users}
          viewToggle
          stickyToolbar
          contactsView
          defaultViewMode={{ mobile: "contacts", desktop: "list" }}
          mobileRow={{
            title: () => "Anonymous Peer",
            trailing: (f) => <Badge variant="secondary">{f.score}%</Badge>,
            detail: {
              title: () => "Anonymous Peer",
              fields: (f) => [
                { label: "Overall score", value: `${f.score}%` },
                { label: "Collaboration", value: f.collaboration !== null ? `${f.collaboration}%` : null },
                { label: "Teamwork", value: f.teamwork !== null ? `${f.teamwork}%` : null },
                { label: "Communication", value: f.communication !== null ? `${f.communication}%` : null },
                { label: "Professionalism", value: f.professionalism !== null ? `${f.professionalism}%` : null },
                { label: "Comments", value: f.comments || null },
                { label: "Received", value: new Date(f.created_at).toLocaleDateString() },
              ],
            },
          }}
          cardRenderer={(f) => (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground text-sm">Anonymous Peer</span>
                <Badge variant="secondary">{f.score}%</Badge>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {f.collaboration !== null && (
                  <div>
                    <p className="text-muted-foreground text-[10px] font-medium uppercase">Collaboration</p>
                    <p className="font-medium">{f.collaboration}%</p>
                  </div>
                )}
                {f.teamwork !== null && (
                  <div>
                    <p className="text-muted-foreground text-[10px] font-medium uppercase">Teamwork</p>
                    <p className="font-medium">{f.teamwork}%</p>
                  </div>
                )}
              </div>
              <div className="border-border/40 text-muted-foreground flex items-center justify-between border-t pt-2 text-xs">
                <span>Received</span>
                <span>{new Date(f.created_at).toLocaleDateString()}</span>
              </div>
            </div>
          )}
          urlSync
        />
      )}

      {/* Give Feedback Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Give Peer Feedback</DialogTitle>
            <DialogDescription>
              Rate a colleague on their performance this cycle. Your name will not be shown to them.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-2">
              <Label>Colleague</Label>
              <Select value={selectedColleague} onValueChange={setSelectedColleague}>
                <SelectTrigger>
                  <SelectValue placeholder="Select colleague…" />
                </SelectTrigger>
                <SelectContent>
                  {colleagues.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {formatName(c)} {c.department ? `(${c.department})` : ""}
                      {alreadySubmittedKeys.has(`${c.id}:${selectedCycle}`) ? " ✓" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Review Cycle</Label>
              <Select value={selectedCycle} onValueChange={setSelectedCycle}>
                <SelectTrigger>
                  <SelectValue placeholder="Select cycle…" />
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Overall Score (0–100) *</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="e.g. 85"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Collaboration</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0–100"
                  value={collaboration}
                  onChange={(e) => setCollaboration(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Communication</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0–100"
                  value={communication}
                  onChange={(e) => setCommunication(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Teamwork</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0–100"
                  value={teamwork}
                  onChange={(e) => setTeamwork(e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Professionalism</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0–100"
                  value={professionalism}
                  onChange={(e) => setProfessionalism(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Comments (optional)</Label>
              <Textarea
                placeholder="Share specific observations or examples…"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={3}
                maxLength={2000}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="gap-2">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Submit Feedback
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DataTablePage>
  )
}
