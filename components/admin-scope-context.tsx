"use client"

import { createContext, useContext } from "react"
import type { AdminScopeMode } from "@/lib/admin/rbac"

/**
 * Serialisable subset of AdminScope that is safe to pass to client components.
 * Keep this flat — no functions, no SupabaseClient references.
 */
export interface ClientAdminScope {
  userId: string
  role: string
  scopeMode: AdminScopeMode
  managedDepartments: string[]
  managedDepartmentIds: string[]
  isDepartmentLead: boolean
  isAdminLike: boolean
}

const AdminScopeContext = createContext<ClientAdminScope | null>(null)

interface AdminScopeProviderProps {
  scope: ClientAdminScope
  children: React.ReactNode
}

export function AdminScopeProvider({ scope, children }: AdminScopeProviderProps) {
  return <AdminScopeContext.Provider value={scope}>{children}</AdminScopeContext.Provider>
}

/**
 * Returns the current user's admin scope. Must be used inside AdminScopeProvider.
 */
export function useAdminScope(): ClientAdminScope {
  const ctx = useContext(AdminScopeContext)
  if (!ctx) {
    throw new Error("useAdminScope must be used within AdminScopeProvider")
  }
  return ctx
}

/**
 * Returns the admin scope if available, or null. Safe to call outside a provider.
 */
export function useAdminScopeOptional(): ClientAdminScope | null {
  return useContext(AdminScopeContext)
}
