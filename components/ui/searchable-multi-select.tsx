"use client"

import * as React from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface SearchableMultiSelectProps {
  label: string
  icon?: React.ReactNode
  values: string[]
  options: { value: string; label: string; icon?: React.ReactNode }[]
  onChange: (values: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  portal?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SearchableMultiSelect({
  label,
  icon,
  values,
  options,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  className,
  disabled = false,
  portal,
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
}: SearchableMultiSelectProps) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [resolvedPortal, setResolvedPortal] = React.useState<boolean>(portal ?? true)

  const setOpen = React.useCallback(
    (newOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(newOpen)
      }
      onOpenChange?.(newOpen)
    },
    [controlledOpen, onOpenChange]
  )

  const filteredOptions = React.useMemo(() => {
    if (!searchQuery) return options
    return options.filter((option) => option.label.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [options, searchQuery])

  const toggleValue = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value))
    } else {
      onChange([...values, value])
    }
  }

  const removeValue = (value: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(values.filter((v) => v !== value))
  }

  const selectedOptions = options.filter((opt) => values.includes(opt.value))

  React.useEffect(() => {
    if (!open) {
      setSearchQuery("")
      return
    }
    setTimeout(() => {
      inputRef.current?.focus()
    }, 100)
  }, [open])

  React.useEffect(() => {
    if (portal !== undefined) {
      setResolvedPortal(portal)
      return
    }
    const triggerEl = triggerRef.current
    if (!triggerEl) return
    const inDialog = Boolean(triggerEl.closest('[role="dialog"]'))
    setResolvedPortal(!inDialog)
  }, [portal, open])

  const contentClassName =
    "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 flex max-h-[400px] w-[var(--radix-popover-trigger-width)] flex-col overflow-hidden rounded-md border shadow-md"

  const renderContent = () => (
    <>
      <div className="shrink-0 border-b p-2">
        <div className="mb-2 flex items-center gap-2">
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 transform" />
          <Input
            ref={inputRef}
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Escape") {
                setOpen(false)
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
        {selectedOptions.length > 0 && (
          // Capped and independently scrollable — otherwise a long selection
          // list grows unbounded and, since the outer popover clips overflow,
          // pushes the options list below out of view entirely (rather than
          // just scrolling), making it impossible to select anything past
          // however many already-selected badges fit.
          <div
            className="mt-2 flex max-h-[72px] flex-wrap gap-1 overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            {selectedOptions.map((option) => (
              <Badge
                key={option.value}
                variant="secondary"
                className="text-xs"
                onClick={(e) => removeValue(option.value, e)}
              >
                {option.label}
                <X className="ml-1 h-3 w-3" />
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto p-1"
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {filteredOptions.length > 0 ? (
          filteredOptions.map((option) => {
            const isSelected = values.includes(option.value)
            return (
              <div
                key={option.value}
                onClick={() => toggleValue(option.value)}
                className={cn(
                  "group relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-8 pl-8 text-sm transition-colors outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  "dark:hover:bg-accent dark:hover:text-foreground",
                  isSelected && "bg-accent/50"
                )}
              >
                <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
                  {isSelected ? (
                    <Check className="text-primary h-4 w-4" />
                  ) : (
                    <div className="border-input h-4 w-4 rounded border" />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                  <span className="truncate">{option.label}</span>
                </div>
              </div>
            )
          })
        ) : (
          <div className="text-muted-foreground py-6 text-center text-sm">No results found</div>
        )}
      </div>
    </>
  )

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          ref={triggerRef}
          disabled={disabled}
          className={cn(
            "border-input ring-offset-background focus:ring-ring flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {icon && <span className="flex-shrink-0">{icon}</span>}
            <span className="min-w-0 flex-1 truncate text-left">
              {selectedOptions.length > 0 ? (
                <span className="text-muted-foreground text-xs">{selectedOptions.length} selected</span>
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </span>
          </div>
          <ChevronDown className="ml-2 h-4 w-4 flex-shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>
      {resolvedPortal ? (
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            className={contentClassName}
            align="start"
            onOpenAutoFocus={(event) => {
              event.preventDefault()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
            }}
          >
            {renderContent()}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      ) : (
        <PopoverPrimitive.Content
          className={contentClassName}
          align="start"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
          }}
        >
          {renderContent()}
        </PopoverPrimitive.Content>
      )}
    </PopoverPrimitive.Root>
  )
}
