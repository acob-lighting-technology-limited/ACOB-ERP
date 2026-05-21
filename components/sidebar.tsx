"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
  Award,
  Calendar,
  Car,
  ChevronsUpDown,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  FileCode2,
  FileBarChart,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  User,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"
import { cn, formatName, getInitials } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { getRoleDisplayName } from "@/lib/permissions"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
import { normalizeDepartmentName } from "@/shared/departments"
import { useSidebar } from "./sidebar-context"

interface SidebarProps {
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
    lead_departments?: string[]
  }
  canAccessAdmin?: boolean
}

type NavSubChild = { name: string; href: string }
type NavChild = { name: string; href: string; children?: NavSubChild[] }
type NavItemDef = { name: string; href: string; icon: React.ElementType; children?: NavChild[] }

const navigation: NavItemDef[] = [
  { name: "Home", href: "/profile", icon: LayoutDashboard },
  { name: "Tasks", href: "/tasks", icon: ClipboardList },
  { name: "Help Desk", href: "/help-desk", icon: ClipboardList },
  {
    name: "Reports",
    href: "/reports",
    icon: FileBarChart,
    children: [
      {
        name: "General Meeting",
        href: "/reports/general-meeting",
        children: [
          { name: "Action Tracker", href: "/reports/general-meeting/action-tracker" },
          { name: "KSS", href: "/reports/general-meeting/kss" },
          { name: "Minutes of Meeting", href: "/reports/general-meeting/minutes-of-meeting" },
          { name: "Weekly Reports", href: "/reports/general-meeting/weekly-reports" },
        ],
      },
    ],
  },
  { name: "Assets", href: "/assets", icon: Package },
  { name: "Payments", href: "/payments", icon: CreditCard },
  {
    name: "Documentation",
    href: "/documentation",
    icon: FileText,
    children: [
      { name: "Internal", href: "/documentation/internal" },
      { name: "Department", href: "/documentation/department" },
    ],
  },
  { name: "Correspondence", href: "/correspondence", icon: FileCode2 },
  {
    name: "Tools",
    href: "/tools",
    icon: Wrench,
    children: [
      { name: "Signature", href: "/tools/signature" },
      { name: "Signature Anniversary", href: "/tools/signature-anniversary" },
      { name: "Job Description", href: "/tools/job-description" },
      { name: "Watermark", href: "/tools/watermark" },
    ],
  },
]

const NAV_ROUTE_ALIASES: Record<string, string[]> = {
  "/tools": ["/feedback"],
}

const hrNavigation: NavItemDef[] = [
  { name: "Leave", href: "/leave", icon: Calendar },
  { name: "Attendance", href: "/attendance", icon: Clock },
  { name: "Shared Resources", href: "/resources", icon: Car },
  {
    name: "PMS",
    href: "/pms",
    icon: Award,
    children: [
      { name: "Goals", href: "/pms/goals" },
      { name: "KPI", href: "/pms/kpi" },
      { name: "Reviews", href: "/pms/reviews" },
      { name: "Peer Feedback", href: "/pms/peer-feedback" },
      { name: "Development Plans", href: "/pms/development-plans" },
      { name: "Behaviour", href: "/pms/behaviour" },
      { name: "CBT", href: "/pms/cbt" },
      { name: "Attendance", href: "/pms/attendance" },
    ],
  },
]

export function Sidebar({ user, profile, canAccessAdmin }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [departmentCode, setDepartmentCode] = useState<string | null>(null)
  const { isCollapsed } = useSidebar()

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

  useEffect(() => {
    const event = new CustomEvent("sidebar-state-change", {
      detail: { isOpen: isMobileMenuOpen },
    })
    window.dispatchEvent(event)
  }, [isMobileMenuOpen])

  const [openSections, setOpenSections] = useState<Set<string>>(new Set())
  const [openSubSections, setOpenSubSections] = useState<Set<string>>(new Set())

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
    const allNav = [...navigation, ...hrNavigation]
    for (const item of allNav) {
      if (!item.children) continue
      for (const child of item.children) {
        const childActive = pathname === child.href || pathname.startsWith(child.href + "/")
        if (childActive) setOpenSections((prev) => new Set([...prev, item.href]))
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
  }, [pathname])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success("Logged out successfully")
    router.push("/auth/login")
  }

  const isNavItemActive = (href: string): boolean => {
    if (!pathname) return false
    if (pathname === href || pathname.startsWith(`${href}/`)) return true
    const aliases = NAV_ROUTE_ALIASES[href] || []
    return aliases.some((alias) => pathname === alias || pathname.startsWith(`${alias}/`))
  }

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

  const labelCls = cn(
    "min-w-0 overflow-hidden transition-[max-width,opacity] duration-300 ease-in-out",
    isCollapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100"
  )

  const sidebarJSX = (
    <>
      <div className={cn("transition-[padding] duration-300 ease-in-out", isCollapsed ? "px-2 py-2" : "px-3 py-2")} />

      <nav className="scrollbar-custom flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {[...navigation, null, ...hrNavigation].map((item, idx) => {
          if (item === null) {
            return isCollapsed ? (
              <div key="hr-divider" className="mx-1.5 my-1.5 border-t" />
            ) : (
              <p
                key="hr-divider"
                className="text-muted-foreground mt-2 mb-1 px-3 text-[11px] font-medium tracking-wider uppercase"
              >
                HR &amp; Attendance
              </p>
            )
          }

          const hasChildren = !isCollapsed && item.children && item.children.length > 0
          const isOpen = openSections.has(item.href)
          const isActive = isNavItemActive(item.href)
          const hasActiveChild = item.children?.some(
            (child) =>
              pathname === child.href ||
              pathname?.startsWith(child.href + "/") ||
              child.children?.some((gc) => pathname === gc.href || pathname?.startsWith(gc.href + "/"))
          )
          const highlighted = isActive || Boolean(hasActiveChild)
          const activeCls = "bg-primary text-primary-foreground shadow-sm"
          const inactiveCls = "text-muted-foreground hover:bg-accent hover:text-foreground"

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
                      className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", isOpen && "rotate-90")}
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
                        "flex items-center rounded-md transition-[padding,gap,background-color,color] duration-300 ease-in-out",
                        isCollapsed ? "justify-center px-2.5 py-2" : "gap-2.5 px-3 py-2",
                        "min-h-[36px] text-sm font-medium",
                        highlighted ? activeCls : inactiveCls
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className={labelCls}>{item.name}</span>
                    </Link>
                  </TooltipTrigger>
                  {isCollapsed && <TooltipContent side="right">{item.name}</TooltipContent>}
                </Tooltip>
              )}

              {hasChildren && isOpen && (
                <div className="mt-0.5 ml-3 space-y-0.5 border-l pl-2">
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
                          <div className="mt-0.5 ml-2 space-y-0.5 border-l pl-2">
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
      </nav>

      <div className="border-t px-2.5 py-2.5">
        <DropdownMenu>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "text-muted-foreground hover:text-foreground min-h-[52px] w-full text-sm transition-[padding,gap] duration-300 ease-in-out",
                      "justify-center px-2.5"
                    )}
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
                className="text-muted-foreground hover:text-foreground min-h-[52px] w-full justify-between px-3 text-sm transition-[padding,gap] duration-300 ease-in-out"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar className="ring-primary/10 h-7 w-7 shrink-0 ring-2">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                      {getInitials(user?.email, profile?.first_name, profile?.last_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className={labelCls}>
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
            className="z-[70] w-[var(--radix-dropdown-menu-trigger-width)] min-w-52"
          >
            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex w-full items-center gap-2">
                <User className="h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex w-full items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            {canAccessAdmin && (
              <DropdownMenuItem asChild>
                <Link href="/admin" className="flex w-full items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Go to Admin
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setShowLogoutConfirm(true)} className="flex items-center gap-2">
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
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? 80 : 256 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="bg-card hidden overflow-hidden border-r lg:fixed lg:top-16 lg:bottom-0 lg:flex lg:flex-col"
      >
        {sidebarJSX}
      </motion.aside>

      <>
        {/* Mobile overlay */}
        <div
          className={cn(
            "bg-background/80 fixed inset-0 z-[55] backdrop-blur-sm transition-opacity duration-300 lg:hidden",
            isMobileMenuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          )}
          onClick={() => setIsMobileMenuOpen(false)}
        />
        {/* Mobile sidebar — slides in from the LEFT */}
        <aside
          className={cn(
            "bg-card fixed inset-y-0 left-0 z-[60] flex w-64 flex-col border-r shadow-xl transition-transform duration-300 ease-out lg:hidden",
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
