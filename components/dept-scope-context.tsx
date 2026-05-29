"use client"

import { createContext, useContext } from "react"

/**
 * Serialisable subset of DeptScope that is safe to pass to client components.
 * Keep this flat — no functions, no SupabaseClient references.
 */
export interface ClientDeptScope {
  userId: string
  role: string
  deptId: string
  deptName: string
  isAdminLike: boolean
}

const DeptScopeContext = createContext<ClientDeptScope | null>(null)

interface DeptScopeProviderProps {
  scope: ClientDeptScope
  children: React.ReactNode
}

export function DeptScopeProvider({ scope, children }: DeptScopeProviderProps) {
  return <DeptScopeContext.Provider value={scope}>{children}</DeptScopeContext.Provider>
}

/**
 * Returns the current user's dept scope. Must be used inside DeptScopeProvider.
 */
export function useDeptScope(): ClientDeptScope {
  const ctx = useContext(DeptScopeContext)
  if (!ctx) {
    throw new Error("useDeptScope must be used within DeptScopeProvider")
  }
  return ctx
}

/**
 * Returns the dept scope if available, or null. Safe to call outside a provider.
 */
export function useDeptScopeOptional(): ClientDeptScope | null {
  return useContext(DeptScopeContext)
}
