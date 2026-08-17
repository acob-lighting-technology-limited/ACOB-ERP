"use client"

import { IconFill } from "@/components/ui/icon-fill"
import { ShieldCheck, Users, ChevronRight } from "lucide-react"
import Link from "next/link"
import { PageWrapper, PageHeader } from "@/components/layout"
import { PageSection } from "@/components/ui/patterns"
import { cn } from "@/lib/utils"

export default function AdminReportsPage() {
  const reportCards = [
    {
      title: "General Meeting",
      description: "Open the weekly reports, action tracker, KSS, and minutes tools that support your general meeting.",
      href: "/admin/reports/general-meeting",
      icon: Users,
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
        description="Manage report content and meeting distribution workflows from one place."
        icon={ShieldCheck}
        backLink={{ href: "/admin", label: "Back to Admin" }}
      />

      <PageSection title="Reports" className="space-y-4">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">{card.description}</p>
                </div>
                <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                  <span className="text-muted-foreground text-[11px] font-medium">Meeting Hub</span>
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
      </PageSection>
    </PageWrapper>
  )
}
