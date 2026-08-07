"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Loader2, Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { apiFetch } from "@/lib/api-client"
import type { LunchMenu } from "@/lib/hr/lunch-voting"

interface DraftOption {
  name: string
  description: string
}

interface DraftGroup {
  name: string
  /** Compulsory by default; the admin can opt a category out per menu. */
  is_required: boolean
  options: DraftOption[]
}

interface LunchMenuBuilderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Passing a menu switches the dialog to edit mode. */
  menu?: LunchMenu | null
  /** Voting cut-off (HH:MM) from lunch settings — shown read-only, not editable here. */
  defaultDeadline: string
  defaultDate: string
  onSaved: () => void
}

function blankGroup(): DraftGroup {
  return { name: "", is_required: true, options: [{ name: "", description: "" }] }
}

/** Starts the form with N empty categories — the admin names each one. */
function blankGroups(count: number): DraftGroup[] {
  return Array.from({ length: count }, blankGroup)
}

function toDraftGroups(menu: LunchMenu): DraftGroup[] {
  return menu.groups.map((group) => ({
    name: group.name,
    is_required: group.is_required,
    options: group.options.map((option) => ({ name: option.name, description: option.description || "" })),
  }))
}

/** Extracts the WAT "HH:MM" from a menu's stored absolute deadline. */
function deadlineTimeOf(menu: LunchMenu): string | null {
  if (!menu.voting_deadline) return null
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(menu.voting_deadline))
}

/**
 * Builds a day's menu as an arbitrary number of admin-named categories. The
 * count and the names are entirely up to the admin — the only fixed rule is
 * that staff pick exactly one option per category, which the staff page walks
 * through one category at a time.
 */
export function LunchMenuBuilderDialog({
  open,
  onOpenChange,
  menu,
  defaultDeadline,
  defaultDate,
  onSaved,
}: LunchMenuBuilderDialogProps) {
  const isEdit = Boolean(menu)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState(defaultDate)
  const [title, setTitle] = useState("")
  const [groups, setGroups] = useState<DraftGroup[]>(() => blankGroups(1))
  // Off by default so the menu simply follows the Settings deadline. Turning it
  // on writes a value for this one day only.
  const [overrideDeadline, setOverrideDeadline] = useState(false)
  const [deadline, setDeadline] = useState(defaultDeadline)

  useEffect(() => {
    if (!open) return
    if (menu) {
      setDate(menu.date)
      setTitle(menu.title || "")
      const own = deadlineTimeOf(menu)
      setOverrideDeadline(own !== null)
      setDeadline(own ?? defaultDeadline)
      setGroups(toDraftGroups(menu))
    } else {
      setDate(defaultDate)
      setTitle("")
      setOverrideDeadline(false)
      setDeadline(defaultDeadline)
      setGroups(blankGroups(1))
    }
  }, [open, menu, defaultDate, defaultDeadline])

  function updateGroup(index: number, patch: Partial<DraftGroup>) {
    setGroups((prev) => prev.map((group, i) => (i === index ? { ...group, ...patch } : group)))
  }

  function updateOption(groupIndex: number, optionIndex: number, patch: Partial<DraftOption>) {
    setGroups((prev) =>
      prev.map((group, i) =>
        i === groupIndex
          ? { ...group, options: group.options.map((o, j) => (j === optionIndex ? { ...o, ...patch } : o)) }
          : group
      )
    )
  }

  async function save(publish: boolean) {
    setSaving(true)
    try {
      const payload = {
        date,
        title: title.trim() || null,
        deadline_time: overrideDeadline ? deadline : null,
        groups: groups.map((group) => ({
          name: group.name,
          is_required: group.is_required,
          options: group.options.map((option) => ({ name: option.name, description: option.description || null })),
        })),
        ...(publish ? { status: "published" as const } : {}),
      }

      const res = menu
        ? await apiFetch(`/api/admin/hr/lunch/menus/${menu.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await apiFetch("/api/admin/hr/lunch/menus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, status: publish ? "published" : "draft" }),
          })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save menu")

      toast.success(publish ? "Menu published — staff can vote now." : "Menu saved as draft.")
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save menu")
    } finally {
      setSaving(false)
    }
  }

  const hasBlankGroup = groups.some(
    (group) => !group.name.trim() || group.options.every((option) => !option.name.trim())
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Lunch Menu" : "New Lunch Menu"}</DialogTitle>
          <DialogDescription>
            A menu is one or more categories that you name yourself. Staff must pick{" "}
            <span className="font-semibold">exactly one option from every category</span> — never two from the same one,
            and never only some of them. One category on a rice day (White Rice / Jollof / Fried Rice); two when the
            meal pairs up (Egusi / Ogbono / Afang, then Fufu / Eba / Semovita); three or more if the day calls for it.
            Tick <span className="font-semibold">Optional</span> on a category (a drink, say) to let staff skip that
            one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="menu-date">Date</Label>
              <Input
                id="menu-date"
                type="date"
                value={date}
                disabled={isEdit}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="menu-title">Title (optional)</Label>
              <Input
                id="menu-title"
                value={title}
                placeholder="e.g. Friday Special"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>

          <div className="bg-muted/30 space-y-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="override-deadline"
                checked={overrideDeadline}
                onCheckedChange={(checked) => setOverrideDeadline(!!checked)}
              />
              <Label htmlFor="override-deadline" className="cursor-pointer text-xs">
                Use a different voting deadline for this day
              </Label>
            </div>

            {overrideDeadline ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="menu-deadline"
                  type="time"
                  value={deadline}
                  className="w-36"
                  onChange={(e) => setDeadline(e.target.value)}
                />
                <span className="text-muted-foreground text-xs">
                  This day only. Every other menu stays on {defaultDeadline}.
                </span>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                Voting closes at <span className="text-foreground font-semibold">{defaultDeadline}</span>, from
                Settings. Change it there and every menu follows.
              </p>
            )}
          </div>

          {groups.map((group, groupIndex) => (
            <div key={groupIndex} className="space-y-3 rounded-lg border-2 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-40 flex-1 space-y-1.5">
                  <Label className="text-xs">
                    Category {groupIndex + 1} — {group.is_required ? "staff must pick one" : "staff may skip this one"}
                  </Label>
                  <Input
                    value={group.name}
                    placeholder="Category name — e.g. Soup, Swallow, Rice, Protein, Drink"
                    onChange={(e) => updateGroup(groupIndex, { name: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox
                    id={`optional-${groupIndex}`}
                    checked={!group.is_required}
                    onCheckedChange={(checked) => updateGroup(groupIndex, { is_required: !checked })}
                  />
                  <Label htmlFor={`optional-${groupIndex}`} className="cursor-pointer text-xs whitespace-nowrap">
                    Optional
                  </Label>
                </div>
                {groups.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mb-1 text-red-500"
                    onClick={() => setGroups((prev) => prev.filter((_, i) => i !== groupIndex))}
                    aria-label="Remove group"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {group.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-center gap-2">
                    <Input
                      value={option.name}
                      placeholder="Option name"
                      className="flex-1"
                      onChange={(e) => updateOption(groupIndex, optionIndex, { name: e.target.value })}
                    />
                    <Input
                      value={option.description}
                      placeholder="Note (optional)"
                      className="flex-1"
                      onChange={(e) => updateOption(groupIndex, optionIndex, { description: e.target.value })}
                    />
                    {group.options.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-red-500"
                        onClick={() =>
                          updateGroup(groupIndex, { options: group.options.filter((_, j) => j !== optionIndex) })
                        }
                        aria-label="Remove option"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateGroup(groupIndex, { options: [...group.options, { name: "", description: "" }] })
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add option
                </Button>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setGroups((prev) => [...prev, blankGroup()])}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add another category
          </Button>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => void save(false)} disabled={saving || hasBlankGroup || !date}>
            Save draft
          </Button>
          <Button onClick={() => void save(true)} disabled={saving || hasBlankGroup || !date}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish for voting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
