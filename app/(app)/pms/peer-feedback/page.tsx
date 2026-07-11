"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, Loader2, MessageSquare, Send, Users } from "lucide-react"
import { toast } from "sonner"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { apiFetch } from "@/lib/api-client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type Profile = {
  id: string
  first_name: string | null
  last_name: string | null
  department: string | null
}

type Cycle = {
  id: string
  name: string
  status: string | null
}

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

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Peer Feedback"
        description="Give feedback to colleagues and view feedback you've received this cycle."
        icon={MessageSquare}
        backLink={{ href: "/pms", label: "Back to PMS" }}
        actions={
          <Button onClick={() => setIsDialogOpen(true)} className="gap-2" size="sm">
            <Send className="h-4 w-4" />
            Give Feedback
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">Given by You</p>
            <p className="text-2xl font-semibold">{myFeedback.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">Received</p>
            <p className="text-2xl font-semibold">{receivedFeedback.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">Avg Received Score</p>
            <p className="text-2xl font-semibold">{avgReceived !== null ? `${avgReceived}%` : "-"}</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-16">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Feedback I've given */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-4 w-4" />
                Feedback Given
              </CardTitle>
              <CardDescription>Peer feedback you have submitted this period.</CardDescription>
            </CardHeader>
            <CardContent>
              {myFeedback.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  No peer feedback submitted yet. Use the &quot;Give Feedback&quot; button to start.
                </p>
              ) : (
                <div className="space-y-3">
                  {myFeedback.map((f) => (
                    <div key={f.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{formatName(f.subject)}</p>
                        <Badge variant="secondary">{f.score}%</Badge>
                      </div>
                      {f.comments && <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">{f.comments}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Feedback I've received */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Feedback Received
              </CardTitle>
              <CardDescription>Anonymised scores from peers about your performance.</CardDescription>
            </CardHeader>
            <CardContent>
              {receivedFeedback.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">
                  No peer feedback received yet for the current cycle.
                </p>
              ) : (
                <div className="space-y-3">
                  {receivedFeedback.map((f) => (
                    <div key={f.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-muted-foreground text-sm font-medium">Anonymous Peer</p>
                        <Badge variant="secondary">{f.score}%</Badge>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                        {f.collaboration !== null && (
                          <span className="text-muted-foreground">Collaboration: {f.collaboration}%</span>
                        )}
                        {f.communication !== null && (
                          <span className="text-muted-foreground">Communication: {f.communication}%</span>
                        )}
                        {f.teamwork !== null && <span className="text-muted-foreground">Teamwork: {f.teamwork}%</span>}
                        {f.professionalism !== null && (
                          <span className="text-muted-foreground">Professionalism: {f.professionalism}%</span>
                        )}
                      </div>
                      {f.comments && <p className="text-muted-foreground mt-2 text-sm">{f.comments}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
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
    </PageWrapper>
  )
}
