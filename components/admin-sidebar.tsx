"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn, formatName } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  FileText,
  MessageSquare,
  ScrollText,
  LogOut,
  CreditCard,
  Calendar,
  Target,
  FileBarChart,
  FileCode2,
  Bell,
  Megaphone,
  Wrench,
  ShieldAlert,
  ShieldEllipsis,
  FlaskConical,
} from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useSidebar } from "@/components/sidebar-context"
import type { UserRole } from "@/types/database"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { motion, AnimatePresence } from "framer-motion"
import { normalizeDepartmentName } from "@/shared/departments"
import { canAccessRouteV2, resolveAdminRouteKeyV2, type AccessContextV2, type AdminDomain } from "@/lib/admin/policy-v2"

interface AdminSidebarProps {
  user?: {
    email?: string
    user_metadata?: {
      first_name?: string
      last_name?: string
    }
  }
  profile?: {
    first_name?: string
    last_name?: string
    department?: string
    role?: UserRole
    is_department_lead?: boolean
    admin_domains?: string[] | null
    lead_departments?: string[]
  }
  adminScopeMode?: "global" | "lead"
}

const ADMIN_DOMAINS: AdminDomain[] = ["hr", "finance", "assets", "reports", "tasks", "communications"]

function normalizeAdminDomains(domains: string[] | null | undefined): AdminDomain[] {
  if (!Array.isArray(domains)) return []
  const normalized = Array.from(
    new Set(
      domains
        .map((value) =>
          String(value || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).filter((value): value is AdminDomain => ADMIN_DOMAINS.includes(value as AdminDomain))
  return normalized
}

const adminNavigation = [
  {
    section: "overview",
    name: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "management",
    name: "HR",
    href: "/admin/hr",
    icon: Calendar,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "management",
    name: "Finance",
    href: "/admin/finance",
    icon: CreditCard,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "management",
    name: "Tasks",
    href: "/admin/tasks",
    icon: ClipboardList,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Help Desk",
    href: "/admin/help-desk",
    icon: ClipboardList,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Reports",
    href: "/admin/reports",
    icon: FileBarChart,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Correspondence",
    href: "/admin/correspondence",
    icon: FileCode2,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Tools",
    href: "/admin/tools",
    icon: Wrench,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Notifications",
    href: "/admin/notifications",
    icon: Bell,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Communications",
    href: "/admin/communications",
    icon: Megaphone,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Assets",
    href: "/admin/assets",
    icon: Package,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Documentation",
    href: "/admin/documentation",
    icon: FileText,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "operations",
    name: "Feedback",
    href: "/admin/feedback",
    icon: MessageSquare,
    roles: ["developer", "super_admin", "admin"],
  },
  {
    section: "compliance",
    name: "Audit Logs",
    href: "/admin/audit-logs",
    icon: ScrollText,
    roles: ["developer", "super_admin"],
  },
  {
    section: "compliance",
    name: "Settings",
    href: "/admin/settings",
    icon: Target,
    roles: ["developer", "super_admin"],
  },
  {
    section: "dev",
    name: "Login Logs",
    href: "/admin/dev/login-logs",
    icon: ScrollText,
    roles: ["developer"],
  },
  {
    section: "dev",
    name: "Role Escalations",
    href: "/admin/dev/role-escalations",
    icon: ShieldEllipsis,
    roles: ["developer"],
  },
  {
    section: "dev",
    name: "Security Events",
    href: "/admin/dev/security-events",
    icon: ShieldAlert,
    roles: ["developer"],
  },
  {
    section: "dev",
    name: "Tests",
    href: "/admin/dev/tests",
    icon: FlaskConical,
    roles: ["developer"],
  },
]
const adminSections = [
  { key: "overview", label: "Overview" },
  { key: "management", label: "Management" },
  { key: "operations", label: "Operations" },
  { key: "compliance", label: "Compliance" },
  { key: "dev", label: "DEV" },
]

const ADMIN_ROUTE_ALIASES: Record<string, string[]> = {
  // Finance — purchasing and payments have their own top-level prefixes
  "/admin/finance": ["/admin/purchasing"],
  // Assets — inventory lives at a separate prefix
  "/admin/assets": ["/admin/inventory"],
  // HR — employees are sometimes accessed at /admin/employees (flat) in addition to /admin/hr/employees
  // Communications — correspondence is logically part of communications
}

export function AdminSidebar({ user, profile, adminScopeMode = "global" }: AdminSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const { isCollapsed } = useSidebar()
  const supabase = createClient()

  // Listen for toggle event from navbar
  useEffect(() => {
    const handleToggle = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      setIsMobileMenuOpen((prev) => !prev)
    }
    window.addEventListener("toggle-mobile-sidebar", handleToggle)
    document.addEventListener("toggle-mobile-sidebar", handleToggle)
    return () => {
      window.removeEventListener("toggle-mobile-sidebar", handleToggle)
      document.removeEventListener("toggle-mobile-sidebar", handleToggle)
    }
  }, [])

  // Notify navbar of sidebar state changes
  useEffect(() => {
    const event = new CustomEvent("sidebar-state-change", {
      detail: { isOpen: isMobileMenuOpen },
    })
    window.dispatchEvent(event)
  }, [isMobileMenuOpen])

  const getInitials = (email?: string, firstName?: string, lastName?: string): string => {
    if (firstName && lastName) {
      return (firstName[0] + lastName[0]).toUpperCase()
    }
    if (!email) return "U"

    const localPart = email.split("@")[0]
    const parts = localPart.split(".")

    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }

    return localPart.substring(0, 2).toUpperCase()
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    toast.success("Logged out successfully")
    router.push("/auth/login")
  }

  const adminDomains = useMemo(() => normalizeAdminDomains(profile?.admin_domains), [profile?.admin_domains])
  const accessContext = useMemo<AccessContextV2 | null>(() => {
    if (!profile?.role) return null
    const managedDepartmentSet = new Set<string>()
    if (profile.department) {
      managedDepartmentSet.add(normalizeDepartmentName(profile.department))
    }
    for (const department of profile.lead_departments || []) {
      managedDepartmentSet.add(normalizeDepartmentName(department))
    }

    return {
      baseRole: String(profile.role).toLowerCase(),
      isDepartmentLead: Boolean(profile.is_department_lead),
      isAdminLike: ["developer", "admin", "super_admin"].includes(String(profile.role).toLowerCase()),
      adminDomains,
      actingContext:
        adminScopeMode === "lead" ||
        (!["developer", "admin", "super_admin"].includes(String(profile.role).toLowerCase()) &&
          Boolean(profile.is_department_lead))
          ? "department_lead"
          : "global_admin",
      managedDepartments: Array.from(managedDepartmentSet),
    }
  }, [
    adminDomains,
    adminScopeMode,
    profile?.department,
    profile?.is_department_lead,
    profile?.lead_departments,
    profile?.role,
  ])

  const canAccessRoute = (requiredRoles: string[], href: string) => {
    if (!profile?.role || !accessContext) return false
    // Legacy role arrays are no longer authoritative under RBAC V2.
    // Use centralized policy evaluation so department leads with base role "employee"
    // still see allowed admin routes.
    void requiredRoles
    return canAccessRouteV2(accessContext, resolveAdminRouteKeyV2(href))
  }

  const filteredNavigation = adminNavigation.filter((item) => canAccessRoute(item.roles, item.href))
  const groupedNavigation = adminSections
    .map((section) => ({
      ...section,
      items: filteredNavigation.filter((item) => item.section === section.key),
    }))
    .filter((section) => section.items.length > 0)

  const isAdminNavItemActive = (href: string): boolean => {
    if (!pathname) return false
    if (href === "/admin") return pathname === "/admin"
    if (pathname === href || pathname.startsWith(`${href}/`)) return true

    const aliases = ADMIN_ROUTE_ALIASES[href]
    if (aliases && aliases.some((alias) => pathname === alias || pathname.startsWith(`${alias}/`))) {
      return true
    }

    return false
  }

  const isLead = Boolean(
    profile?.is_department_lead || (profile?.lead_departments && profile.lead_departments.length > 0)
  )
  const isLeadMode = adminScopeMode === "lead"

  const sidebarJSX = (
    <>
      {/* Empty space for logo (moved to navbar) */}
      <div className={cn("transition-[padding] duration-300 ease-in-out", isCollapsed ? "px-2 py-2" : "px-3 py-2")}>
        {/* Logo space maintained but empty */}
      </div>

      {/* Admin Badge & User Profile - Fixed height container */}
      <div
        className={cn(
          "flex min-h-[80px] flex-col border-b py-2.5 transition-[padding,margin] duration-300 ease-in-out",
          isCollapsed ? "mx-0 items-center px-0" : "px-3"
        )}
      >
        {/* User Profile - Fixed height container */}
        <div
          className={cn(
            "flex shrink-0 items-center transition-[gap] duration-300 ease-in-out",
            isCollapsed ? "justify-center" : "gap-2.5"
          )}
        >
          <Avatar className={cn("ring-primary/10 shrink-0 ring-2", "h-9 w-9")}>
            <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
              {getInitials(user?.email, profile?.first_name, profile?.last_name)}
            </AvatarFallback>
          </Avatar>
          <AnimatePresence mode="wait">
            {!isCollapsed && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="min-w-0 flex-1 overflow-hidden"
              >
                <p className="text-foreground truncate text-sm font-semibold whitespace-nowrap">
                  {profile?.first_name && profile?.last_name
                    ? `${formatName(profile.first_name)} ${formatName(profile.last_name)}`
                    : user?.email?.split("@")[0]}
                </p>
                <p className="text-muted-foreground truncate text-xs whitespace-nowrap">
                  {`${profile?.department || "employee Member"}${isLead ? " (Lead)" : ""}`}
                </p>
                {profile?.role && (
                  <Badge
                    variant="outline"
                    className={cn("mt-0.5 text-xs whitespace-nowrap", getRoleBadgeColor(profile.role))}
                  >
                    {getRoleDisplayName(profile.role)}
                  </Badge>
                )}
                {/* {isLeadMode && (
                  <Badge variant="outline" className="mt-0.5 border-amber-300 bg-amber-500/10 text-amber-700">
                    Lead Filter ON
                  </Badge>
                )} */}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {isCollapsed && isLeadMode && (
          <Badge variant="outline" className="mt-1 border-amber-300 bg-amber-500/10 px-1 text-[10px] text-amber-700">
            LF
          </Badge>
        )}
      </div>

      {/* Navigation */}
      <nav className="scrollbar-custom flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {groupedNavigation.map((section) => (
          <div key={section.key} className="space-y-0.5">
            {!isCollapsed && (
              <p className="text-muted-foreground px-3 pt-1 pb-1 text-[11px] font-semibold">{section.label}</p>
            )}
            {section.items.map((item) => {
              const isActive = isAdminNavItemActive(item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={cn(
                    "flex min-h-[36px] items-center rounded-md transition-[padding,gap,background-color,color] duration-300 ease-in-out",
                    isCollapsed ? "justify-center px-2.5 py-2" : "gap-2.5 px-3 py-2",
                    "text-sm font-medium",
                    isActive
                      ? "bg-[var(--admin-primary)] text-white shadow-sm dark:text-[var(--admin-primary-foreground)]"
                      : "text-muted-foreground hover:bg-[var(--admin-accent-soft)] hover:text-[var(--admin-primary)]"
                  )}
                  title={isCollapsed ? item.name : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <AnimatePresence mode="wait">
                    {!isCollapsed && (
                      <motion.span
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: "auto", opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="overflow-hidden whitespace-nowrap"
                      >
                        {item.name}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Back to Dashboard & Logout */}
      <div className="space-y-1.5 border-t px-2.5 py-2.5">
        <Link href="/profile" className="block">
          <Button
            variant="outline"
            className={cn(
              "text-muted-foreground min-h-[36px] w-full text-sm transition-[padding,gap,background-color,color] duration-300 ease-in-out hover:bg-[var(--admin-accent-soft)] hover:text-[var(--admin-primary)]",
              isCollapsed ? "justify-center px-2.5" : "justify-start gap-2.5"
            )}
            title={isCollapsed ? "Back to Dashboard" : undefined}
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            <AnimatePresence mode="wait">
              {!isCollapsed && (
                <motion.span
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: "auto", opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="overflow-hidden whitespace-nowrap"
                >
                  Back to Dashboard
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </Link>
        <Button
          variant="outline"
          className={cn(
            "text-muted-foreground min-h-[36px] w-full text-sm transition-[padding,gap,background-color,color] duration-300 ease-in-out hover:bg-[var(--admin-accent-soft)] hover:text-[var(--admin-primary)]",
            isCollapsed ? "justify-center px-2.5" : "justify-start gap-2.5"
          )}
          onClick={handleLogout}
          title={isCollapsed ? "Logout" : undefined}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <AnimatePresence mode="wait">
            {!isCollapsed && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="overflow-hidden whitespace-nowrap"
              >
                Logout
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <motion.aside
        initial={false}
        animate={{
          width: isCollapsed ? 80 : 256,
        }}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 30,
        }}
        className="hidden overflow-hidden border-r border-[var(--admin-sidebar-border)] bg-[var(--admin-sidebar-bg)] lg:fixed lg:top-16 lg:bottom-0 lg:flex lg:flex-col"
      >
        {sidebarJSX}
      </motion.aside>

      {/* Mobile Header - Hidden, using navbar instead */}

      {/* Mobile Sidebar */}
      <>
        <div
          className={cn(
            "bg-background/80 fixed inset-0 z-[55] backdrop-blur-sm transition-opacity duration-300 lg:hidden",
            isMobileMenuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          )}
          onClick={() => setIsMobileMenuOpen(false)}
        />
        <aside
          className={cn(
            "fixed inset-y-0 right-0 z-[60] flex w-64 flex-col border-l border-[var(--admin-sidebar-border)] bg-[var(--admin-sidebar-bg)] shadow-xl transition-transform duration-300 ease-out lg:hidden",
            isMobileMenuOpen ? "translate-x-0" : "translate-x-full"
          )}
        >
          {sidebarJSX}
        </aside>
      </>
    </>
  )
}
