"use client"

import { PageWrapper, PageHeader } from "@/components/layout"
import { IconFill } from "@/components/ui/icon-fill"
import { Mail, Megaphone, ChevronRight } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

export function CommunicationsPage({
  basePath,
  /**
   * Meeting tools are admin-only (policy route "communications.meetings") and
   * have no /dept/[id]/ equivalent, so the dept console hides the card rather
   * than linking leads to a route that 404s.
   */
  showMeetings = true,
}: { basePath?: string; showMeetings?: boolean } = {}) {
  const base = basePath ?? "/admin"
  const cards = [
    {
      title: "Broadcast",
      description: "Send department-branded broadcast emails with rich text content.",
      href: `${base}/communications/broadcast`,
      icon: Megaphone,
      color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
      fill: "bg-orange-500",
      hoverBorder: "hover:border-orange-500/60 dark:hover:border-orange-400/60",
      hoverText: "group-hover:text-orange-500",
    },
    ...(showMeetings
      ? [
          {
            title: "General Meeting",
            description: "Open general meeting communication tools (reports and reminders).",
            href: `${base}/communications/meetings`,
            icon: Mail,
            color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
            fill: "bg-indigo-500",
            hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
            hoverText: "group-hover:text-indigo-500",
          },
        ]
      : []),
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Communications"
        description="Manage outbound email communication workflows from one place."
        icon={Megaphone}
        backLink={{ href: base, label: "Back" }}
      />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.title} href={card.href} className="group block">
            <div
              className={cn(
                "bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl",
                card.hoverBorder
              )}
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={card.icon}
                      fillColor={card.fill}
                      className={cn(
                        "h-9 w-9 rounded-lg border transition-transform duration-200 group-hover:scale-105",
                        card.color
                      )}
                      iconClassName="h-5 w-5"
                    />
                    <h3 className={cn("text-foreground text-base font-semibold transition-colors", card.hoverText)}>
                      {card.title}
                    </h3>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">{card.description}</p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Outbound Tools</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor={card.fill}
                  hoverTextClassName="group-hover:text-white"
                  className={cn(
                    "border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5",
                    card.hoverBorder
                  )}
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </PageWrapper>
  )
}
