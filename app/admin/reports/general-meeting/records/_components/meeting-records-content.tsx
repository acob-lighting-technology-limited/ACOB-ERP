"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertCircle, CalendarDays, Download, FileText, RefreshCw, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { DataTable, DataTablePage } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter, DataTableTab } from "@/components/ui/data-table"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { getCurrentOfficeWeek } from "@/lib/meeting-week"
import { MeetingSyncModal } from "./meeting-sync-modal"

type ArtifactTab = "attendance" | "transcript"

type Row = {
  id: string
  meeting_week: number
  meeting_year: number
  meeting_date: string | null
  document_type: string
  source_label: string | null
  file_name: string
  signed_url: string | null
  created_at: string
}

const TABS: DataTableTab[] = [
  { key: "attendance", label: "Attendance" },
  { key: "transcript", label: "Transcript" },
]

function formatMeetingDate(value: string | null): string {
  if (!value) return "-"
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return "-"
  return formatWATDate(date, { day: "2-digit", month: "short", year: "numeric" })
}

export function MeetingRecordsContent() {
  const [tab, setTab] = useState<ArtifactTab>("attendance")
  const [syncOpen, setSyncOpen] = useState(false)
  const officeWeek = getCurrentOfficeWeek()

  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["meeting-records", tab],
    queryFn: async (): Promise<Row[]> => {
      const res = await fetch(`/api/reports/meeting-week-documents?documentType=${tab}&currentOnly=true`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error || "Failed to load records")
      return payload.data || []
    },
  })

  const stats = useMemo(() => {
    const total = rows.length
    const thisYear = rows.filter((r) => r.meeting_year === officeWeek.year).length
    const downloadable = rows.filter((r) => Boolean(r.signed_url)).length
    return { total, thisYear, downloadable }
  }, [rows, officeWeek.year])

  const weekOptions = useMemo(() => Array.from({ length: 53 }, (_, i) => i + 1), [])
  const yearOptions = useMemo(() => [officeWeek.year - 1, officeWeek.year, officeWeek.year + 1], [officeWeek.year])

  const download = (row: Row) => {
    if (!row.signed_url) {
      toast.error("No downloadable file for this record")
      return
    }
    const anchor = document.createElement("a")
    anchor.href = row.signed_url
    anchor.download = row.file_name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        key: "source_label",
        label: "Meeting",
        sortable: true,
        accessor: (r) => r.source_label || "",
        render: (r) => <span className="font-medium">{r.source_label || "—"}</span>,
        resizable: true,
        initialWidth: 240,
      },
      {
        key: "meeting_date",
        label: "Meeting Date",
        sortable: true,
        accessor: (r) => r.meeting_date || "",
        render: (r) => formatMeetingDate(r.meeting_date),
      },
      {
        key: "meeting_week",
        label: "Week",
        sortable: true,
        hideOnMobile: true,
        accessor: (r) => r.meeting_week,
        render: (r) => <span className="font-medium">{`W${r.meeting_week}`}</span>,
      },
      {
        key: "meeting_year",
        label: "Year",
        sortable: true,
        hideOnMobile: true,
        accessor: (r) => r.meeting_year,
      },
      {
        key: "created_at",
        label: "Imported",
        sortable: true,
        hideOnMobile: true,
        accessor: (r) => r.created_at,
        render: (r) => formatWATDateTime(r.created_at, { day: "2-digit", month: "short", year: "numeric" }),
      },
    ],
    []
  )

  const meetingOptions = useMemo(() => {
    const labels = new Set(rows.map((r) => r.source_label).filter((l): l is string => Boolean(l)))
    return Array.from(labels).map((l) => ({ value: l, label: l }))
  }, [rows])

  const filters = useMemo<DataTableFilter<Row>[]>(
    () => [
      { key: "source_label", label: "Meeting", options: meetingOptions },
      {
        key: "meeting_week",
        label: "Week",
        options: weekOptions.map((w) => ({ value: String(w), label: `Week ${w}` })),
      },
      { key: "meeting_year", label: "Year", options: yearOptions.map((y) => ({ value: String(y), label: String(y) })) },
    ],
    [meetingOptions, weekOptions, yearOptions]
  )

  const isTranscript = tab === "transcript"

  return (
    <DataTablePage
      title="Meeting Records"
      description="Teams attendance reports and transcripts, auto-synced per meeting week."
      icon={Users}
      backLink={{ href: "/admin/reports/general-meeting", label: "Back to General Meeting" }}
      tabs={TABS}
      activeTab={tab}
      onTabChange={(key) => setTab(key as ArtifactTab)}
      actions={
        <Button variant="outline" onClick={() => setSyncOpen(true)}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Meeting Sync
        </Button>
      }
      stats={
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatCard
            variant="compact"
            title={isTranscript ? "Transcripts" : "Attendance Reports"}
            value={stats.total}
            icon={FileText}
            iconBgColor="bg-blue-500/10"
            iconColor="text-blue-500"
          />
          <StatCard
            variant="compact"
            title="This Year"
            value={stats.thisYear}
            icon={CalendarDays}
            iconBgColor="bg-amber-500/10"
            iconColor="text-amber-500"
          />
          <StatCard
            variant="compact"
            title="Downloadable"
            value={stats.downloadable}
            icon={Download}
            iconBgColor="bg-emerald-500/10"
            iconColor="text-emerald-500"
          />
        </div>
      }
    >
      <MeetingSyncModal open={syncOpen} onOpenChange={setSyncOpen} />

      <DataTable<Row>
        data={rows}
        columns={columns}
        filters={filters}
        getRowId={(r) => r.id}
        searchPlaceholder="Search by meeting, file, week, or year..."
        searchFn={(r, q) =>
          (r.source_label || "").toLowerCase().includes(q) ||
          r.file_name.toLowerCase().includes(q) ||
          String(r.meeting_week).includes(q) ||
          String(r.meeting_year).includes(q)
        }
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        onRetry={() => refetch()}
        viewToggle
        contactsView
        stickyToolbar
        defaultViewMode={{ mobile: "contacts", desktop: "list" }}
        mobileRow={{
          title: (r) => r.source_label || r.file_name,
          subtitle: (r) => `W${r.meeting_week} · ${r.meeting_year} · ${formatMeetingDate(r.meeting_date)}`,
          trailing: (r) => (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => download(r)}>
              <Download className="h-3.5 w-3.5" />
            </Button>
          ),
          onSelect: (r) => download(r),
        }}
        cardRenderer={(r) => (
          <div className="bg-card space-y-3 rounded-xl border p-4 text-xs transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{r.source_label || r.file_name}</p>
                <p className="text-muted-foreground text-xs">{formatMeetingDate(r.meeting_date)}</p>
              </div>
              <Badge variant="outline">
                W{r.meeting_week} {r.meeting_year}
              </Badge>
            </div>
            <div className="flex items-center justify-between border-t pt-2 text-[10px]">
              <span className="text-muted-foreground">{r.file_name}</span>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => download(r)}>
                <Download className="mr-1 h-3 w-3" /> Download
              </Button>
            </div>
          </div>
        )}
        rowActions={[{ label: "Download", icon: Download, onClick: (r: Row) => download(r) }]}
        emptyTitle={isTranscript ? "No transcripts yet" : "No attendance reports yet"}
        emptyDescription="Artifacts appear here automatically after each meeting is synced."
        emptyIcon={AlertCircle}
        skeletonRows={6}
        urlSync
      />
    </DataTablePage>
  )
}
