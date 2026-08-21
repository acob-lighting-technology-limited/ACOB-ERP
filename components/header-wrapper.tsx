"use client"

import { usePathname } from "next/navigation"
import { Navbar } from "@/components/navbar"

interface HeaderWrapperProps {
  user?: {
    email?: string
    user_metadata?: {
      first_name?: string
      last_name?: string
      avatar_url?: string
      picture?: string
    }
  }
  canAccessAdmin?: boolean
  avatarUrl?: string | null
}

export function HeaderWrapper({ user, canAccessAdmin = false, avatarUrl }: HeaderWrapperProps) {
  const pathname = usePathname()

  // Don't show header on root page (shutdown page)
  if (pathname === "/") {
    return null
  }

  // Don't show header on auth pages
  const isAuthPage = pathname?.startsWith("/auth")
  if (isAuthPage) {
    return null
  }

  if (pathname?.startsWith("/birthday")) {
    return null
  }

  if (pathname?.startsWith("/cbt")) {
    return null
  }

  // Public launch / landing page has its own full-screen design
  if (pathname?.startsWith("/launch")) {
    return null
  }

  // Suspended account page is an isolated security lockout screen
  if (pathname?.startsWith("/suspended")) {
    return null
  }

  // Maintenance page is an isolated screen
  if (pathname?.startsWith("/maintenance")) {
    return null
  }

  const isAdminMode = pathname?.startsWith("/admin")

  return <Navbar user={user} canAccessAdmin={canAccessAdmin} isAdminMode={isAdminMode} avatarUrl={avatarUrl} />
}
