"use client"

import { PageWrapper, PageHeader } from "@/components/layout"
import { IconFill } from "@/components/ui/icon-fill"
import { Mail, Megaphone, ChevronRight, CalendarDays } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

export default function CommunicationsMeetingsPage() {
  const cards = [
    {
      title: "Reports",
      description: "Send meeting packs with weekly reports and Action Points one-time or recurring.",
      href: "/admin/communications/meetings/mail",
      icon: Mail,
      color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
      fill: "bg-indigo-500",
      hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
      hoverText: "group-hover:text-indigo-500",
    },
    {
      title: "Reminders",
      description: "Send meeting and knowledge-sharing reminders with scheduling controls.",
      href: "/admin/communications/meetings/reminders",
      icon: Megaphone,
      color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
      fill: "bg-orange-500",
      hoverBorder: "hover:border-orange-500/60 dark:hover:border-orange-400/60",
      hoverText: "group-hover:text-orange-500",
    },
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Communications: General Meeting"
        description="General meeting communication workflows (reports and reminders)."
        icon={CalendarDays}
        backLink={{ href: "/admin/communications", label: "Back to Communications" }}
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
                <span className="text-muted-foreground text-[11px] font-medium">Meeting Workflow</span>
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
