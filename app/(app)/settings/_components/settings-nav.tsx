"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { User, KeyRound, Bell } from "lucide-react"

const SETTINGS_TABS = [
  {
    name: "Profile",
    href: "/settings/profile",
    exactHref: "/settings",
    icon: User,
  },
  {
    name: "Security & Password",
    href: "/settings/security",
    icon: KeyRound,
  },
  {
    name: "Notifications",
    href: "/settings/notifications",
    icon: Bell,
  },
]

export function SettingsNav() {
  const pathname = usePathname()

  return (
    <div className="bg-muted text-muted-foreground inline-flex h-11 items-center justify-start rounded-lg p-1">
      {SETTINGS_TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = pathname === tab.href || (tab.exactHref && pathname === tab.exactHref)

        return (
          <Link
            key={tab.name}
            href={tab.href}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-all",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.name}
          </Link>
        )
      })}
    </div>
  )
}
