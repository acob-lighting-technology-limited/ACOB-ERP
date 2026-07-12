"use client"

/* eslint-disable @next/next/no-img-element -- signed URLs, not optimizable by next/image */

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Cake, Loader2, PartyPopper, Search, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { EmptyState } from "@/components/ui/patterns"
import { Input } from "@/components/ui/input"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"

interface BirthdayManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CelebrantApiRow {
  firstName: string
  lastName: string
  department: string
  birthday: string
  avatarUrl: string | null
}

interface CelebrantRow extends CelebrantApiRow {
  daysUntil: number
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function formatMMDD(mmdd: string): string {
  const [month, day] = mmdd.split("-").map(Number)
  return `${MONTHS_SHORT[month - 1] ?? "?"} ${day}`
}

/** Days from today until the next occurrence of this MM-DD birthday (0 = today). */
function daysUntilBirthday(mmdd: string, today: Date): number {
  const [month, day] = mmdd.split("-").map(Number)
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let next = new Date(today.getFullYear(), month - 1, day)
  if (next < todayMidnight) next = new Date(today.getFullYear() + 1, month - 1, day)
  return Math.round((next.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24))
}

function daysUntilLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Today"
  if (daysUntil === 1) return "Tomorrow"
  return `In ${daysUntil} days`
}

async function fetchAllBirthdays(): Promise<CelebrantApiRow[]> {
  const response = await apiFetch("/api/admin/hr/birthdays?start=01-01&end=12-31")
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || "Failed to load birthdays")
  return payload?.data || []
}

export function BirthdayManagerDialog({ open, onOpenChange }: BirthdayManagerDialogProps) {
  const [now, setNow] = useState<Date | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    setNow(new Date())
  }, [])

  useEffect(() => {
    if (!open) {
      setSearchQuery("")
    }
  }, [open])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-hr-birthdays-all"],
    queryFn: fetchAllBirthdays,
    enabled: open,
  })

  const celebrants: CelebrantRow[] = useMemo(() => {
    if (!now || !data) return []
    return data
      .map((row) => ({ ...row, daysUntil: daysUntilBirthday(row.birthday, now) }))
      .sort((a, b) => a.daysUntil - b.daysUntil)
  }, [data, now])

  const filteredCelebrants = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return celebrants
    return celebrants.filter((c) => {
      const fullName = `${c.firstName} ${c.lastName}`.toLowerCase()
      return (
        c.firstName.toLowerCase().includes(query) ||
        c.lastName.toLowerCase().includes(query) ||
        fullName.includes(query) ||
        c.department.toLowerCase().includes(query)
      )
    })
  }, [celebrants, searchQuery])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cake className="h-5 w-5" />
            Birthday Manager
          </DialogTitle>
          <DialogDescription>All employees, sorted by their next upcoming birthday.</DialogDescription>
        </DialogHeader>

        {celebrants.length > 0 && (
          <div className="relative mt-2">
            <Search className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
            <Input
              placeholder="Search by name or department..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-8 pl-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-muted-foreground hover:text-foreground absolute top-2.5 right-3"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : isError ? (
            <p className="text-destructive py-8 text-center text-sm">
              {error instanceof Error ? error.message : "Failed to load birthdays"}
            </p>
          ) : celebrants.length === 0 ? (
            <EmptyState
              title="No birthdays on file"
              description="Employees haven't set their birthday yet."
              icon={Cake}
              className="border-0 py-8"
            />
          ) : filteredCelebrants.length === 0 ? (
            <EmptyState
              title="No matches found"
              description={`No employee matches "${searchQuery}"`}
              icon={Search}
              className="border-0 py-8"
            />
          ) : (
            <ul className="divide-y">
              {filteredCelebrants.map((c, index) => (
                <li key={`${c.firstName}-${c.lastName}-${index}`} className="flex items-center gap-3 py-2.5">
                  <Avatar className="h-9 w-9 shrink-0">
                    {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt={c.firstName} />}
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                      {c.firstName[0]}
                      {c.lastName[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {c.firstName} {c.lastName}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">{c.department}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium">{formatMMDD(c.birthday)}</p>
                    <Badge
                      variant={c.daysUntil === 0 ? "default" : "outline"}
                      className={cn(
                        "mt-0.5 gap-1 px-1.5 py-0 text-[10px]",
                        c.daysUntil === 0 && "bg-primary text-primary-foreground"
                      )}
                    >
                      {c.daysUntil === 0 && <PartyPopper className="h-2.5 w-2.5" />}
                      {daysUntilLabel(c.daysUntil)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
