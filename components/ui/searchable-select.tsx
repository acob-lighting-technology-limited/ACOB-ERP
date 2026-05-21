"use client"

import * as React from "react"
import { Check, ChevronDown, Search } from "lucide-react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

interface SearchableSelectProps {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  options: { value: string; label: string; icon?: React.ReactNode }[]
  searchPlaceholder?: string
  icon?: React.ReactNode
  className?: string
  disabled?: boolean
  portal?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SearchableSelect({
  value,
  onValueChange,
  placeholder,
  options,
  searchPlaceholder = "Search...",
  icon,
  className,
  disabled = false,
  portal,
  open: controlledOpen,
  defaultOpen,
  onOpenChange,
}: SearchableSelectProps) {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen

  const setOpen = React.useCallback(
    (newOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(newOpen)
      }
      onOpenChange?.(newOpen)
    },
    [controlledOpen, onOpenChange]
  )
  const inputRef = React.useRef<HTMLInputElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [isInsideDialog, setIsInsideDialog] = React.useState(false)

  const filteredOptions = React.useMemo(() => {
    if (!searchQuery) return options
    return options.filter((option) => option.label.toLowerCase().includes(searchQuery.toLowerCase()))
  }, [options, searchQuery])

  const selectedOption = options.find((opt) => opt.value === value)

  // Clear search when dropdown closes
  React.useEffect(() => {
    if (!open) {
      setSearchQuery("")
    } else {
      // Focus the input when dropdown opens
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [open])

  React.useEffect(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const insideDialog = Boolean(trigger.closest("[role='dialog'], [data-radix-dialog-content]"))
    setIsInsideDialog(insideDialog)
  }, [open])

  const resolvedPortal = portal ?? !isInsideDialog

  // Shared content component to avoid duplication
  const renderContent = () => (
    <>
      <div className="border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 z-10 h-4 w-4 -translate-y-1/2 transform" />
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
      </div>
      <div
        className="max-h-[250px] overflow-y-auto overscroll-contain p-1"
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {filteredOptions.length > 0 ? (
          filteredOptions.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onValueChange(option.value)
                  setSearchQuery("")
                  setOpen(false)
                }}
                className={cn(
                  "focus:bg-accent focus:text-accent-foreground relative flex w-full items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  isSelected && "bg-accent/50"
                )}
              >
                <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                  {isSelected && <Check className="h-4 w-4" />}
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                  <span className="truncate">{option.label}</span>
                </div>
              </button>
            )
          })
        ) : (
          <div className="text-muted-foreground py-6 text-center text-sm">No results found</div>
        )}
      </div>
    </>
  )

  const contentClassName =
    "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-[300px] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border shadow-md"

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          ref={triggerRef}
          disabled={disabled}
          className={cn(
            "border-input ring-offset-background data-[placeholder]:text-muted-foreground focus:ring-ring flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {icon && <span className="flex-shrink-0">{icon}</span>}
            <span className="min-w-0 flex-1 truncate text-left">{selectedOption?.label || placeholder}</span>
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
            // Removed onPointerDownOutside and onFocusOutside preventDefault
            // to restore default outside-click dismissal behavior
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
          // Removed onPointerDownOutside and onFocusOutside preventDefault
          // to restore default outside-click dismissal behavior
        >
          {renderContent()}
        </PopoverPrimitive.Content>
      )}
    </PopoverPrimitive.Root>
  )
}
