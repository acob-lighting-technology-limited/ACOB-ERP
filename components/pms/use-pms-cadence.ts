"use client"

import { useCallback, useSyncExternalStore } from "react"
import { DEFAULT_PMS_CADENCE, type PmsCadence } from "@/lib/pms/cadence"

/**
 * The cadence selection, shared by every PMS surface.
 *
 * PMS is scored per cadence, so the cadence — not a single cycle — is the scope
 * a user works in. Keeping it in one store (mirrored to localStorage) means
 * choosing "Annual" on one PMS route still reads Annual on the next one, instead
 * of every table silently snapping back to Quarterly.
 *
 * Deliberately not URL state: most PMS tables are statically rendered and
 * reading search params in them would force every one of those pages dynamic.
 */
const STORAGE_KEY = "pms.cadence"
const VALID: PmsCadence[] = ["all", "quarterly", "biannual", "annual"]

let current: PmsCadence = DEFAULT_PMS_CADENCE
let hydrated = false
const listeners = new Set<() => void>()

function isCadence(value: unknown): value is PmsCadence {
  return typeof value === "string" && (VALID as string[]).includes(value)
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return
  hydrated = true
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (isCadence(stored) && stored !== current) {
    current = stored
    for (const listener of listeners) listener()
  }
}

function subscribe(listener: () => void) {
  hydrate()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setPmsCadence(next: PmsCadence) {
  if (!isCadence(next) || next === current) return
  current = next
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next)
  for (const listener of listeners) listener()
}

export function getPmsCadence(): PmsCadence {
  return current
}

/** `[cadence, setCadence]`, shared across every PMS route in the session. */
export function usePmsCadence(): [PmsCadence, (next: PmsCadence) => void] {
  const cadence = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_PMS_CADENCE
  )
  const set = useCallback((next: PmsCadence) => setPmsCadence(next), [])
  return [cadence, set]
}
