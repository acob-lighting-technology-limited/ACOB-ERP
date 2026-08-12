"use client"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import {
  LogOut,
  Menu,
  X,
  User,
  ClipboardList,
  Calendar,
  Clock,
  Settings,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { NotificationBell } from "@/components/notification-bell"
import { UniversalSearch } from "@/components/universal-search"
import Image from "next/image"
import { useSidebarSafe } from "@/components/sidebar-context"
import { useTheme } from "next-themes"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { cn, getInitials } from "@/lib/utils"
import { getSeasonalLogoPaths, isTemporary2026LogoPeriod } from "@/lib/seasonal-branding"

interface NavbarProps {
  user?: {
    email?: string
    user_metadata?: {
      first_name?: string
      last_name?: string
    }
  }
  canAccessAdmin?: boolean
  isAdminMode?: boolean
}

export function Navbar({ user, canAccessAdmin = false, isAdminMode = false }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const router = useRouter()
  const pathname = usePathname()
  const isMaintenancePage = pathname.startsWith("/maintenance")
  const { resolvedTheme } = useTheme()
  const dashboardHref = isAdminMode ? "/admin" : "/profile"
  const logoWidth = 180
  const logoHeight = 180
  const logoClassName = "h-8 md:h-10 w-auto object-contain max-h-10 transition-all"

  // Get sidebar context safely (returns null if not available)
  const sidebarContext = useSidebarSafe()
  const { isCollapsed, setIsCollapsed } = sidebarContext || { isCollapsed: false, setIsCollapsed: () => {} }

  // Default to light logo for SSR to prevent hydration mismatch
  const logoSrc = !mounted
    ? getSeasonalLogoPaths("light").navbar
    : getSeasonalLogoPaths(resolvedTheme === "dark" ? "dark" : "light").navbar

  useEffect(() => {
    setMounted(true)
  }, [])

  // Navbar sits outside .admin-shell, so mirror scope tokens for scoped parts
  // (search surface + initials avatars) without changing the full navbar theme.
  useEffect(() => {
    if (!isAdminMode) return

    const applyScopedNavbarTokens = () => {
      const nav = navRef.current
      if (!nav) return
      const adminShell = document.querySelector(".admin-shell") as HTMLElement | null
      if (!adminShell) {
        nav.style.removeProperty("--navbar-admin-primary")
        nav.style.removeProperty("--navbar-admin-primary-foreground")
        nav.style.removeProperty("--navbar-admin-accent-soft")
        nav.style.removeProperty("--navbar-admin-sidebar-border")
        return
      }

      const shellStyles = getComputedStyle(adminShell)
      const primary = shellStyles.getPropertyValue("--admin-primary").trim()
      const primaryForeground = shellStyles.getPropertyValue("--admin-primary-foreground").trim()
      const accentSoft = shellStyles.getPropertyValue("--admin-accent-soft").trim()
      const sidebarBorder = shellStyles.getPropertyValue("--admin-sidebar-border").trim()

      if (primary) nav.style.setProperty("--navbar-admin-primary", primary)
      if (primaryForeground) nav.style.setProperty("--navbar-admin-primary-foreground", primaryForeground)
      if (accentSoft) nav.style.setProperty("--navbar-admin-accent-soft", accentSoft)
      if (sidebarBorder) nav.style.setProperty("--navbar-admin-sidebar-border", sidebarBorder)
    }

    applyScopedNavbarTokens()

    const observer = new MutationObserver(() => {
      applyScopedNavbarTokens()
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-scope", "class"],
    })

    return () => observer.disconnect()
  }, [isAdminMode, pathname])

  // Listen for sidebar state changes
  useEffect(() => {
    const handleSidebarStateChange = (e: Event) => {
      const customEvent = e as CustomEvent
      setIsSidebarOpen(customEvent.detail?.isOpen ?? false)
    }
    window.addEventListener("sidebar-state-change", handleSidebarStateChange)
    return () => {
      window.removeEventListener("sidebar-state-change", handleSidebarStateChange)
    }
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success("Logged out successfully")
    router.push("/auth/login")
  }

  const accountMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0 lg:h-11 lg:w-11">
          <Avatar className="h-10 w-10 lg:h-11 lg:w-11">
            <AvatarFallback
              className={cn(
                "text-sm font-semibold lg:text-base",
                isAdminMode
                  ? "bg-[var(--navbar-admin-primary,var(--admin-primary))] text-[var(--navbar-admin-primary-foreground,var(--admin-primary-foreground))]"
                  : "bg-primary text-primary-foreground"
              )}
            >
              {getInitials(user?.email, user?.user_metadata?.first_name, user?.user_metadata?.last_name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm leading-none font-medium">Account</p>
            <p className="text-muted-foreground text-xs leading-none">{user?.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!isMaintenancePage && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/profile" className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/tasks" className="cursor-pointer">
                <ClipboardList className="mr-2 h-4 w-4" />
                Task
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/help-desk" className="cursor-pointer">
                <ClipboardList className="mr-2 h-4 w-4" />
                Help Desk
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/leave" className="cursor-pointer">
                <Calendar className="mr-2 h-4 w-4" />
                Leave
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/attendance" className="cursor-pointer">
                <Clock className="mr-2 h-4 w-4" />
                Attendance
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            {canAccessAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin" className="flex cursor-pointer items-center">
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Admin
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <nav
      ref={navRef}
      className={cn(
        "fixed top-0 right-0 left-0 z-50 w-full overflow-visible border-b",
        isAdminMode
          ? "border-[var(--admin-sidebar-border)] bg-[var(--admin-sidebar-bg)] backdrop-blur-md"
          : "border-border bg-card"
      )}
    >
      <div className="flex h-16 w-full max-w-full items-center overflow-visible">
        {/* Left side - Collapse Button and Logo (aligned with sidebar edge) */}
        {sidebarContext && (
          <div className="hidden h-full items-center lg:flex">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-full w-10 rounded-none",
                isAdminMode &&
                  "hover:bg-[var(--navbar-admin-accent-soft,var(--admin-accent-soft))] hover:text-[var(--navbar-admin-primary,var(--admin-primary))]"
              )}
              onClick={() => setIsCollapsed(!isCollapsed)}
              title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {isCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </Button>
            <Link href={dashboardHref} className="flex h-full items-center px-4">
              <Image
                key={logoSrc}
                src={logoSrc}
                alt="ACOB Lighting"
                width={logoWidth}
                height={logoHeight}
                priority
                className={logoClassName}
              />
            </Link>
          </div>
        )}

        {/* Mobile - Logo only */}
        <div className="flex items-center gap-2 px-4 lg:hidden">
          <Link href={dashboardHref} className="flex items-center">
            <Image
              key={logoSrc}
              src={logoSrc}
              alt="ACOB Lighting"
              width={logoWidth}
              height={logoHeight}
              priority
              className={logoClassName}
            />
          </Link>
        </div>

        {/* Right side - search, notifications and user menu */}
        <div className="flex flex-1 items-center justify-end gap-2 overflow-visible px-2 sm:gap-4 sm:px-4 lg:px-8">
          <div className="hidden max-w-md flex-1 items-center gap-4 md:flex">
            {!isMaintenancePage && <UniversalSearch isAdminMode={isAdminMode} />}
          </div>
          <div className="hidden items-center gap-4 overflow-visible md:flex">
            {!isMaintenancePage && <NotificationBell isAdmin={isAdminMode} />}
            <ThemeToggle />
            {accountMenu}
          </div>

          <div className="flex items-center gap-2 overflow-visible md:hidden">
            {!isMaintenancePage && <NotificationBell isAdmin={isAdminMode} />}
            <ThemeToggle />
            {accountMenu}
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden"
            onClick={() => {
              // If sidebar context exists, toggle the sidebar instead of navbar menu
              if (sidebarContext) {
                const event = new CustomEvent("toggle-mobile-sidebar")
                window.dispatchEvent(event)
              } else {
                setIsOpen(!isOpen)
              }
            }}
          >
            {sidebarContext && isSidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu - Only show if no sidebar context */}
      {isOpen && !sidebarContext && (
        <div
          className={cn(
            "space-y-2 border-t py-4 md:hidden",
            isAdminMode ? "border-[var(--navbar-admin-sidebar-border,var(--admin-sidebar-border))]" : "border-border"
          )}
        >
          <div className={`flex items-center px-4 py-2 mb-2${isCollapsed ? "" : "gap-3"}`}>
            <Avatar className="h-10 w-10">
              <AvatarFallback
                className={cn(
                  "font-semibold",
                  isAdminMode
                    ? "bg-[var(--navbar-admin-primary,var(--admin-primary))] text-[var(--navbar-admin-primary-foreground,var(--admin-primary-foreground))]"
                    : "bg-primary text-primary-foreground"
                )}
              >
                {getInitials(user?.email, user?.user_metadata?.first_name, user?.user_metadata?.last_name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <p className="text-sm font-medium">Account</p>
              <p className="text-muted-foreground text-xs">{user?.email}</p>
            </div>
          </div>
          <Link
            href="/profile"
            className={cn(
              "flex items-center gap-2 rounded px-4 py-2 text-sm",
              isAdminMode
                ? "hover:bg-[var(--navbar-admin-accent-soft,var(--admin-accent-soft))] hover:text-[var(--navbar-admin-primary,var(--admin-primary))]"
                : "hover:bg-accent"
            )}
          >
            <User className="h-4 w-4" />
            Profile
          </Link>
          <Link
            href="/tasks"
            className={cn(
              "flex items-center gap-2 rounded px-4 py-2 text-sm",
              isAdminMode
                ? "hover:bg-[var(--navbar-admin-accent-soft,var(--admin-accent-soft))] hover:text-[var(--navbar-admin-primary,var(--admin-primary))]"
                : "hover:bg-accent"
            )}
          >
            <ClipboardList className="h-4 w-4" />
            Task
          </Link>
          <Link
            href="/help-desk"
            className={cn(
              "flex items-center gap-2 rounded px-4 py-2 text-sm",
              isAdminMode
                ? "hover:bg-[var(--navbar-admin-accent-soft,var(--admin-accent-soft))] hover:text-[var(--navbar-admin-primary,var(--admin-primary))]"
                : "hover:bg-accent"
            )}
          >
            <ClipboardList className="h-4 w-4" />
            Help Desk
          </Link>
          <Link
            href="/leave"
            className={cn(
              "flex items-center gap-2 rounded px-4 py-2 text-sm",
              isAdminMode
                ? "hover:bg-[var(--navbar-admin-accent-soft,var(--admin-accent-soft))] hover:text-[var(--navbar-admin-primary,var(--admin-primary))]"
                : "hover:bg-accent"
            )}
          >
            <Calendar className="h-4 w-4" />
            Leave
          </Link>
          <Link
            href="/attendance"
            className={cn(
              "flex items-center gap-2 rounded px-4 py-2 text-sm",
              isAdminMode
                ? "hover:bg-[var(--navbar-admin-accent-soft,var(--admin-accent-soft))] hover:text-[var(--navbar-admin-primary,var(--admin-primary))]"
                : "hover:bg-accent"
            )}
          >
            <Clock className="h-4 w-4" />
            Attendance
          </Link>
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-2 rounded px-4 py-2 text-sm",
              isAdminMode
                ? "hover:bg-[var(--navbar-admin-accent-soft,var(--admin-accent-soft))] hover:text-[var(--navbar-admin-primary,var(--admin-primary))]"
                : "hover:bg-accent"
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          {canAccessAdmin && (
            <>
              <div
                className={cn(
                  "my-2 border-t",
                  isAdminMode
                    ? "border-[var(--navbar-admin-sidebar-border,var(--admin-sidebar-border))]"
                    : "border-border"
                )}
              />
              <Link href="/admin" className="hover:bg-accent flex items-center gap-2 rounded px-4 py-2 text-sm">
                <ShieldCheck className="h-4 w-4" />
                Admin
              </Link>
            </>
          )}
          <div
            className={cn(
              "my-2 border-t",
              isAdminMode ? "border-[var(--navbar-admin-sidebar-border,var(--admin-sidebar-border))]" : "border-border"
            )}
          />
          <Button variant="ghost" size="sm" onClick={handleLogout} className="w-full justify-start">
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        </div>
      )}
    </nav>
  )
}
