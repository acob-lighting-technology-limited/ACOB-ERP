"use client"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { PageHeader, PageWrapper } from "@/components/layout"
import type { DataTablePageProps } from "./types"

/**
 * Standard full-page layout wrapper for ALL table pages in this app.
 *
 * Layout order (fixed — never rearrange):
 *   1. Page header  — title · icon · back link · action buttons (Add / Export / etc.)
 *   2. Tabs         — optional, only when a page has multiple named views
 *   3. Stats cards  — optional, key metrics at a glance
 *   4. Children     — <DataTable> (includes search, filters, toolbar, table, pagination)
 */
export function DataTablePage({
  title,
  description,
  icon,
  backLink,
  actions,
  tabs,
  activeTab,
  onTabChange,
  secondaryTabs,
  secondaryActiveTab,
  onSecondaryTabChange,
  stats,
  statBadges,
  statBadgeStyle = "pill",
  spacing,
  actionsPlacement = "inline-always",
  children,
}: DataTablePageProps) {
  return (
    <PageWrapper maxWidth="full" background="gradient" spacing={spacing}>
      {/* 1 ── Header */}
      <PageHeader
        title={title}
        description={description}
        icon={icon}
        backLink={backLink}
        actions={actions}
        actionsPlacement={actionsPlacement}
      />

      {/* 2 ── Tabs */}
      {tabs && tabs.length > 0 && activeTab && onTabChange && (
        <div className="mb-4">
          <div className="sm:hidden">
            <Select value={activeTab} onValueChange={onTabChange}>
              <SelectTrigger className="bg-muted/60 w-full font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tabs.map((tab) => (
                  <SelectItem key={tab.key} value={tab.key}>
                    <div className="flex items-center gap-2">
                      {tab.icon && <tab.icon className="text-muted-foreground h-4 w-4 shrink-0" />}
                      <span>{tab.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden sm:block">
            <Tabs value={activeTab} onValueChange={onTabChange}>
              <TabsList>
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key}>
                    {tab.icon && <tab.icon className="mr-1.5 h-4 w-4" />}
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      )}

      {secondaryTabs && secondaryTabs.length > 0 && secondaryActiveTab && onSecondaryTabChange && (
        <div className="mb-4">
          <div className="sm:hidden">
            <Select value={secondaryActiveTab} onValueChange={onSecondaryTabChange}>
              <SelectTrigger className="bg-muted/60 w-full font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {secondaryTabs.map((tab) => (
                  <SelectItem key={tab.key} value={tab.key}>
                    <div className="flex items-center gap-2">
                      {tab.icon && <tab.icon className="text-muted-foreground h-4 w-4 shrink-0" />}
                      <span>{tab.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden sm:block">
            <Tabs value={secondaryActiveTab} onValueChange={onSecondaryTabChange}>
              <TabsList>
                {secondaryTabs.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key}>
                    {tab.icon && <tab.icon className="mr-1.5 h-4 w-4" />}
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      )}

      {/* 3 ── Stats */}
      {statBadges && statBadges.length > 0 && (
        <div
          className={cn(
            "mb-4",
            // Both supplied = responsive pair: pills carry the metrics on a phone,
            // where four cards would fill the screen before any data, and the cards
            // take over where there is room for them.
            stats && "md:hidden",
            statBadgeStyle === "line"
              ? // One scrolling row rather than wrapping chips: four bordered pills
                // break 3+1 on a phone and strand the last one.
                "text-muted-foreground flex items-center gap-x-4 gap-y-1 overflow-x-auto text-xs whitespace-nowrap sm:flex-wrap sm:text-sm sm:whitespace-normal [&::-webkit-scrollbar]:hidden"
              : "flex flex-wrap gap-1.5"
          )}
        >
          {statBadges.map((badge) => {
            const interactive = Boolean(badge.onClick)
            const Icon = badge.icon
            const content = (
              <>
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                {badge.label}
              </>
            )

            if (statBadgeStyle === "line") {
              // Every metric is a chip, so the row reads as one set. An interactive
              // one is distinguished by hover/pressed state rather than by being the
              // only bordered item, which made the row look inconsistent.
              const chip = "bg-card inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5"
              return interactive ? (
                <button
                  key={badge.label}
                  type="button"
                  onClick={badge.onClick}
                  aria-pressed={badge.active}
                  className={cn(
                    chip,
                    "transition-colors",
                    badge.active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-input hover:bg-muted hover:text-foreground focus-visible:bg-muted",
                    badge.tone
                  )}
                >
                  {content}
                </button>
              ) : (
                <span key={badge.label} className={cn(chip, "border-input", badge.tone)}>
                  {content}
                </span>
              )
            }

            const pill = (
              <Badge
                variant="outline"
                className={cn(
                  "bg-card gap-1.5 rounded-full px-2.5 py-1 text-xs font-normal",
                  badge.active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : (badge.tone ?? "text-muted-foreground"),
                  interactive && "cursor-pointer transition-colors"
                )}
              >
                {content}
              </Badge>
            )

            return interactive ? (
              <button key={badge.label} type="button" onClick={badge.onClick} aria-pressed={badge.active}>
                {pill}
              </button>
            ) : (
              <span key={badge.label}>{pill}</span>
            )
          })}
        </div>
      )}
      {stats && <div className={cn("mb-4", statBadges && statBadges.length > 0 && "hidden md:block")}>{stats}</div>}

      {/* 4 ── Table content */}
      <div className="space-y-4">{children}</div>
    </PageWrapper>
  )
}
