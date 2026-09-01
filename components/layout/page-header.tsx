import Link from "next/link"
import { ArrowLeft, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface BackLink {
  href: string
  label?: string
}

interface PageHeaderProps {
  /** Page title - displayed prominently */
  title: string
  /** Optional description shown below title */
  description?: string
  /** Optional icon displayed next to title */
  icon?: LucideIcon
  /** Back navigation link */
  backLink?: BackLink
  /** Actions (buttons, dropdowns) shown on the right */
  actions?: React.ReactNode
  /**
   * Where the action buttons sit relative to the title block.
   * - "inline"        beside the title from `sm` up, stacked below it on mobile
   * - "inline-always" beside the title at every width — for pages whose actions
   *                   collapse to icon-only buttons, where a dedicated mobile row
   *                   spends vertical space above the fold on ~80px of controls
   * - "below"         always on their own full-width row
   */
  actionsPlacement?: "inline" | "inline-always" | "below"
  /** Additional classes for the container */
  className?: string
}

/**
 * PageHeader provides a consistent header layout for all pages.
 * Includes title, optional description, icon, back link, and action buttons.
 *
 * @example
 * // Simple header
 * <PageHeader title="Dashboard" />
 *
 * @example
 * // Header with icon and description
 * <PageHeader
 *   title="Admin Dashboard"
 *   description="Manage your organization"
 *   icon={Shield}
 * />
 *
 * @example
 * // Header with back link and actions
 * <PageHeader
 *   title="Edit Product"
 *   backLink={{ href: "/admin/products", label: "Back to Products" }}
 *   actions={<Button>Save</Button>}
 * />
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  backLink,
  actions,
  actionsPlacement = "inline",
  className,
}: PageHeaderProps) {
  const renderActions = actions ? (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 pt-0.5",
        actionsPlacement === "below" && "w-full",
        actionsPlacement === "inline" && "w-full sm:w-auto sm:shrink-0",
        actionsPlacement === "inline-always" && "w-auto shrink-0 flex-nowrap"
      )}
    >
      {actions}
    </div>
  ) : null

  return (
    <div
      className={cn(
        actionsPlacement === "below" && "flex flex-col gap-3",
        actionsPlacement === "inline" && "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        actionsPlacement === "inline-always" && "flex flex-row items-start justify-between gap-3 sm:gap-4",
        className
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        {backLink && (
          <Link
            href={backLink.href}
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-xs transition-colors sm:text-sm"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
            {backLink.label || "Back"}
          </Link>
        )}
        <div className="flex items-center gap-2">
          {Icon && <Icon className="text-primary h-5 w-5 shrink-0 sm:h-6 sm:w-6 md:h-7 md:w-7" />}
          <h1 className="text-foreground text-xl font-bold sm:text-2xl md:text-3xl">{title}</h1>
        </div>
        {description && <p className="text-muted-foreground text-xs leading-normal sm:text-sm">{description}</p>}
      </div>
      {renderActions}
    </div>
  )
}
