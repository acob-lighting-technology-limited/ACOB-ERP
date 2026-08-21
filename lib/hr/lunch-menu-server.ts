import type { SupabaseClient } from "@supabase/supabase-js"
import { logger } from "@/lib/logger"
import { getAvatarSignedUrls } from "@/lib/profile-photos"
import type {
  LunchMenu,
  LunchMenuGroup,
  LunchMenuOption,
  LunchMenuStatus,
  LunchVoteRecord,
  LunchMenuViewRecord,
} from "./lunch-voting"

const log = logger("lunch-menu-server")

/**
 * Server-side loaders for lunch menus and their votes. These always run
 * against the service-role client from an API route, so RLS is a backstop
 * rather than the data path (see AGENTS.md, Database Security Standard).
 */

type MenuRow = {
  id: string
  date: string
  status: LunchMenuStatus
  voting_deadline: string | null
  published_at: string | null
  closed_at: string | null
  archived_at: string | null
}

type GroupRow = {
  id: string
  menu_id: string
  name: string | null
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
  is_eating: boolean
  created_at: string
  updated_at: string
}

type SelectionRow = {
  vote_id: string
  group_id: string
  option_id: string
}

const MENU_COLUMNS = "id, date, status, voting_deadline, published_at, closed_at, archived_at"

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

/**
 * The live menu for a single date, or null when there is none.
 *
 * A date can hold several rows — one live plus any number of cancelled ones —
 * so this always pins to the live one rather than assuming a single row.
 */
export async function loadMenuForDate(
  client: SupabaseClient,
  date: string,
  options: { includeDrafts?: boolean } = {}
): Promise<LunchMenu | null> {
  let query = client.from("lunch_menus").select(MENU_COLUMNS).eq("date", date).is("archived_at", null)
  if (!options.includeDrafts) query = query.neq("status", "draft")

  const { data } = await query.maybeSingle()
  if (!data) return null

  return hydrateMenu(client, data as MenuRow)
}

/**
 * Every published menu in a date window, oldest first. Staff vote ahead — a
 * menu for Friday is normally put up and voted on days earlier — so /lunch
 * offers each published day rather than only today's.
 */
export async function loadMenusInRange(client: SupabaseClient, from: string, to: string): Promise<LunchMenu[]> {
  const { data } = await client
    .from("lunch_menus")
    .select(MENU_COLUMNS)
    .neq("status", "draft")
    .is("archived_at", null)
    .gte("date", from)
    .lte("date", to)
    .order("date")

  const rows = (data || []) as MenuRow[]
  return Promise.all(rows.map((row) => hydrateMenu(client, row)))
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
    .select("id, menu_id, user_id, is_eating, created_at, updated_at")
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
      .select("id, full_name, department, avatar_path")
      .in(
        "id",
        votes.map((v) => v.user_id)
      ),
  ])

  const selections = (selectionRows || []) as SelectionRow[]
  const profiles = (profileRows || []) as {
    id: string
    full_name: string | null
    department: string | null
    avatar_path: string | null
  }[]
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  // Signed in one batch — the poll shows a stack of voter photos.
  const signedUrls = await getAvatarSignedUrls(
    client,
    profiles.map((p) => p.avatar_path).filter((path): path is string => Boolean(path))
  )

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
        avatar_url: profile?.avatar_path ? (signedUrls.get(profile.avatar_path) ?? null) : null,
        is_eating: vote.is_eating !== false,
        created_at: vote.created_at,
        updated_at: vote.updated_at,
        selections: voteSelections,
      }
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

/** One category, as submitted by the menu builder form. */
export interface MenuGroupInput {
  name?: string | null
  is_required?: boolean
  options?: { name?: string; description?: string | null }[]
}

export interface NormalizedMenuGroup {
  name: string | null
  is_required: boolean
  options: { name: string; description: string | null }[]
}

/**
 * Validates a submitted menu structure and strips the blank rows the builder
 * form sends for its empty inputs.
 *
 * Category names are only meaningful when a menu has several categories to
 * tell apart. A single-category menu stores no name at all, so a fixed-meal
 * day never has to invent a heading like "Today's Meal".
 */
export function normalizeMenuGroups(
  input: MenuGroupInput[] | undefined
): { value: NormalizedMenuGroup[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: "Add at least one dish" }
  }

  const needsNames = input.length > 1
  const value: NormalizedMenuGroup[] = []
  const seenNames = new Set<string>()

  for (const group of input) {
    const name = String(group?.name || "").trim()
    if (needsNames && !name) {
      return { error: "Name each category so staff can tell them apart (e.g. Soup, Swallow)" }
    }
    if (needsNames) {
      const key = name.toLowerCase()
      if (seenNames.has(key)) return { error: `Two categories are both called "${name}"` }
      seenNames.add(key)
    }

    const options = (Array.isArray(group.options) ? group.options : [])
      .map((option) => ({
        name: String(option?.name || "").trim(),
        description: option?.description ? String(option.description).trim() || null : null,
      }))
      .filter((option) => option.name.length > 0)

    const label = name || "This menu"
    if (options.length === 0) return { error: `${label} needs at least one dish` }

    const seen = new Set<string>()
    for (const option of options) {
      const key = option.name.toLowerCase()
      if (seen.has(key)) return { error: `${label} lists "${option.name}" twice` }
      seen.add(key)
    }

    value.push({ name: needsNames ? name : null, is_required: group.is_required !== false, options })
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

    if (groupError || !groupRow) throw new Error(`Failed to create category ${index + 1}: ${groupError?.message}`)

    const { error: optionError } = await client.from("lunch_menu_options").insert(
      group.options.map((option, optionIndex) => ({
        group_id: groupRow.id as string,
        name: option.name,
        description: option.description,
        position: optionIndex,
      }))
    )
    if (optionError) throw new Error(`Failed to add dishes to category ${index + 1}: ${optionError.message}`)
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

/**
 * Loads distinct view records for a list of menus, hydrated with profiles and avatars.
 */
export async function loadViewsForMenus(
  client: SupabaseClient,
  menuIds: string[]
): Promise<Map<string, LunchMenuViewRecord[]>> {
  const result = new Map<string, LunchMenuViewRecord[]>()
  for (const id of menuIds) result.set(id, [])
  if (menuIds.length === 0) return result

  const { data: viewRows, error: viewErr } = await client
    .from("lunch_menu_views")
    .select("menu_id, user_id, first_viewed_at, last_viewed_at, view_count")
    .in("menu_id", menuIds)

  if (viewErr) log.error({ err: viewErr.message }, "failed to load lunch menu views")

  const views = (viewRows || []) as {
    menu_id: string
    user_id: string
    first_viewed_at: string
    last_viewed_at: string
    view_count: number
  }[]
  if (views.length === 0) return result

  const userIds = Array.from(new Set(views.map((v) => v.user_id)))
  const { data: profileRows } = await client
    .from("profiles")
    .select("id, full_name, department, avatar_path")
    .in("id", userIds)

  const profiles = (profileRows || []) as {
    id: string
    full_name: string | null
    department: string | null
    avatar_path: string | null
  }[]
  const profileById = new Map(profiles.map((p) => [p.id, p]))

  const signedUrls = await getAvatarSignedUrls(
    client,
    profiles.map((p) => p.avatar_path).filter((path): path is string => Boolean(path))
  )

  for (const view of views) {
    const profile = profileById.get(view.user_id)
    const list = result.get(view.menu_id) || []
    list.push({
      user_id: view.user_id,
      full_name: profile?.full_name || "Unknown",
      department: profile?.department || null,
      avatar_url: profile?.avatar_path ? (signedUrls.get(profile.avatar_path) ?? null) : null,
      first_viewed_at: view.first_viewed_at,
      last_viewed_at: view.last_viewed_at,
      view_count: view.view_count || 1,
    })
    result.set(view.menu_id, list)
  }

  // Sort each menu's viewers by first_viewed_at descending (latest viewers first)
  for (const list of result.values()) {
    list.sort((a, b) => b.first_viewed_at.localeCompare(a.first_viewed_at))
  }

  return result
}
