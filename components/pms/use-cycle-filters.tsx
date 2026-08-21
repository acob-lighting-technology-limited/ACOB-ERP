"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DataTableFilter } from "@/components/ui/data-table"
import {
  CADENCE_OPTIONS,
  cycleOptionLabel,
  matchesCadence,
  pickCurrentCycle,
  type CadenceCycle,
  type PmsCadence,
} from "@/lib/pms/cadence"
import { toLocalISODate } from "@/lib/utils/date"
import { usePmsCadence } from "./use-pms-cadence"

export type CycleFilterCycle = CadenceCycle & { name: string; status?: string | null }

/**
 * The standard PMS cycle filters: a Cadence picker and a Cycle picker, rendered
 * inside the DataTable filter row like every other filter.
 *
 * Both default to how PMS is actually scored — Quarterly, on the quarter that
 * contains today — so a table never opens on a closed window or mixes half-year
 * and annual cycles into a quarterly view. Spread `filters` into the table's
 * `filters` array; row matching is handled here via `getRowCycleId`.
 *
 * Selection lives in the shared `usePmsCadence` SSOT store and this hook rather
 * than in the table's own filter values, because most PMS views load their cycles
 * after mount while the table reads configured defaults once. Both selections
 * are applied by the cadence filter's `filterFn`, which always carries a value.
 */

export function useCycleFilters<TRow>({
  cycles,
  getRowCycleId,
  cycleKey = "cycle",
  cycleLabel = "Cycle",
  includeCyclePicker = true,
  defaultCadence,
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
  defaultCadence?: PmsCadence
}): { filters: DataTableFilter<TRow>[]; selectedCycleId: string; cadence: PmsCadence } {
  const [cadence, setCadence] = usePmsCadence()
  const [selectedCycleId, setSelectedCycleId] = useState("")

  // If defaultCadence was explicitly passed and differs, set it
  useEffect(() => {
    if (defaultCadence && defaultCadence !== cadence) {
      setCadence(defaultCadence)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cycleInfoById = useMemo(() => {
    const map = new Map<string, { review_type?: string | null; name?: string | null }>()
    for (const cycle of cycles) map.set(cycle.id, { review_type: cycle.review_type, name: cycle.name })
    return map
  }, [cycles])

  const visibleCycles = useMemo(
    () => cycles.filter((cycle) => matchesCadence(cadence, cycle.review_type, cycle.name)),
    [cycles, cadence]
  )

  // Land on the current cycle as soon as the cycle list arrives or cadence changes.
  const seededRef = useRef(false)
  useEffect(() => {
    if (cycles.length === 0) return
    if (!seededRef.current) {
      seededRef.current = true
      setSelectedCycleId(pickCurrentCycle(cycles, toLocalISODate(), cadence)?.id ?? "")
    } else {
      setSelectedCycleId((current) => {
        const stillVisible = cycles.some(
          (cycle) => cycle.id === current && matchesCadence(cadence, cycle.review_type, cycle.name)
        )
        if (stillVisible) return current
        return pickCurrentCycle(cycles, toLocalISODate(), cadence)?.id ?? ""
      })
    }
  }, [cycles, cadence])

  const matchesSelection = useCallback(
    (row: TRow, forCadence: PmsCadence) => {
      // Cycles not loaded (or failed to load): filtering on a cadence we cannot
      // resolve would blank the whole table.
      if (cycleInfoById.size === 0) return true
      const cycleId = getRowCycleId(row)
      if (!cycleId) return forCadence === "all"
      const info = cycleInfoById.get(cycleId)
      if (!matchesCadence(forCadence, info?.review_type, info?.name)) return false
      if (includeCyclePicker && selectedCycleId) return cycleId === selectedCycleId
      return true
    },
    [getRowCycleId, includeCyclePicker, cycleInfoById, selectedCycleId]
  )

  const filters = useMemo<DataTableFilter<TRow>[]>(() => {
    const list: DataTableFilter<TRow>[] = [
      {
        key: `${cycleKey}_cadence`,
        label: "Cadence",
        options: CADENCE_OPTIONS,
        multi: false,
        mode: "custom",
        defaultValues: [cadence],
        filterFn: (row, values) => matchesSelection(row, (values[0] as PmsCadence) || cadence),
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
                  (cycle) => cycle.id === current && matchesCadence(next, cycle.review_type, cycle.name)
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
        options: visibleCycles.map((cycle) => ({
          value: cycle.id,
          label: cycleOptionLabel(cycle, visibleCycles),
        })),
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
                  {cycleOptionLabel(cycle, visibleCycles)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
    ]

    if (!includeCyclePicker) list.length = 1
    return list
  }, [
    cadence,
    cycleKey,
    cycleLabel,
    cycles,
    includeCyclePicker,
    matchesSelection,
    selectedCycleId,
    setCadence,
    visibleCycles,
  ])

  return { filters, selectedCycleId, cadence }
}
