import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Code2, ScrollText, ShieldEllipsis, ShieldAlert, FlaskConical, Bug, UserRoundCog } from "lucide-react"

const sections = [
  {
    title: "Login Logs",
    description: "Track who logged in, when, from where, and with what auth method.",
    href: "/admin/dev/login-logs",
    icon: ScrollText,
  },
  {
    title: "Role Escalations",
    description: "Audit role elevations and sensitive permission transitions.",
    href: "/admin/dev/role-escalations",
    icon: ShieldEllipsis,
  },
  {
    title: "Security Events",
    description: "Inspect suspicious or high-risk security-related audit events.",
    href: "/admin/dev/security-events",
    icon: ShieldAlert,
  },
  {
    title: "UI Error Monitor",
    description: "Track runtime frontend errors captured globally across all pages.",
    href: "/admin/dev/ui-errors",
    icon: Bug,
  },
  {
    title: "Tests",
    description: "End-to-end flow tests for Leave, Help Desk, and Tasks — no account switching required.",
    href: "/admin/dev/tests",
    icon: FlaskConical,
  },
  {
    title: "Session Impersonation",
    description: "Switch into any account for end-to-end flow validation without shared passwords.",
    href: "/admin/dev/impersonation",
    icon: UserRoundCog,
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

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.href}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <section.icon className="h-5 w-5" />
                {section.title}
              </CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={section.href} className={cn(buttonVariants({ variant: "default" }), "w-full")}>
                Open
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageWrapper>
  )
}
