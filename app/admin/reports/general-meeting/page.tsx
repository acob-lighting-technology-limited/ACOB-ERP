"use client"

import Link from "next/link"
import { ClipboardList, FileText, ChevronRight, Presentation, Users, UserCheck } from "lucide-react"
import { PageWrapper, PageHeader } from "@/components/layout"
import { PageSection } from "@/components/ui/patterns"
import { IconFill } from "@/components/ui/icon-fill"
import { cn } from "@/lib/utils"
import { WeekSetupCard } from "./_components/week-setup-card"

export default function AdminGeneralMeetingReportsPage() {
  const reportCards = [
    {
      title: "Action Tracker Management",
      description: "Oversee project progress, track pending actions across all departments, and manage status updates.",
      href: "/admin/reports/general-meeting/action-tracker",
      icon: ClipboardList,
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      fill: "bg-blue-500",
      hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
      hoverText: "group-hover:text-blue-500",
      subLabel: "Project progress & actions",
    },
    {
      title: "Weekly Reports Administration",
      description: "Review, manage, and export weekly status updates and performance summaries from all employees.",
      href: "/admin/reports/general-meeting/weekly-reports",
      icon: FileText,
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      fill: "bg-emerald-500",
      hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
      hoverText: "group-hover:text-emerald-500",
      subLabel: "Department updates",
    },
    {
      title: "Knowledge Sharing Session",
      description: "Upload weekly Knowledge Sharing Session files and capture department and presenter details.",
      href: "/admin/reports/general-meeting/kss",
      icon: Presentation,
      color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
      fill: "bg-indigo-500",
      hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
      hoverText: "group-hover:text-indigo-500",
      subLabel: "Weekly presentations & slides",
    },
    {
      title: "Minutes of Meeting",
      description: "Upload and store weekly Minutes of Meeting PDFs for reference and mailing.",
      href: "/admin/reports/general-meeting/minutes-of-meeting",
      icon: Users,
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      fill: "bg-amber-500",
      hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-400/60",
      hoverText: "group-hover:text-amber-500",
      subLabel: "PDF archives & logs",
    },
    {
      title: "Records",
      description: "Teams attendance reports and transcripts, auto-synced per meeting. Manage sync from here.",
      href: "/admin/reports/general-meeting/records",
      icon: UserCheck,
      color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
      fill: "bg-teal-500",
      hoverBorder: "hover:border-teal-500/60 dark:hover:border-teal-400/60",
      hoverText: "group-hover:text-teal-500",
      subLabel: "Attendance & transcript sync",
    },
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="General Meeting"
        description="Manage the documents and trackers that support your weekly general meeting workflow."
        icon={Users}
        backLink={{ href: "/admin/reports", label: "Back to Reports" }}
      />

      <PageSection title="General Meeting" className="space-y-4">
        <WeekSetupCard />

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
