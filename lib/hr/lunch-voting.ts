import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Shared types and helpers for the lunch menu voting flow.
 *
 * A menu belongs to a single date and is made of an arbitrary number of
 * ordered, admin-named categories ("groups"). The count and the names are set
 * per menu — one category on a rice day, two when the meal pairs up, three or
 * more when the day calls for it.
 *
 * The invariant that never changes: a voter picks at most one option per
 * category, and must answer every category the admin marked required — never
 * two from the same category, never only some of the required ones. It is
 * enforced in three places: the unique (vote_id, group_id) key in the
 * database, the required-category check in the vote route, and the
 * single-select behaviour of the staff picker.
 *
 * `is_required` defaults to true; an admin opts a category out per menu (a
 * drink alongside the food, say).
 */

export const DEFAULT_LUNCH_SETTINGS = {
  cost: 2200,
  subsidy_percent: 50,
  eating_days: ["Monday", "Wednesday", "Friday"],
  voting_deadline: "07:00",
  voting_enabled: true,
} as const

export interface LunchSettingsValue {
  cost: number
  subsidy_percent: number
  eating_days: string[]
  /** Local (WAT) cut-off time for casting or changing a vote, "HH:MM". */
  voting_deadline: string
  voting_enabled: boolean
}

export type LunchMenuStatus = "draft" | "published" | "closed"

export interface LunchMenuOption {
  id: string
  group_id: string
  name: string
  description: string | null
  position: number
  is_available: boolean
}

export interface LunchMenuGroup {
  id: string
  menu_id: string
  name: string
  position: number
  is_required: boolean
  options: LunchMenuOption[]
}

export interface LunchMenu {
  id: string
  date: string
  title: string | null
  status: LunchMenuStatus
  voting_deadline: string | null
  published_at: string | null
  closed_at: string | null
  groups: LunchMenuGroup[]
}

/** A single staff member's vote, with the option they picked in each group. */
export interface LunchVoteRecord {
  user_id: string
  full_name: string
  department: string | null
  created_at: string
  updated_at: string
  /** group_id → option_id */
  selections: Record<string, string>
}

/** Aggregated count for one option, used by both the admin and staff views. */
export interface LunchOptionTally {
  option_id: string
  group_id: string
  name: string
  count: number
  voters: { user_id: string; full_name: string }[]
}

/** West Africa Time is UTC+1 year-round — no DST to account for. */
const WAT_OFFSET = "+01:00"

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidDeadlineTime(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value)
}

/**
 * Merges the stored lunch_settings JSON over the defaults, discarding values
 * that are the wrong shape so a bad hand-edit can't break the voting flow.
 */
export function normalizeLunchSettings(raw: unknown): LunchSettingsValue {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>

  const cost = Number(value.cost)
  const subsidy = Number(value.subsidy_percent)
  const eatingDays = Array.isArray(value.eating_days)
    ? value.eating_days.filter((d): d is string => typeof d === "string")
    : null

  return {
    cost: Number.isFinite(cost) && cost >= 0 ? cost : DEFAULT_LUNCH_SETTINGS.cost,
    subsidy_percent:
      Number.isFinite(subsidy) && subsidy >= 0 && subsidy <= 100 ? subsidy : DEFAULT_LUNCH_SETTINGS.subsidy_percent,
    eating_days: eatingDays && eatingDays.length > 0 ? eatingDays : [...DEFAULT_LUNCH_SETTINGS.eating_days],
    voting_deadline: isValidDeadlineTime(value.voting_deadline)
      ? value.voting_deadline
      : DEFAULT_LUNCH_SETTINGS.voting_deadline,
    voting_enabled: typeof value.voting_enabled === "boolean" ? value.voting_enabled : true,
  }
}

/** Reads and normalizes lunch_settings from system_settings. */
export async function loadLunchSettings(client: SupabaseClient): Promise<LunchSettingsValue> {
  const { data } = await client.from("system_settings").select("value").eq("key", "lunch_settings").maybeSingle()
  return normalizeLunchSettings(data?.value)
}

/**
 * Resolves the absolute cut-off instant for a menu: its explicit
 * voting_deadline if the admin set one, otherwise the settings time applied
 * to the menu's own date in WAT.
 */
export function resolveVotingDeadline(
  menu: { date: string; voting_deadline: string | null },
  settings: Pick<LunchSettingsValue, "voting_deadline">
): Date {
  if (menu.voting_deadline) return new Date(menu.voting_deadline)
  return deadlineForDate(menu.date, settings.voting_deadline)
}

/** Builds the absolute instant for "HH:MM on this date, WAT". */
export function deadlineForDate(date: string, time: string): Date {
  const safeTime = isValidDeadlineTime(time) ? time : DEFAULT_LUNCH_SETTINGS.voting_deadline
  return new Date(`${date}T${safeTime}:00${WAT_OFFSET}`)
}

/**
 * Whether votes can still be cast or changed. A closed menu is closed
 * regardless of the clock; a published menu closes when the deadline passes.
 */
export function isVotingOpen(
  menu: { status: LunchMenuStatus; date: string; voting_deadline: string | null },
  settings: Pick<LunchSettingsValue, "voting_deadline">,
  now: Date = new Date()
): boolean {
  if (menu.status !== "published") return false
  return now.getTime() < resolveVotingDeadline(menu, settings).getTime()
}

/** Money split for one meal, given the configured cost and subsidy. */
export function lunchCostBreakdown(settings: Pick<LunchSettingsValue, "cost" | "subsidy_percent">) {
  const cost = Number(settings.cost)
  const companySubsidy = cost * (Number(settings.subsidy_percent) / 100)
  return {
    cost,
    companySubsidy,
    employeeDeduction: cost - companySubsidy,
  }
}

/**
 * Rolls per-user selections up into per-option counts, preserving group and
 * option ordering so the UI renders tallies in menu order.
 */
export function tallyVotes(groups: LunchMenuGroup[], votes: LunchVoteRecord[]): LunchOptionTally[] {
  const tallies = new Map<string, LunchOptionTally>()

  for (const group of groups) {
    for (const option of group.options) {
      tallies.set(option.id, {
        option_id: option.id,
        group_id: group.id,
        name: option.name,
        count: 0,
        voters: [],
      })
    }
  }

  for (const vote of votes) {
    for (const optionId of Object.values(vote.selections)) {
      const tally = tallies.get(optionId)
      if (!tally) continue
      tally.count += 1
      tally.voters.push({ user_id: vote.user_id, full_name: vote.full_name })
    }
  }

  return Array.from(tallies.values())
}
