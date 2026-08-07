import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import type { LunchMenu, LunchMenuGroup, LunchMenuOption, LunchMenuStatus, LunchVoteRecord } from "./lunch-voting"

const log = logger("lunch-menu-server")

/**
 * Server-side loaders for lunch menus and their votes. These always run
 * against the service-role client from an API route, so RLS is a backstop
 * rather than the data path (see AGENTS.md, Database Security Standard).
 */

type MenuRow = {
  id: string
  date: string
  title: string | null
  status: LunchMenuStatus
  voting_deadline: string | null
  published_at: string | null
  closed_at: string | null
}

type GroupRow = {
  id: string
  menu_id: string
  name: string
  position: number
  is_required: boolean
}

type OptionRow = {
  id: string
  group_id: string
  name: string
  description: string | null
  position: number
  is_available: boolean
}

type VoteRow = {
  id: string
  menu_id: string
  user_id: string
  created_at: string
  updated_at: string
}

type SelectionRow = {
  vote_id: string
  group_id: string
  option_id: string
}

const MENU_COLUMNS = "id, date, title, status, voting_deadline, published_at, closed_at"

/** Attaches groups and their options to a bare menu row. */
export async function hydrateMenu(client: SupabaseClient, menu: MenuRow): Promise<LunchMenu> {
  const { data: groupRows } = await client
    .from("lunch_menu_groups")
    .select("id, menu_id, name, position, is_required")
    .eq("menu_id", menu.id)
    .order("position")

  const groups = (groupRows || []) as GroupRow[]
  const groupIds = groups.map((g) => g.id)

  let options: OptionRow[] = []
  if (groupIds.length > 0) {
    const { data: optionRows } = await client
      .from("lunch_menu_options")
      .select("id, group_id, name, description, position, is_available")
      .in("group_id", groupIds)
      .order("position")
    options = (optionRows || []) as OptionRow[]
  }

  const hydratedGroups: LunchMenuGroup[] = groups.map((group) => ({
    ...group,
    options: options.filter((o) => o.group_id === group.id) as LunchMenuOption[],
  }))

  return { ...menu, groups: hydratedGroups }
}

/** Loads the menu for a single date, or null when none exists. */
export async function loadMenuForDate(
  client: SupabaseClient,
  date: string,
  options: { includeDrafts?: boolean } = {}
): Promise<LunchMenu | null> {
  let query = client.from("lunch_menus").select(MENU_COLUMNS).eq("date", date)
  if (!options.includeDrafts) query = query.neq("status", "draft")

  const { data } = await query.maybeSingle()
  if (!data) return null

  return hydrateMenu(client, data as MenuRow)
}

/** Loads a menu by id, or null when it does not exist. */
export async function loadMenuById(client: SupabaseClient, menuId: string): Promise<LunchMenu | null> {
  const { data } = await client.from("lunch_menus").select(MENU_COLUMNS).eq("id", menuId).maybeSingle()
  if (!data) return null
  return hydrateMenu(client, data as MenuRow)
}

/**
 * Loads every vote on a menu with the voter's name attached. Names are always
 * included: the lunch poll deliberately shows who picked what.
 */
export async function loadVotesForMenu(client: SupabaseClient, menuId: string): Promise<LunchVoteRecord[]> {
  const { data: voteRows } = await client
    .from("lunch_votes")
    .select("id, menu_id, user_id, created_at, updated_at")
    .eq("menu_id", menuId)

  const votes = (voteRows || []) as VoteRow[]
  if (votes.length === 0) return []

  const [{ data: selectionRows }, { data: profileRows }] = await Promise.all([
    client
      .from("lunch_vote_selections")
      .select("vote_id, group_id, option_id")
      .in(
        "vote_id",
        votes.map((v) => v.id)
      ),
    client
      .from("profiles")
      .select("id, full_name, department")
      .in(
        "id",
        votes.map((v) => v.user_id)
      ),
  ])

  const selections = (selectionRows || []) as SelectionRow[]
  const profiles = (profileRows || []) as { id: string; full_name: string | null; department: string | null }[]
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  return votes
    .map((vote) => {
      const profile = profileById.get(vote.user_id)
      const voteSelections: Record<string, string> = {}
      for (const selection of selections) {
        if (selection.vote_id === vote.id) voteSelections[selection.group_id] = selection.option_id
      }
      return {
        user_id: vote.user_id,
        full_name: profile?.full_name || "Unknown",
        department: profile?.department || null,
        created_at: vote.created_at,
        updated_at: vote.updated_at,
        selections: voteSelections,
      }
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

/** One admin-named category, as submitted by the menu builder form. */
export interface MenuGroupInput {
  name?: string
  is_required?: boolean
  options?: { name?: string; description?: string | null }[]
}

export interface NormalizedMenuGroup {
  name: string
  is_required: boolean
  options: { name: string; description: string | null }[]
}

/**
 * Validates a submitted menu structure and strips the blank rows the builder
 * form sends for its empty inputs.
 */
export function normalizeMenuGroups(
  input: MenuGroupInput[] | undefined
): { value: NormalizedMenuGroup[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: "Add at least one category" }
  }

  const value: NormalizedMenuGroup[] = []
  for (const group of input) {
    const name = String(group?.name || "").trim()
    if (!name) return { error: "Every category needs a name" }

    const options = (Array.isArray(group.options) ? group.options : [])
      .map((option) => ({
        name: String(option?.name || "").trim(),
        description: option?.description ? String(option.description).trim() || null : null,
      }))
      .filter((option) => option.name.length > 0)

    if (options.length === 0) return { error: `"${name}" needs at least one option` }

    const seen = new Set<string>()
    for (const option of options) {
      const key = option.name.toLowerCase()
      if (seen.has(key)) return { error: `"${name}" has duplicate option "${option.name}"` }
      seen.add(key)
    }

    value.push({ name, is_required: group.is_required !== false, options })
  }

  return { value }
}

/** Replaces a menu's groups and options wholesale, preserving submitted order. */
export async function writeMenuGroups(client: SupabaseClient, menuId: string, groups: NormalizedMenuGroup[]) {
  const { error: clearError } = await client.from("lunch_menu_groups").delete().eq("menu_id", menuId)
  if (clearError) throw new Error(`Failed to clear existing groups: ${clearError.message}`)

  for (const [index, group] of groups.entries()) {
    const { data: groupRow, error: groupError } = await client
      .from("lunch_menu_groups")
      .insert({ menu_id: menuId, name: group.name, position: index, is_required: group.is_required })
      .select("id")
      .single()

    if (groupError || !groupRow) throw new Error(`Failed to create group "${group.name}": ${groupError?.message}`)

    const { error: optionError } = await client.from("lunch_menu_options").insert(
      group.options.map((option, optionIndex) => ({
        group_id: groupRow.id as string,
        name: option.name,
        description: option.description,
        position: optionIndex,
      }))
    )
    if (optionError) throw new Error(`Failed to add options to "${group.name}": ${optionError.message}`)
  }
}

/**
 * Tells active staff that a menu is open for voting. Best-effort: a
 * notification failure must never stop the menu from publishing.
 */
export async function notifyStaffOfMenu(client: SupabaseClient, menuId: string, date: string, actorId: string) {
  try {
    const { data: profiles } = await client.from("profiles").select("id").eq("employment_status", "active")

    const recipients = (profiles || []).map((p) => p.id as string)
    const label = new Date(`${date}T12:00:00+01:00`).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })

    // Chunked so a full-staff publish doesn't fire 90 round-trips at once.
    const chunkSize = 20
    for (let i = 0; i < recipients.length; i += chunkSize) {
      await Promise.allSettled(
        recipients.slice(i, i + chunkSize).map((userId) =>
          client.rpc("create_notification", {
            p_user_id: userId,
            p_type: "announcement",
            p_category: "system",
            p_title: "Lunch Menu Published",
            p_message: `The lunch menu for ${label} is open for voting. Pick what you want before the deadline.`,
            p_priority: "normal",
            p_link_url: "/lunch",
            p_actor_id: actorId,
            p_entity_type: "lunch_menu",
            p_entity_id: menuId,
          })
        )
      )
    }
  } catch (err) {
    log.error({ err: String(err) }, "lunch menu publish notification failed")
  }
}
