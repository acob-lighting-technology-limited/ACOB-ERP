"use client"

import { useCallback, useEffect, useMemo, useTransition } from "react"
import { Loader2 } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DataTableFilter } from "@/components/ui/data-table"
import {
  CADENCE_OPTIONS,
  cadencePeriodLabel,
  cycleOptionLabel,
  isAnnualCycle,
  isBiannualCycle,
  isQuarterlyCycle,
  matchesCadence,
  pickCurrentCycle,
  type PmsCadence,
} from "@/lib/pms/cadence"
import { toLocalISODate } from "@/lib/utils/date"
import { usePmsCadence } from "@/components/pms/use-pms-cadence"
import type { ReviewCycleOption } from "../_lib"

interface CycleSelectorProps {
  cycles: ReviewCycleOption[]
  activeCycleId?: string | null
  showLabel?: boolean
}

/**
 * Two-stage cycle filter:
 * 1. Cycle Type: Cycle (default / quarterly), Biannual, Annual. (No "Cadence" label!)
 * 2. Period: Dynamically shows Quarters when on "Cycle", Halves when on "Biannual", Years when on "Annual".
 */
export function CycleSelector({ cycles, activeCycleId, showLabel = false }: CycleSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [cadence, setCadence] = usePmsCadence()
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!activeCycleId || (cycles || []).length === 0) return
    const matched = (cycles || []).find((c) => c.id === activeCycleId)
    if (matched) {
      if (isBiannualCycle(matched.reviewType, matched.name)) {
        if (cadence !== "biannual") setCadence("biannual")
      } else if (isAnnualCycle(matched.reviewType, matched.name)) {
        if (cadence !== "annual") setCadence("annual")
      } else if (isQuarterlyCycle(matched.reviewType, matched.name)) {
        if (cadence !== "quarterly") setCadence("quarterly")
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCycleId, cycles])

  const visibleCycles = useMemo(
    () => (cycles || []).filter((cycle) => matchesCadence(cadence, cycle.reviewType, cycle.name)),
    [cycles, cadence]
  )

  const cadenceCycles = useMemo(
    () =>
      (cycles || []).map((cycle) => ({
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
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  function handleCadence(value: string) {
    const next = value as PmsCadence
    setCadence(next)
    const fallback = pickCurrentCycle(cadenceCycles, toLocalISODate(), next)
    if (fallback && fallback.id !== activeCycleId) handleSelect(fallback.id)
  }

  if (!cycles || cycles.length === 0) return null

  const periodLabel = cadencePeriodLabel(cadence)

  return (
    <div className="flex w-full items-center gap-2">
      {showLabel && <span className="text-muted-foreground hidden text-xs font-medium sm:inline">Review Cycle:</span>}
      <Select value={cadence} onValueChange={handleCadence} disabled={isPending}>
        <SelectTrigger className="border-border bg-card hover:bg-accent/50 h-9 w-[130px] shrink-0 text-xs shadow-xs transition-colors">
          <SelectValue placeholder="Review Type" />
        </SelectTrigger>
        <SelectContent align="start">
          {CADENCE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedValue} onValueChange={handleSelect} disabled={isPending}>
        <SelectTrigger className="border-border bg-card hover:bg-accent/50 h-9 w-full text-xs shadow-xs transition-colors sm:w-[220px]">
          <SelectValue
            placeholder={visibleCycles.length === 0 ? `No ${periodLabel.toLowerCase()}s` : `Select ${periodLabel}`}
          />
        </SelectTrigger>
        <SelectContent align="start">
          {visibleCycles.map((cycle) => (
            <SelectItem
              key={cycle.id}
              value={cycle.id}
              textValue={`${cycleOptionLabel(cycle, visibleCycles)}${cycle.status === "active" ? " (Active)" : ""}`}
              className="text-xs"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate">{cycleOptionLabel(cycle, visibleCycles)}</span>{" "}
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
      {isPending && <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />}
    </div>
  )
}

/**
 * URL-navigating DataTable filters for Review Type (Quarterly, Biannual, Annual) and Period (Quarter / Half / Year).
 * Selecting "Quarterly" displays quarters in the next filter; "Biannual" displays halves; "Annual" displays years.
 */
export function useCycleUrlFilters<TRow = Record<string, unknown>>({
  cycles,
  activeCycleId,
}: {
  cycles?: ReviewCycleOption[]
  activeCycleId?: string | null
}): DataTableFilter<TRow>[] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [cadence, setCadence] = usePmsCadence()
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!activeCycleId || (cycles ?? []).length === 0) return
    const matched = (cycles ?? []).find((c) => c.id === activeCycleId)
    if (matched) {
      if (isBiannualCycle(matched.reviewType, matched.name)) {
        if (cadence !== "biannual") setCadence("biannual")
      } else if (isAnnualCycle(matched.reviewType, matched.name)) {
        if (cadence !== "annual") setCadence("annual")
      } else if (isQuarterlyCycle(matched.reviewType, matched.name)) {
        if (cadence !== "quarterly") setCadence("quarterly")
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCycleId, cycles])

  const visibleCycles = useMemo(
    () => (cycles ?? []).filter((cycle) => matchesCadence(cadence, cycle.reviewType, cycle.name)),
    [cycles, cadence]
  )

  const cadenceCycles = useMemo(
    () =>
      (cycles ?? []).map((cycle) => ({
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

  const handleSelect = useCallback(
    (newCycleId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("cycle_id", newCycleId)
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`)
      })
    },
    [pathname, router, searchParams]
  )

  const handleCadence = useCallback(
    (value: string) => {
      const next = value as PmsCadence
      setCadence(next)
      const fallback = pickCurrentCycle(cadenceCycles, toLocalISODate(), next)
      if (fallback && fallback.id !== activeCycleId) handleSelect(fallback.id)
    },
    [activeCycleId, cadenceCycles, handleSelect, setCadence]
  )

  return useMemo(() => {
    if (!cycles || cycles.length === 0) return []

    const periodLabel = cadencePeriodLabel(cadence)

    return [
      {
        key: "cycle_type",
        label: "Review Type",
        options: CADENCE_OPTIONS,
        multi: false,
        mode: "custom" as const,
        filterFn: () => true,
        render: () => (
          <Select value={cadence} onValueChange={handleCadence} disabled={isPending}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Review Type" />
            </SelectTrigger>
            <SelectContent>
              {CADENCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
      {
        key: "cycle_selector",
        label: periodLabel,
        options: visibleCycles.map((cycle) => ({
          value: cycle.id,
          label: cycleOptionLabel(cycle, visibleCycles),
        })),
        multi: false,
        mode: "custom" as const,
        filterFn: () => true,
        render: () => (
          <Select value={selectedValue} onValueChange={handleSelect} disabled={isPending}>
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={visibleCycles.length === 0 ? `No ${periodLabel.toLowerCase()}s` : `Select ${periodLabel}`}
              />
            </SelectTrigger>
            <SelectContent>
              {visibleCycles.map((cycle) => (
                <SelectItem
                  key={cycle.id}
                  value={cycle.id}
                  textValue={`${cycleOptionLabel(cycle, visibleCycles)}${cycle.status === "active" ? " (Active)" : ""}`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate">{cycleOptionLabel(cycle, visibleCycles)}</span>{" "}
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
        ),
      },
    ]
  }, [cadence, cycles, handleCadence, handleSelect, isPending, selectedValue, visibleCycles])
}
