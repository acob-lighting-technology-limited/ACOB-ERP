import type { ReactNode } from "react"
import { PageHeader, PageWrapper } from "@/components/layout"
import { SettingsNav } from "./_components/settings-nav"
import { Settings } from "lucide-react"

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Settings"
        description="Manage your profile, security, and notification preferences."
        icon={Settings}
        backLink={{ href: "/profile", label: "Back to Home" }}
      />
      <SettingsNav />
      <div className="pt-2">{children}</div>
    </PageWrapper>
  )
}
