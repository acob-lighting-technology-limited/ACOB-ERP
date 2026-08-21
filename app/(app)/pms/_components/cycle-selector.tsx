"use client"

import { useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CADENCE_OPTIONS, cycleOptionLabel, matchesCadence, pickCurrentCycle, type PmsCadence } from "@/lib/pms/cadence"
import { toLocalISODate } from "@/lib/utils/date"
import { usePmsCadence } from "@/components/pms/use-pms-cadence"
import type { ReviewCycleOption } from "../_lib"

interface CycleSelectorProps {
  cycles: ReviewCycleOption[]
  activeCycleId?: string | null
  showLabel?: boolean
}

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
  const [cadence, setCadence] = usePmsCadence()

  const visibleCycles = useMemo(
    () => cycles.filter((cycle) => matchesCadence(cadence, cycle.reviewType, cycle.name)),
    [cycles, cadence]
  )

  const cadenceCycles = useMemo(
    () =>
      cycles.map((cycle) => ({
        id: cycle.id,
        name: cycle.name,
        review_type: cycle.reviewType,
        start_date: cycle.startDate,
        end_date: cycle.endDate,
        status: cycle.status,
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
      {showLabel && <span className="text-muted-foreground hidden text-xs font-medium sm:inline">Review Cycle:</span>}
      <Select value={cadence} onValueChange={handleCadence}>
        <SelectTrigger className="border-border bg-card hover:bg-accent/50 h-9 w-[130px] shrink-0 text-xs shadow-xs transition-colors">
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
        <SelectTrigger className="border-border bg-card hover:bg-accent/50 h-9 w-full text-xs shadow-xs transition-colors sm:w-[220px]">
          <SelectValue placeholder={visibleCycles.length === 0 ? "No cycles for this cadence" : "Select Cycle"} />
        </SelectTrigger>
        <SelectContent align="start">
          {visibleCycles.map((cycle) => (
            <SelectItem key={cycle.id} value={cycle.id} className="text-xs">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate">{cycleOptionLabel(cycle, visibleCycles)}</span>
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
