"use client"

import Link from "next/link"
import { FileBarChart, ChevronRight, Users } from "lucide-react"
import { PageWrapper, PageHeader } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { cn } from "@/lib/utils"

export default function PortalReportsPage() {
  const reportCards = [
    {
      title: "General Meeting",
      description: "Open the weekly reports, action tracker, KSS, and minutes tools used for your general meeting.",
      href: "/reports/general-meeting",
      icon: Users,
      tag: "Hub",
      subLabel: "4 meeting tools",
      color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
      fill: "bg-indigo-500",
      hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
      hoverText: "group-hover:text-indigo-500",
    },
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Reports"
        description="Access project status reports, action tracking tools, and weekly performance summaries."
        icon={FileBarChart}
        backLink={{ href: "/profile", label: "Back to Dashboard" }}
      />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {reportCards.map((card) => (
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
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", card.color)}
                  >
                    {card.tag}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">{card.description}</p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">{card.subLabel}</span>
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
