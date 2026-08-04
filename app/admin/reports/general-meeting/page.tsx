"use client"

import Link from "next/link"
import { ClipboardList, FileText, ChevronRight, Presentation, Users, UserCheck } from "lucide-react"
import { PageWrapper, PageHeader } from "@/components/layout"
import { PageSection } from "@/components/ui/patterns"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { WeekSetupCard } from "./_components/week-setup-card"

export default function AdminGeneralMeetingReportsPage() {
  const reportCards = [
    {
      title: "Action Tracker Management",
      description: "Oversee project progress, track pending actions across all departments, and manage status updates.",
      href: "/admin/reports/general-meeting/action-tracker",
      icon: ClipboardList,
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-100 dark:bg-blue-900/30",
    },
    {
      title: "Weekly Reports Administration",
      description: "Review, manage, and export weekly status updates and performance summaries from all employees.",
      href: "/admin/reports/general-meeting/weekly-reports",
      icon: FileText,
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-100 dark:bg-green-900/30",
    },
    {
      title: "Knowledge Sharing Session",
      description: "Upload weekly Knowledge Sharing Session files and capture department and presenter details.",
      href: "/admin/reports/general-meeting/kss",
      icon: Presentation,
      color: "text-indigo-600 dark:text-indigo-400",
      bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
    },
    {
      title: "Minutes of Meeting",
      description: "Upload and store weekly Minutes of Meeting PDFs for reference and mailing.",
      href: "/admin/reports/general-meeting/minutes-of-meeting",
      icon: Users,
      color: "text-amber-600 dark:text-amber-400",
      bgColor: "bg-amber-100 dark:bg-amber-900/30",
    },
    {
      title: "Records",
      description: "Teams attendance reports and transcripts, auto-synced per meeting. Manage sync from here.",
      href: "/admin/reports/general-meeting/records",
      icon: UserCheck,
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
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
            <Link key={card.title} href={card.href} className="group">
              <Card className="hover:border-primary h-full border-2 transition-all hover:shadow-lg">
                <CardHeader className="flex flex-row items-center gap-4 pb-2">
                  <div
                    className={`${card.bgColor} ${card.color} flex h-12 w-12 items-center justify-center rounded-lg transition-transform group-hover:scale-110`}
                  >
                    <card.icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="group-hover:text-primary text-xl transition-colors">{card.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CardDescription className="text-sm leading-relaxed">{card.description}</CardDescription>
                  <div className="text-primary flex translate-x-[-10px] items-center text-sm font-medium opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100">
                    Open <ChevronRight className="ml-1 h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </PageSection>
    </PageWrapper>
  )
}
