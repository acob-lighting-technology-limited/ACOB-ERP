"use client"

import { usePathname } from "next/navigation"
import { Navbar } from "@/components/navbar"

interface HeaderWrapperProps {
  user?: {
    email?: string
    user_metadata?: {
      first_name?: string
    }
  }
  canAccessAdmin?: boolean
}

export function HeaderWrapper({ user, canAccessAdmin = false }: HeaderWrapperProps) {
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

  const isAdminMode = pathname?.startsWith("/admin")

  return <Navbar user={user} canAccessAdmin={canAccessAdmin} isAdminMode={isAdminMode} />
}
