"use client"

import Link from "next/link"
import { FileBarChart, ClipboardList, FileText, ChevronRight, Presentation, Users } from "lucide-react"
import { PageWrapper, PageHeader } from "@/components/layout"
import { PageSection } from "@/components/ui/patterns"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { cn } from "@/lib/utils"

export default function PortalGeneralMeetingPage() {
  const reportCards = [
    {
      title: "Weekly Reports",
      description: "View and submit weekly status updates and performance summaries for your department.",
      href: "/reports/general-meeting/weekly-reports",
      icon: FileText,
      tag: "Weekly",
      subLabel: "Department updates",
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      fill: "bg-emerald-500",
      hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
      hoverText: "group-hover:text-emerald-500",
    },
    {
      title: "Action Tracker",
      description: "Track project progress, pending actions, and update completion status for your team.",
      href: "/reports/general-meeting/action-tracker",
      icon: ClipboardList,
      tag: "Active",
      subLabel: "Project progress & actions",
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      fill: "bg-blue-500",
      hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
      hoverText: "group-hover:text-blue-500",
    },
    {
      title: "Knowledge Sharing Session",
      description: "Upload weekly Knowledge Sharing Session files and track who presented by department.",
      href: "/reports/general-meeting/kss",
      icon: Presentation,
      tag: "KSS",
      subLabel: "Weekly presentations & slides",
      color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
      fill: "bg-indigo-500",
      hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
      hoverText: "group-hover:text-indigo-500",
    },
    {
      title: "Minutes of Meeting",
      description: "Upload and access weekly Minutes of Meeting PDFs for future reference.",
      href: "/reports/general-meeting/minutes-of-meeting",
      icon: Users,
      tag: "MOM",
      subLabel: "PDF archives & logs",
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      fill: "bg-amber-500",
      hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-400/60",
      hoverText: "group-hover:text-amber-500",
    },
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="General Meeting"
        description="Access the documents and trackers that support your weekly general meeting."
        icon={FileBarChart}
        backLink={{ href: "/reports", label: "Back to Reports" }}
      />

      <PageSection title="Available Trackers & Reports">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
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
      </PageSection>
    </PageWrapper>
  )
}
