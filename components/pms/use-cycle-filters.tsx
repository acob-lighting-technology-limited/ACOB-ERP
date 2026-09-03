"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DataTableFilter } from "@/components/ui/data-table"
import {
  CADENCE_OPTIONS,
  cadencePeriodLabel,
  cycleOptionLabel,
  matchesCadence,
  pickCurrentCycle,
  type CadenceCycle,
  type PmsCadence,
} from "@/lib/pms/cadence"
import { toLocalISODate } from "@/lib/utils/date"

export type CycleFilterCycle = CadenceCycle & { name: string; status?: string | null }

/**
 * Two-stage cycle filter:
 * 1. Cycle Type: Cycle (default / quarterly), Biannual, Annual.
 * 2. Period: Dynamically shows Quarters when on "Cycle", Halves when on "Biannual", Years when on "Annual".
 */
export function useCycleFilters<TRow>({
  cycles,
  getRowCycleId,
  cycleKey = "cycle",
  cycleLabel,
  includeCyclePicker = true,
  defaultCadence = "quarterly",
}: {
  cycles: CycleFilterCycle[]
  getRowCycleId: (row: TRow) => string | null | undefined
  cycleKey?: string
  cycleLabel?: string
  includeCyclePicker?: boolean
  defaultCadence?: PmsCadence
}): { filters: DataTableFilter<TRow>[]; selectedCycleId: string; cadence: PmsCadence } {
  const [cadence, setCadence] = useState<PmsCadence>(defaultCadence)
  const [selectedCycleId, setSelectedCycleId] = useState("")

  // If defaultCadence was explicitly passed and differs, set it
  useEffect(() => {
    if (defaultCadence && defaultCadence !== cadence) {
      setCadence(defaultCadence)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCadence])

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

  const dynamicPeriodLabel =
    cycleLabel && cycleLabel !== "Cycle" && cycleLabel !== "Quarter" ? cycleLabel : cadencePeriodLabel(cadence)

  const filters = useMemo<DataTableFilter<TRow>[]>(() => {
    const list: DataTableFilter<TRow>[] = [
      {
        key: `${cycleKey}_type`,
        label: "Review Type",
        options: CADENCE_OPTIONS,
        multi: false,
        mode: "custom",
        defaultValues: [cadence],
        filterFn: (row, values) => matchesSelection(row, (values[0] as PmsCadence) || cadence),
        render: (values, onChange) => {
          const currentCadence = (values[0] as PmsCadence) || cadence
          return (
            <Select
              value={currentCadence}
              onValueChange={(value) => {
                const next = value as PmsCadence
                setCadence(next)
                onChange([next])
                const newCycle = pickCurrentCycle(cycles, toLocalISODate(), next)
                setSelectedCycleId(newCycle?.id ?? "")
              }}
            >
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
          )
        },
      },
      {
        key: cycleKey,
        label: dynamicPeriodLabel,
        options: visibleCycles.map((cycle) => ({
          value: cycle.id,
          label: `${cycleOptionLabel(cycle, visibleCycles)}${cycle.status === "active" ? " (Active)" : ""}`,
        })),
        multi: false,
        mode: "custom",
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
              <SelectValue
                placeholder={
                  visibleCycles.length === 0
                    ? `No ${dynamicPeriodLabel.toLowerCase()}s`
                    : `Select ${dynamicPeriodLabel}`
                }
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

    if (!includeCyclePicker) list.length = 1
    return list
  }, [
    cadence,
    cycleKey,
    dynamicPeriodLabel,
    cycles,
    includeCyclePicker,
    matchesSelection,
    selectedCycleId,
    setCadence,
    visibleCycles,
  ])

  return { filters, selectedCycleId, cadence }
}
