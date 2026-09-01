"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Shared anatomy for "open this record and read it" dialogs — the task detail,
 * the help desk ticket, anything of that species.
 *
 * These exist because every one of those dialogs was independently built from
 * the same template and drifted: nested bordered cards inside a bordered modal,
 * four "hero stat cards" restating values the header already showed, a row of
 * `text-[11px] tracking-wider uppercase` labels, and a fixed `h-[88dvh]` that
 * gave a two-line record a full screen of empty space. Values, not markup, are
 * what a page should be supplying.
 *
 * The rules the primitives encode:
 * - the dialog is already a surface, so nothing inside it needs its own border
 * - each fact appears exactly once
 * - what needs answering (a blocker, a rejection note) comes before reference data
 * - `max-h`, never a fixed `h`
 */

/** One labelled value: icon, small label, value. */
export function DetailField({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: LucideIcon
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <Icon className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-muted-foreground text-[11px]">{label}</p>
        <div className="text-sm break-words">{children}</div>
      </div>
    </div>
  )
}

/** Grid the fields sit in — one column on a phone, two where there is room. */
export function DetailFieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}

export type DetailCalloutTone = "amber" | "rose" | "blue" | "emerald"

const CALLOUT_TONES: Record<DetailCalloutTone, string> = {
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
}

/**
 * A blocker, a failure note, a rejection reason, a scope restriction — the thing
 * the reader most needs to see. Render these above the reference data, never
 * buried under it.
 */
export function DetailCallout({
  tone,
  label,
  children,
}: {
  tone: DetailCalloutTone
  label: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("rounded-lg border p-3", CALLOUT_TONES[tone])}>
      <p className="text-[11px] font-semibold">{label}</p>
      <div className="mt-0.5 text-sm whitespace-pre-wrap">{children}</div>
    </div>
  )
}

/** Section heading with an optional count. Sentence case, not shouted. */
export function DetailSectionHeading({ children, count }: { children: string; count?: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-foreground text-sm font-semibold">{children}</h3>
      {count !== undefined && count > 0 && <span className="text-muted-foreground text-xs">{count}</span>}
    </div>
  )
}

/**
 * The primary action bar, pinned between the header and the scroll area. The
 * one thing the dialog is opened to do belongs above the fold, not inside a tab.
 */
export function DetailActionBar({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="bg-muted/20 border-b px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{label}</p>
        <div className="w-full sm:w-64">{children}</div>
      </div>
      {hint && <p className="text-muted-foreground mt-1.5 text-[11px]">{hint}</p>}
    </div>
  )
}

/** One entry in a chronological activity list. */
export function DetailTimelineEntry({
  title,
  timestamp,
  children,
}: {
  title: React.ReactNode
  timestamp: string
  children?: React.ReactNode
}) {
  return (
    <li className="border-border/60 border-l-2 pl-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-muted-foreground text-[11px]">{timestamp}</span>
      </div>
      {children && (
        <div className="text-muted-foreground mt-0.5 text-sm leading-relaxed whitespace-pre-wrap">{children}</div>
      )}
    </li>
  )
}
