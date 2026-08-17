import Link from "next/link"
import { IconFill } from "@/components/ui/icon-fill"
import { cn } from "@/lib/utils"
import { PageHeader, PageWrapper } from "@/components/layout"
import {
  Code2,
  ScrollText,
  ShieldEllipsis,
  ShieldAlert,
  FlaskConical,
  Bug,
  UserRoundCog,
  Bot,
  ChevronRight,
} from "lucide-react"

const sections = [
  {
    title: "Login Logs",
    description: "Track who logged in, when, from where, and with what auth method.",
    href: "/admin/dev/login-logs",
    icon: ScrollText,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    fill: "bg-blue-500",
    hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
    hoverText: "group-hover:text-blue-500",
    subLabel: "Auth & session logs",
  },
  {
    title: "Role Escalations",
    description: "Audit role elevations and sensitive permission transitions.",
    href: "/admin/dev/role-escalations",
    icon: ShieldEllipsis,
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
    fill: "bg-purple-500",
    hoverBorder: "hover:border-purple-500/60 dark:hover:border-purple-400/60",
    hoverText: "group-hover:text-purple-500",
    subLabel: "Permission audits",
  },
  {
    title: "Security Events",
    description: "Inspect suspicious or high-risk security-related audit events.",
    href: "/admin/dev/security-events",
    icon: ShieldAlert,
    color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    fill: "bg-red-500",
    hoverBorder: "hover:border-red-500/60 dark:hover:border-red-400/60",
    hoverText: "group-hover:text-red-500",
    subLabel: "Security audit trail",
  },
  {
    title: "UI Error Monitor",
    description: "Track runtime frontend errors captured globally across all pages.",
    href: "/admin/dev/ui-errors",
    icon: Bug,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    fill: "bg-amber-500",
    hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-400/60",
    hoverText: "group-hover:text-amber-500",
    subLabel: "Global error tracking",
  },
  {
    title: "Tests",
    description: "End-to-end flow tests for Leave, Help Desk, and Tasks — no account switching required.",
    href: "/admin/dev/tests",
    icon: FlaskConical,
    color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
    fill: "bg-teal-500",
    hoverBorder: "hover:border-teal-500/60 dark:hover:border-teal-400/60",
    hoverText: "group-hover:text-teal-500",
    subLabel: "End-to-end test runner",
  },
  {
    title: "Session Impersonation",
    description: "Switch into any account for end-to-end flow validation without shared passwords.",
    href: "/admin/dev/impersonation",
    icon: UserRoundCog,
    color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    fill: "bg-indigo-500",
    hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
    hoverText: "group-hover:text-indigo-500",
    subLabel: "Account validation tool",
  },
  {
    title: "ACOBot Conversations",
    description: "Review every question staff and website visitors asked ACOBot, its answer, and who asked it.",
    href: "/admin/dev/acobot",
    icon: Bot,
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    fill: "bg-emerald-500",
    hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
    hoverText: "group-hover:text-emerald-500",
    subLabel: "AI chat log inspector",
  },
]

export default function DevHomePage() {
  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="DEV Control Plane"
        description="Developer-only operational and security control surfaces, excluding shared system settings"
        icon={Code2}
        backLink={{ href: "/admin", label: "Back to Admin" }}
      />

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="group block">
            <div
              className={cn(
                "bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl",
                section.hoverBorder
              )}
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={section.icon}
                      fillColor={section.fill}
                      className={cn(
                        "h-9 w-9 rounded-lg border transition-transform duration-200 group-hover:scale-105",
                        section.color
                      )}
                      iconClassName="h-5 w-5"
                    />
                    <h3 className={cn("text-foreground text-base font-semibold transition-colors", section.hoverText)}>
                      {section.title}
                    </h3>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">{section.description}</p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">{section.subLabel}</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor={section.fill}
                  hoverTextClassName="group-hover:text-white"
                  className={cn(
                    "border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5",
                    section.hoverBorder
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
