"use client"

import { useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { matchesCadence, pickCurrentCycle, type PmsCadence } from "@/lib/pms/cadence"
import { toLocalISODate } from "@/lib/utils/date"
import type { ReviewCycleOption } from "../_lib"

interface CycleSelectorProps {
  cycles: ReviewCycleOption[]
  activeCycleId?: string | null
  showLabel?: boolean
}

const CADENCE_OPTIONS: { value: PmsCadence; label: string }[] = [
  { value: "all", label: "All cadences" },
  { value: "quarterly", label: "Quarterly" },
  { value: "biannual", label: "Biannual" },
  { value: "annual", label: "Annual" },
]

/**
 * Cadence + cycle pickers, matching the pair every PMS table shows. Opens on the
 * quarterly cadence and the quarter containing today, since that is how PMS is
 * scored — half-year and annual cycles span the same dates and would otherwise
 * be indistinguishable in the list.
 */
export function CycleSelector({ cycles, activeCycleId, showLabel = false }: CycleSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [cadence, setCadence] = useState<PmsCadence>("quarterly")

  const visibleCycles = useMemo(
    () => cycles.filter((cycle) => matchesCadence(cadence, cycle.reviewType)),
    [cycles, cadence]
  )

  const cadenceCycles = useMemo(
    () =>
      cycles.map((cycle) => ({
        id: cycle.id,
        review_type: cycle.reviewType,
        start_date: cycle.startDate,
        end_date: cycle.endDate,
      })),
    [cycles]
  )

  const selectedValue = useMemo(() => {
    if (activeCycleId && visibleCycles.some((cycle) => cycle.id === activeCycleId)) return activeCycleId
    return pickCurrentCycle(cadenceCycles, toLocalISODate(), cadence)?.id || ""
  }, [activeCycleId, cadence, cadenceCycles, visibleCycles])

  function handleSelect(newCycleId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("cycle_id", newCycleId)
    router.push(`${pathname}?${params.toString()}`)
  }

  function handleCadence(value: string) {
    const next = value as PmsCadence
    setCadence(next)
    // Follow the cadence with a cycle from it, so the page never keeps showing a
    // cycle the list no longer offers.
    const fallback = pickCurrentCycle(cadenceCycles, toLocalISODate(), next)
    if (fallback && fallback.id !== activeCycleId) handleSelect(fallback.id)
  }

  if (!cycles || cycles.length === 0) return null

  return (
    <div className="flex w-full items-center gap-2">
      {showLabel && (
        <span className="hidden text-xs font-medium text-muted-foreground sm:inline">Review Cycle:</span>
      )}
      <Select value={cadence} onValueChange={handleCadence}>
        <SelectTrigger className="h-9 w-[130px] shrink-0 bg-background/80 text-xs">
          <SelectValue placeholder="Cadence" />
        </SelectTrigger>
        <SelectContent align="start">
          {CADENCE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedValue} onValueChange={handleSelect}>
        <SelectTrigger className="h-9 w-full bg-background/80 text-xs">
          <SelectValue placeholder={visibleCycles.length === 0 ? "No cycles for this cadence" : "Select Cycle"} />
        </SelectTrigger>
        <SelectContent align="start">
          {visibleCycles.map((cycle) => (
            <SelectItem key={cycle.id} value={cycle.id} className="text-xs">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate">{cycle.name}</span>
                {cycle.status === "active" && (
                  <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
                    Active
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
