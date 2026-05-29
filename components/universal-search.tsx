"use client"

import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { QUERY_KEYS } from "@/lib/query-keys"
import {
  Search,
  Loader2,
  User,
  Laptop,
  Package,
  ClipboardList,
  FileText,
  MessageSquare,
  LifeBuoy,
  CalendarDays,
  Mail,
  Banknote,
  Building2,
  MapPin,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useRouter, usePathname } from "next/navigation"

type SearchType =
  | "profile"
  | "device"
  | "asset"
  | "task"
  | "documentation"
  | "feedback"
  | "helpdesk"
  | "leave"
  | "correspondence"
  | "payment"
  | "department"
  | "office_location"

interface SearchResult {
  id: string
  type: SearchType
  title: string
  subtitle?: string
  description?: string
  href: string
  metadata?: Record<string, unknown>
}

interface UniversalSearchProps {
  isAdminMode?: boolean
}

const typeIcons: Record<SearchType, typeof User> = {
  profile: User,
  device: Laptop,
  asset: Package,
  task: ClipboardList,
  documentation: FileText,
  feedback: MessageSquare,
  helpdesk: LifeBuoy,
  leave: CalendarDays,
  correspondence: Mail,
  payment: Banknote,
  department: Building2,
  office_location: MapPin,
}

const typeLabels: Record<SearchType, string> = {
  profile: "Employee",
  device: "Device",
  asset: "Asset",
  task: "Task",
  documentation: "Documentation",
  feedback: "Feedback",
  helpdesk: "Help Desk",
  leave: "Leave",
  correspondence: "Correspondence",
  payment: "Payment",
  department: "Department",
  office_location: "Office Location",
}

async function performSearch(q: string, deptId?: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q })
  if (deptId) params.set("dept", deptId)
  const response = await fetch(`/api/search?${params.toString()}`)
  if (!response.ok) throw new Error("Search failed")
  const data = await response.json()
  return data.results || []
}

export function UniversalSearch({ isAdminMode = false }: UniversalSearchProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const router = useRouter()
  const pathname = usePathname()
  // When searching from inside the dept console (/dept/[id]/…), pass the dept
  // id so the API scopes results to that department and routes links there.
  const deptId = useMemo(() => pathname?.match(/^\/dept\/([^/]+)/)?.[1], [pathname])

  // Keyboard shortcut: Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === "Escape") {
        setOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const { data: results = [], isFetching: loading } = useQuery({
    queryKey: [QUERY_KEYS.search(debouncedQuery), deptId ?? "global"],
    queryFn: () => performSearch(debouncedQuery, deptId),
    enabled: open && debouncedQuery.trim().length > 0,
    staleTime: 30 * 1000,
  })

  const handleResultClick = (result: SearchResult) => {
    router.push(result.href)
    setOpen(false)
    setQuery("")
    setDebouncedQuery("")
  }

  return (
    <>
      <Button
        variant="outline"
        className={cn(
          "text-muted-foreground relative h-10 w-full justify-start text-sm sm:pr-12 md:w-64 lg:w-80",
          isAdminMode && "hover:opacity-90"
        )}
        style={
          isAdminMode
            ? {
                borderColor: "var(--navbar-admin-sidebar-border)",
                backgroundColor: "var(--navbar-admin-accent-soft)",
                color: "var(--navbar-admin-primary)",
              }
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        <Search className="mr-2 h-4 w-4" style={isAdminMode ? { color: "var(--navbar-admin-primary)" } : undefined} />
        <span>Search anything...</span>
        <kbd
          className={cn(
            "bg-muted pointer-events-none absolute top-1.5 right-1.5 hidden h-6 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none sm:flex",
            isAdminMode && "bg-transparent"
          )}
          style={
            isAdminMode
              ? {
                  borderColor: "var(--navbar-admin-sidebar-border)",
                  backgroundColor: "var(--navbar-admin-accent-soft)",
                  color: "var(--navbar-admin-primary)",
                }
              : undefined
          }
        >
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl p-0"
          style={isAdminMode ? { borderColor: "var(--navbar-admin-sidebar-border)" } : undefined}
        >
          <DialogHeader className="px-6 pt-6">
            <DialogTitle style={isAdminMode ? { color: "var(--navbar-admin-primary)" } : undefined}>Search</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-4">
            <div className="relative">
              <Search
                className={cn(
                  "text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2",
                  isAdminMode && ""
                )}
                style={isAdminMode ? { color: "var(--navbar-admin-primary)" } : undefined}
              />
              <Input
                placeholder="Search employees, assets, tasks, tickets, leave, correspondence, payments..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn("pl-9", isAdminMode && "focus-visible:ring-[var(--navbar-admin-primary)]")}
                style={isAdminMode ? { borderColor: "var(--navbar-admin-sidebar-border)" } : undefined}
                autoFocus
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
                  onClick={() => {
                    setQuery("")
                    setDebouncedQuery("")
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto px-6 pb-6">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
              </div>
            )}

            {!loading && query && results.length === 0 && (
              <div className="text-muted-foreground py-8 text-center text-sm">
                No results found for &quot;{query}&quot;
              </div>
            )}

            {!loading && !query && (
              <div className="text-muted-foreground py-8 text-center text-sm">Start typing to search...</div>
            )}

            {!loading && results.length > 0 && (
              <div className="space-y-1">
                {results.map((result) => {
                  const Icon = typeIcons[result.type]
                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => handleResultClick(result)}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                        isAdminMode
                          ? "border-amber-200/80 hover:border-amber-400/80 hover:bg-amber-50 dark:border-amber-900 dark:hover:border-amber-700 dark:hover:bg-amber-950/40"
                          : "hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <div
                        className={cn(
                          "bg-muted flex h-10 w-10 items-center justify-center rounded-md",
                          isAdminMode && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center gap-2">
                          <p className="truncate text-sm font-semibold">{result.title}</p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[11px]",
                              isAdminMode &&
                                "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                            )}
                          >
                            {typeLabels[result.type]}
                          </Badge>
                        </div>
                        {result.subtitle && <p className="text-muted-foreground truncate text-sm">{result.subtitle}</p>}
                        {result.description && (
                          <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">{result.description}</p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-muted-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100",
                          isAdminMode && "text-amber-700 dark:text-amber-300"
                        )}
                      >
                        Open
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
