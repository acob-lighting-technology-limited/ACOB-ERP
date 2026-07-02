"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn, formatName, getInitials } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ChevronsUpDown,
  ChevronRight,
  LayoutDashboard,
  Package,
  ClipboardList,
  FileText,
  ScrollText,
  LogOut,
  Settings,
  CreditCard,
  Calendar,
  Target,
  FileBarChart,
  FileCode2,
  Megaphone,
  Wrench,
  ShieldAlert,
  ShieldEllipsis,
  ShieldCheck,
  FlaskConical,
  User,
  Building2,
  Bot,
} from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useSidebar } from "@/components/sidebar-context"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { UserRole } from "@/types/database"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { motion } from "framer-motion"
import { normalizeDepartmentName } from "@/shared/departments"
import {
  canAccessRouteV2,
  resolveAdminRouteKeyV2,
  GRANTABLE_ADMIN_ROUTES,
  type AccessContextV2,
  type AdminRouteKeyV2,
} from "@/lib/admin/policy-v2"

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
    admin_routes?: string[] | null
    lead_departments?: string[]
  }
  adminScopeMode?: "global" | "lead"
  /**
   * When set, the sidebar knows it is rendered inside the /dept/[deptId]/ shell.
   * Used to:
   *  1. Switch nav links to /dept/[id]/... hrefs so navigation stays in the dept shell.
   *  2. Show a "Go to Admin" link in the account dropdown for admin-like users.
   */
  deptId?: string
  /**
   * When set (admin shell only), a "Dept Console" link is shown in the account
   * dropdown for admin+lead users so they can jump to their dept shell.
   */
  deptConsoleHref?: string
}

/**
 * Builds dept-scoped navigation for the /dept/[deptId]/ shell.
 * Hrefs point to /dept/[id]/... so clicking a nav item stays in the dept shell.
 * Only the pages that exist in the dept surface are included.
 */
function buildDeptNavigation(deptId: string): NavItem[] {
  const base = `/dept/${deptId}`
  return [
    {
      section: "overview",
      name: "Dashboard",
      href: base,
      icon: LayoutDashboard,
      roles: [],
    },
    {
      section: "management",
      name: "HR",
      href: `${base}/hr`,
      icon: Calendar,
      roles: [],
      children: [
        { name: "Employees", href: `${base}/hr/employees` },
        {
          name: "Attendance",
          href: `${base}/hr/attendance`,
          children: [{ name: "Records", href: `${base}/hr/attendance/records` }],
        },
        { name: "Daily Activity", href: `${base}/hr/reports/daily-activity` },
        { name: "Leave", href: `${base}/hr/leave` },
        { name: "Departments", href: `${base}/hr/departments` },
        { name: "Office Location", href: `${base}/hr/office-location` },
        {
          name: "PMS",
          href: `${base}/hr/pms`,
          children: [
            { name: "Analytics", href: `${base}/hr/pms/analytics` },
            { name: "Cycles", href: `${base}/hr/pms/cycles` },
            { name: "Goals", href: `${base}/hr/pms/goals` },
            { name: "KPI", href: `${base}/hr/pms/kpi` },
            { name: "Reviews", href: `${base}/hr/pms/reviews` },
            { name: "Peer Feedback", href: `${base}/hr/pms/peer-feedback` },
            { name: "Development Plans", href: `${base}/hr/pms/development-plans` },
            { name: "Behaviour", href: `${base}/hr/pms/behaviour` },
            { name: "Competencies", href: `${base}/hr/pms/competencies` },
            { name: "CBT", href: `${base}/hr/pms/cbt` },
            { name: "Attendance", href: `${base}/hr/pms/attendance` },
          ],
        },
      ],
    },
    {
      section: "management",
      name: "Finance",
      href: `${base}/finance`,
      icon: CreditCard,
      roles: [],
      children: [
        { name: "Payments", href: `${base}/finance/payments` },
        { name: "Bills", href: `${base}/finance/bills` },
        { name: "Invoices", href: `${base}/finance/invoices` },
        { name: "Reports", href: `${base}/finance/reports` },
      ],
    },
    {
      section: "management",
      name: "Tasks",
      href: `${base}/tasks`,
      icon: ClipboardList,
      roles: [],
    },
    {
      section: "operations",
      name: "Help Desk",
      href: `${base}/help-desk`,
      icon: ClipboardList,
      roles: [],
    },
    {
      section: "operations",
      name: "Assets",
      href: `${base}/assets`,
      icon: Package,
      roles: [],
      children: [{ name: "Issues", href: `${base}/assets/issues` }],
    },
    {
      section: "operations",
      name: "Correspondence",
      href: `${base}/correspondence`,
      icon: FileCode2,
      roles: [],
    },
    {
      section: "operations",
      name: "Communications",
      href: `${base}/communications`,
      icon: Megaphone,
      roles: [],
      children: [{ name: "Broadcast", href: `${base}/communications/broadcast` }],
    },
    {
      section: "operations",
      name: "Documentation",
      href: `${base}/documentation`,
      icon: FileText,
      roles: [],
      children: [
        { name: "Internal", href: `${base}/documentation/internal` },
        { name: "Department", href: `${base}/documentation/department` },
      ],
    },
    {
      section: "operations",
      name: "Feedback",
      href: `${base}/feedback`,
      icon: ScrollText,
      roles: [],
    },
    {
      section: "operations",
      name: "Reports",
      href: `${base}/reports`,
      icon: FileBarChart,
      roles: [],
      children: [{ name: "Weekly Reports", href: `${base}/reports/weekly` }],
    },
  ]
}

function normalizeAdminRoutes(routes: string[] | null | undefined): AdminRouteKeyV2[] {
  if (!Array.isArray(routes)) return []
  return Array.from(
    new Set(
      routes
        .map((value) =>
          String(value || "")
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    )
  ).filter((value): value is AdminRouteKeyV2 => GRANTABLE_ADMIN_ROUTES.includes(value as AdminRouteKeyV2))
}

type NavSubChild = { name: string; href: string }
type NavChild = { name: string; href: string; children?: NavSubChild[] }
type NavItem = {
  section: string
  name: string
  href: string
  icon: React.ElementType
  roles: string[]
  children?: NavChild[]
}

const adminNavigation: NavItem[] = [
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
    children: [
      { name: "Employees", href: "/admin/hr/employees" },
      { name: "Departments", href: "/admin/hr/departments" },
      { name: "Attendance", href: "/admin/hr/attendance" },
      { name: "Leave", href: "/admin/hr/leave" },
      { name: "Fleet", href: "/admin/hr/fleet" },
      { name: "Resources", href: "/admin/hr/resources" },
      {
        name: "PMS",
        href: "/admin/hr/pms",
        children: [
          { name: "Analytics", href: "/admin/hr/pms/analytics" },
          { name: "Cycles", href: "/admin/hr/pms/cycles" },
          { name: "Goals", href: "/admin/hr/pms/goals" },
          { name: "KPI", href: "/admin/hr/pms/kpi" },
          { name: "Reviews", href: "/admin/hr/pms/reviews" },
          { name: "Peer Feedback", href: "/admin/hr/pms/peer-feedback" },
          { name: "Development Plans", href: "/admin/hr/pms/development-plans" },
          { name: "Behaviour", href: "/admin/hr/pms/behaviour" },
          { name: "Competencies", href: "/admin/hr/pms/competencies" },
          { name: "CBT", href: "/admin/hr/pms/cbt" },
          { name: "Attendance", href: "/admin/hr/pms/attendance" },
        ],
      },
      { name: "Performance", href: "/admin/hr/performance" },
      { name: "Office Location", href: "/admin/hr/office-location" },
    ],
  },
  {
    section: "management",
    name: "Finance",
    href: "/admin/finance",
    icon: CreditCard,
    roles: ["developer", "super_admin", "admin"],
    children: [
      { name: "Payments", href: "/admin/finance/payments" },
      { name: "Bills", href: "/admin/finance/bills" },
      { name: "Invoices", href: "/admin/finance/invoices" },
      { name: "Reports", href: "/admin/finance/reports" },
      { name: "Orders", href: "/admin/purchasing/orders" },
      { name: "Receipts", href: "/admin/purchasing/receipts" },
      { name: "Suppliers", href: "/admin/purchasing/suppliers" },
    ],
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
    children: [
      {
        name: "General Meeting",
        href: "/admin/reports/general-meeting",
        children: [
          { name: "Action Tracker", href: "/admin/reports/general-meeting/action-tracker" },
          { name: "KSS", href: "/admin/reports/general-meeting/kss" },
          { name: "Minutes of Meeting", href: "/admin/reports/general-meeting/minutes-of-meeting" },
          { name: "Weekly Reports", href: "/admin/reports/general-meeting/weekly-reports" },
          { name: "Records", href: "/admin/reports/general-meeting/records" },
        ],
      },
    ],
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
    name: "Communications",
    href: "/admin/communications",
    icon: Megaphone,
    roles: ["developer", "super_admin", "admin"],
    children: [
      { name: "Broadcast", href: "/admin/communications/broadcast" },
      {
        name: "Meetings",
        href: "/admin/communications/meetings",
        children: [
          { name: "Mail", href: "/admin/communications/meetings/mail" },
          { name: "Reminders", href: "/admin/communications/meetings/reminders" },
        ],
      },
    ],
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
    children: [
      { name: "Internal", href: "/admin/documentation/internal" },
      { name: "Department", href: "/admin/documentation/department" },
    ],
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
    children: [
      { name: "Users", href: "/admin/settings/users" },
      { name: "Roles", href: "/admin/settings/roles" },
      { name: "Company", href: "/admin/settings/company" },
      { name: "Mail", href: "/admin/settings/mail" },
      { name: "Maintenance", href: "/admin/settings/maintenance" },
    ],
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
  {
    section: "dev",
    name: "ACOBot",
    href: "/admin/dev/acobot",
    icon: Bot,
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
  // Tools — feedback is now surfaced through tools
  "/admin/tools": ["/admin/feedback"],
  // HR — employees are sometimes accessed at /admin/employees (flat) in addition to /admin/hr/employees
  // Communications — correspondence is logically part of communications
}

export function AdminSidebar({ user, profile, adminScopeMode = "global", deptId, deptConsoleHref }: AdminSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
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

  const [openSections, setOpenSections] = useState<Set<string>>(new Set())
  const [openSubSections, setOpenSubSections] = useState<Set<string>>(new Set())
  const [departmentCode, setDepartmentCode] = useState<string | null>(null)

  const toggleSection = (href: string) => {
    setOpenSections((prev) => {
      if (prev.has(href)) return new Set<string>()
      return new Set<string>([href])
    })
  }

  const toggleSubSection = (href: string) => {
    setOpenSubSections((prev) => {
      if (prev.has(href)) return new Set<string>()
      return new Set<string>([href])
    })
  }

  useEffect(() => {
    if (!pathname) return
    // Use dept nav when in dept shell so the correct parent sections auto-expand.
    const nav = deptId ? buildDeptNavigation(deptId) : adminNavigation
    for (const item of nav) {
      if (!item.children) continue
      for (const child of item.children) {
        const childActive = pathname === child.href || pathname.startsWith(child.href + "/")
        if (childActive) {
          setOpenSections((prev) => new Set([...prev, item.href]))
        }
        if (child.children) {
          const grandchildActive = child.children.some(
            (gc) => pathname === gc.href || pathname.startsWith(gc.href + "/")
          )
          if (grandchildActive) {
            setOpenSections((prev) => new Set([...prev, item.href]))
            setOpenSubSections((prev) => new Set([...prev, child.href]))
          }
        }
      }
    }
  }, [pathname, deptId])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    toast.success("Logged out successfully")
    router.push("/auth/login")
  }

  const adminRoutes = useMemo(() => normalizeAdminRoutes(profile?.admin_routes), [profile?.admin_routes])
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
      adminRoutes,
      actingContext:
        adminScopeMode === "lead" ||
        (!["developer", "admin", "super_admin"].includes(String(profile.role).toLowerCase()) &&
          Boolean(profile.is_department_lead))
          ? "department_lead"
          : "global_admin",
      managedDepartments: Array.from(managedDepartmentSet),
    }
  }, [
    adminRoutes,
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

  // In the dept shell use dept-scoped hrefs; roles[] is empty so canAccessRoute
  // is bypassed — access is already guarded by requireDeptScope on the server.
  const activeNavigation = deptId ? buildDeptNavigation(deptId) : adminNavigation
  const filteredNavigation = deptId
    ? activeNavigation
    : activeNavigation.filter((item) => canAccessRoute(item.roles, item.href))
  const groupedNavigation = adminSections
    .map((section) => ({
      ...section,
      items: filteredNavigation.filter((item) => item.section === section.key),
    }))
    .filter((section) => section.items.length > 0)

  const isAdminNavItemActive = (href: string): boolean => {
    if (!pathname) return false
    // Exact-match only for root dashboard hrefs so they don't light up on every sub-page.
    if (href === "/admin" || (deptId && href === `/dept/${deptId}`)) return pathname === href
    if (pathname === href || pathname.startsWith(`${href}/`)) return true

    const aliases = ADMIN_ROUTE_ALIASES[href]
    if (aliases && aliases.some((alias) => pathname === alias || pathname.startsWith(`${alias}/`))) {
      return true
    }

    return false
  }

  // True for roles that can access the /admin shell (developer / admin / super_admin).
  const isAdminLikeUser = ["developer", "admin", "super_admin"].includes(String(profile?.role || "").toLowerCase())

  // After Phase 6, pure leads no longer enter /admin.
  // The isLead flag here only applies to admin+lead users in the admin shell.
  const isLead = Boolean(
    profile?.is_department_lead || (profile?.lead_departments && profile.lead_departments.length > 0)
  )
  useEffect(() => {
    let cancelled = false
    const departmentName = profile?.department ? normalizeDepartmentName(profile.department) : ""
    if (!departmentName) {
      setDepartmentCode(null)
      return
    }

    async function loadDepartmentCode() {
      try {
        const response = await fetch("/api/departments", { cache: "no-store" })
        if (!response.ok) return
        const payload = (await response.json().catch(() => null)) as {
          data?: Array<{ name?: string | null; department_code?: string | null }>
        } | null
        const rows = payload?.data || []
        const match = rows.find((row) => normalizeDepartmentName(String(row.name || "")) === departmentName)
        if (!cancelled) setDepartmentCode(match?.department_code || null)
      } catch {
        if (!cancelled) setDepartmentCode(null)
      }
    }

    void loadDepartmentCode()
    return () => {
      cancelled = true
    }
  }, [profile?.department])

  const accountName =
    profile?.first_name && profile?.last_name
      ? `${formatName(profile.first_name)} ${formatName(profile.last_name)}`
      : user?.email?.split("@")[0] || "Account"
  const accountDepartment = profile?.department
    ? `${departmentCode || formatName(profile.department)}${isLead ? " (Lead)" : ""}`
    : null
  const accountRole = profile?.role ? getRoleDisplayName(profile.role) : null

  const sidebarJSX = (
    <>
      {/* Empty space for logo (moved to navbar) */}
      <div className={cn("transition-[padding] duration-300 ease-in-out", isCollapsed ? "px-2 py-2" : "px-3 py-2")}>
        {/* Logo space maintained but empty */}
      </div>

      {/* Navigation */}
      <nav className="scrollbar-custom flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {groupedNavigation.map((section) => (
          <div key={section.key} className="space-y-0.5">
            {!isCollapsed && (
              <p className="text-muted-foreground px-3 pt-1 pb-1 text-[11px] font-semibold">{section.label}</p>
            )}
            {section.items.map((item) => {
              const hasChildren = !isCollapsed && item.children && item.children.length > 0
              const isOpen = openSections.has(item.href)
              const isActive = isAdminNavItemActive(item.href)
              const hasActiveChild = item.children?.some(
                (child) => pathname === child.href || pathname?.startsWith(child.href + "/")
              )
              const highlighted = isActive || Boolean(hasActiveChild)
              const activeCls =
                "bg-[var(--admin-primary)] text-white shadow-sm dark:text-[var(--admin-primary-foreground)]"
              const inactiveCls =
                "text-muted-foreground hover:bg-[var(--admin-accent-soft)] hover:text-[var(--admin-primary)]"

              return (
                <div key={item.name}>
                  {hasChildren ? (
                    <div
                      className={cn(
                        "flex min-h-[36px] items-center rounded-md text-sm font-medium transition-colors duration-150",
                        highlighted ? activeCls : inactiveCls
                      )}
                    >
                      <Link
                        href={item.href}
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="flex flex-1 items-center gap-2.5 px-3 py-2"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="flex-1 overflow-hidden whitespace-nowrap">{item.name}</span>
                      </Link>
                      <button
                        onClick={() => toggleSection(item.href)}
                        className="flex items-center px-2 py-2"
                        aria-label={isOpen ? "Collapse" : "Expand"}
                      >
                        <ChevronRight
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                            isOpen && "rotate-90"
                          )}
                        />
                      </button>
                    </div>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link
                          href={item.href}
                          onClick={() => setIsMobileMenuOpen(false)}
                          className={cn(
                            "flex min-h-[36px] items-center rounded-md transition-[padding,gap,background-color,color] duration-300 ease-in-out",
                            isCollapsed ? "justify-center px-2.5 py-2" : "gap-2.5 px-3 py-2",
                            "text-sm font-medium",
                            highlighted ? activeCls : inactiveCls
                          )}
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span
                            className={cn(
                              "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-in-out",
                              isCollapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100"
                            )}
                          >
                            {item.name}
                          </span>
                        </Link>
                      </TooltipTrigger>
                      {isCollapsed && <TooltipContent side="right">{item.name}</TooltipContent>}
                    </Tooltip>
                  )}

                  {hasChildren && isOpen && (
                    <div className="mt-0.5 ml-3 space-y-0.5 border-l border-[var(--admin-sidebar-border)] pl-2">
                      {item.children!.map((child) => {
                        const hasSubChildren = child.children && child.children.length > 0
                        const isSubOpen = openSubSections.has(child.href)
                        const isChildActive = pathname === child.href || pathname?.startsWith(child.href + "/")
                        const hasActiveGrandchild = child.children?.some(
                          (gc) => pathname === gc.href || pathname?.startsWith(gc.href + "/")
                        )
                        const childHighlighted = isChildActive || Boolean(hasActiveGrandchild)

                        return (
                          <div key={child.href}>
                            {hasSubChildren ? (
                              <div
                                className={cn(
                                  "flex min-h-[32px] items-center rounded-md text-sm font-medium transition-colors duration-150",
                                  childHighlighted ? activeCls : inactiveCls
                                )}
                              >
                                <Link
                                  href={child.href}
                                  onClick={() => setIsMobileMenuOpen(false)}
                                  className="flex flex-1 items-center px-2 py-1.5"
                                >
                                  {child.name}
                                </Link>
                                <button
                                  onClick={() => toggleSubSection(child.href)}
                                  className="flex items-center px-1.5 py-1.5"
                                  aria-label={isSubOpen ? "Collapse" : "Expand"}
                                >
                                  <ChevronRight
                                    className={cn(
                                      "h-3 w-3 shrink-0 transition-transform duration-200",
                                      isSubOpen && "rotate-90"
                                    )}
                                  />
                                </button>
                              </div>
                            ) : (
                              <Link
                                href={child.href}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={cn(
                                  "flex min-h-[32px] items-center rounded-md px-2 py-1.5 text-sm font-medium transition-colors duration-150",
                                  isChildActive ? activeCls : inactiveCls
                                )}
                              >
                                {child.name}
                              </Link>
                            )}

                            {hasSubChildren && isSubOpen && (
                              <div className="mt-0.5 ml-2 space-y-0.5 border-l border-[var(--admin-sidebar-border)] pl-2">
                                {child.children!.map((grandchild) => {
                                  const isGcActive =
                                    pathname === grandchild.href || pathname?.startsWith(grandchild.href + "/")
                                  return (
                                    <Link
                                      key={grandchild.href}
                                      href={grandchild.href}
                                      onClick={() => setIsMobileMenuOpen(false)}
                                      className={cn(
                                        "flex min-h-[28px] items-center rounded-md px-2 py-1 text-sm font-medium transition-colors duration-150",
                                        isGcActive ? activeCls : inactiveCls
                                      )}
                                    >
                                      {grandchild.name}
                                    </Link>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="border-t px-2.5 py-2.5">
        <DropdownMenu>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="text-muted-foreground min-h-[52px] w-full justify-center px-2.5 text-sm transition-[padding,gap,background-color,color] duration-300 ease-in-out hover:bg-[var(--admin-accent-soft)] hover:text-[var(--admin-primary)]"
                  >
                    <div className="flex items-center">
                      <Avatar className="ring-primary/10 h-7 w-7 shrink-0 ring-2">
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                          {getInitials(user?.email, profile?.first_name, profile?.last_name)}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">Account</TooltipContent>
            </Tooltip>
          ) : (
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="text-muted-foreground min-h-[52px] w-full justify-between px-3 text-sm transition-[padding,gap,background-color,color] duration-300 ease-in-out hover:bg-[var(--admin-accent-soft)] hover:text-[var(--admin-primary)]"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar className="ring-primary/10 h-7 w-7 shrink-0 ring-2">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                      {getInitials(user?.email, profile?.first_name, profile?.last_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={cn(
                      "min-w-0 overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out",
                      "max-w-full opacity-100"
                    )}
                  >
                    <p className="truncate text-left text-sm font-medium">{accountName}</p>
                    {(accountDepartment || accountRole) && (
                      <p className="truncate text-left text-xs opacity-75">
                        {[accountDepartment, accountRole].filter(Boolean).join(" • ")}
                      </p>
                    )}
                  </div>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
          )}
          <DropdownMenuContent
            align="end"
            side="top"
            className="z-[70] w-[var(--radix-dropdown-menu-trigger-width)] min-w-52 border-[var(--admin-sidebar-border)] bg-[var(--admin-sidebar-bg)]"
          >
            <DropdownMenuItem
              asChild
              className="cursor-pointer text-[var(--admin-sidebar-foreground)] focus:bg-[var(--admin-accent-soft)] focus:text-[var(--admin-primary)] data-[highlighted]:bg-[var(--admin-accent-soft)] data-[highlighted]:text-[var(--admin-primary)]"
            >
              <Link href="/profile" className="flex w-full items-center gap-2">
                <User className="h-4 w-4" />
                Go to Dashboard
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              asChild
              className="cursor-pointer text-[var(--admin-sidebar-foreground)] focus:bg-[var(--admin-accent-soft)] focus:text-[var(--admin-primary)] data-[highlighted]:bg-[var(--admin-accent-soft)] data-[highlighted]:text-[var(--admin-primary)]"
            >
              <Link href="/admin/settings" className="flex w-full items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            {!deptId && deptConsoleHref && (
              <DropdownMenuItem
                asChild
                className="cursor-pointer text-[var(--admin-sidebar-foreground)] focus:bg-[var(--admin-accent-soft)] focus:text-[var(--admin-primary)] data-[highlighted]:bg-[var(--admin-accent-soft)] data-[highlighted]:text-[var(--admin-primary)]"
              >
                <Link href={deptConsoleHref} className="flex w-full items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Dept Console
                </Link>
              </DropdownMenuItem>
            )}
            {deptId && isAdminLikeUser && (
              <DropdownMenuItem
                asChild
                className="cursor-pointer text-[var(--admin-sidebar-foreground)] focus:bg-[var(--admin-accent-soft)] focus:text-[var(--admin-primary)] data-[highlighted]:bg-[var(--admin-accent-soft)] data-[highlighted]:text-[var(--admin-primary)]"
              >
                <Link href="/admin" className="flex w-full items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Go to Admin
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => setShowLogoutConfirm(true)}
              className="flex cursor-pointer items-center gap-2 text-[var(--admin-sidebar-foreground)] focus:bg-[var(--admin-accent-soft)] focus:text-[var(--admin-primary)] data-[highlighted]:bg-[var(--admin-accent-soft)] data-[highlighted]:text-[var(--admin-primary)]"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
            "fixed inset-y-0 left-0 z-[60] flex w-64 flex-col border-r border-[var(--admin-sidebar-border)] bg-[var(--admin-sidebar-bg)] shadow-xl transition-transform duration-300 ease-out lg:hidden",
            isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          {sidebarJSX}
        </aside>
      </>
      <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm logout</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to logout?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>Logout</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
