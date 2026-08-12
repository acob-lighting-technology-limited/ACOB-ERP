"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DataTableFilter } from "@/components/ui/data-table"
import { matchesCadence, pickCurrentCycle, type CadenceCycle, type PmsCadence } from "@/lib/pms/cadence"
import { toLocalISODate } from "@/lib/utils/date"

export type CycleFilterCycle = CadenceCycle & { name: string }

const CADENCE_OPTIONS: { value: PmsCadence; label: string }[] = [
  { value: "all", label: "All cadences" },
  { value: "quarterly", label: "Quarterly" },
  { value: "biannual", label: "Biannual" },
  { value: "annual", label: "Annual" },
]

/**
 * The standard PMS cycle filters: a Cadence picker and a Cycle picker, rendered
 * inside the DataTable filter row like every other filter.
 *
 * Both default to how PMS is actually scored — Quarterly, on the quarter that
 * contains today — so a table never opens on a closed window or mixes half-year
 * and annual cycles into a quarterly view. Spread `filters` into the table's
 * `filters` array; row matching is handled here via `getRowCycleId`.
 *
 * Selection lives in this hook rather than in the table's own filter values,
 * because most PMS views load their cycles after mount while the table reads
 * configured defaults once. Both selections are applied by the cadence filter's
 * `filterFn`, which always carries a value.
 */
export function useCycleFilters<TRow>({
  cycles,
  getRowCycleId,
  cycleKey = "cycle",
  cycleLabel = "Cycle",
  includeCyclePicker = true,
}: {
  cycles: CycleFilterCycle[]
  getRowCycleId: (row: TRow) => string | null | undefined
  /** Filter key for the cycle select; the cadence select uses `${cycleKey}_cadence`. */
  cycleKey?: string
  cycleLabel?: string
  /**
   * Set false when the rows *are* cycles (the cycles admin list): a cadence
   * filter still makes sense there, but picking a single cycle does not.
   */
  includeCyclePicker?: boolean
}): { filters: DataTableFilter<TRow>[]; selectedCycleId: string; cadence: PmsCadence } {
  const [cadence, setCadence] = useState<PmsCadence>("quarterly")
  const [selectedCycleId, setSelectedCycleId] = useState("")

  const reviewTypeById = useMemo(() => {
    const map = new Map<string, string | null | undefined>()
    for (const cycle of cycles) map.set(cycle.id, cycle.review_type)
    return map
  }, [cycles])

  const visibleCycles = useMemo(
    () => cycles.filter((cycle) => matchesCadence(cadence, cycle.review_type)),
    [cycles, cadence]
  )

  // Land on the current quarter as soon as the cycle list arrives.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current || cycles.length === 0) return
    seededRef.current = true
    setSelectedCycleId(pickCurrentCycle(cycles, toLocalISODate(), "quarterly")?.id ?? "")
  }, [cycles])

  const matchesSelection = useCallback(
    (row: TRow, forCadence: PmsCadence) => {
      // Cycles not loaded (or failed to load): filtering on a cadence we cannot
      // resolve would blank the whole table.
      if (reviewTypeById.size === 0) return true
      const cycleId = getRowCycleId(row)
      if (!cycleId) return forCadence === "all"
      if (!matchesCadence(forCadence, reviewTypeById.get(cycleId))) return false
      if (includeCyclePicker && selectedCycleId) return cycleId === selectedCycleId
      return true
    },
    [getRowCycleId, includeCyclePicker, reviewTypeById, selectedCycleId]
  )

  const filters = useMemo<DataTableFilter<TRow>[]>(() => {
    const list: DataTableFilter<TRow>[] = [
      {
        key: `${cycleKey}_cadence`,
        label: "Cadence",
        options: CADENCE_OPTIONS,
        multi: false,
        mode: "custom",
        defaultValues: ["quarterly"],
        filterFn: (row, values) => matchesSelection(row, (values[0] as PmsCadence) || "quarterly"),
        render: (values, onChange) => (
          <Select
            value={values[0] || cadence}
            onValueChange={(value) => {
              const next = value as PmsCadence
              onChange([next])
              setCadence(next)
              // Follow the cadence with a cycle from it, so the table is never
              // left scoped to a cycle the picker no longer offers.
              setSelectedCycleId((current) => {
                const stillVisible = cycles.some(
                  (cycle) => cycle.id === current && matchesCadence(next, cycle.review_type)
                )
                if (stillVisible) return current
                return pickCurrentCycle(cycles, toLocalISODate(), next)?.id ?? ""
              })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Cadence" />
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
        key: cycleKey,
        label: cycleLabel,
        options: visibleCycles.map((cycle) => ({ value: cycle.id, label: cycle.name })),
        multi: false,
        mode: "custom",
        // Row scoping is applied by the cadence filter above, which always has a
        // value; this entry only renders the picker.
        filterFn: () => true,
        render: (_values, onChange) => (
          <Select
            value={visibleCycles.some((cycle) => cycle.id === selectedCycleId) ? selectedCycleId : ""}
            onValueChange={(value) => {
              onChange([value])
              setSelectedCycleId(value)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={visibleCycles.length === 0 ? "No cycles for this cadence" : cycleLabel} />
            </SelectTrigger>
            <SelectContent>
              {visibleCycles.map((cycle) => (
                <SelectItem key={cycle.id} value={cycle.id}>
                  {cycle.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
    ]

    if (!includeCyclePicker) list.length = 1
    return list
  }, [cadence, cycleKey, cycleLabel, cycles, includeCyclePicker, matchesSelection, selectedCycleId, visibleCycles])

  return { filters, selectedCycleId, cadence }
}
