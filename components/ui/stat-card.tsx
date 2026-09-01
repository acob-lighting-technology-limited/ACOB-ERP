import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

type Variant = "default" | "compact" | "large"

interface Trend {
  value: number
  label?: string
}

interface StatCardProps {
  title: string
  value: string | number
  icon?: LucideIcon
  iconBgColor?: string
  iconColor?: string
  trend?: Trend
  variant?: Variant
  description?: string
  className?: string
}

export function StatCard({
  title,
  value,
  icon: Icon,
  iconBgColor = "bg-primary/10",
  iconColor = "text-primary",
  trend,
  variant = "default",
  description,
  className,
}: StatCardProps) {
  // `compact` scales down below `sm` rather than being one fixed size. A phone
  // still gets a real card — label *and* value, which a metric pill cannot give
  // you — at roughly two thirds the height, so four of them cost a strip rather
  // than a screenful and the list is still visible underneath.
  if (variant === "compact") {
    return (
      <Card className={cn("border", className)}>
        <CardContent className="p-2.5 sm:p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-muted-foreground truncate text-[10px] leading-tight font-medium sm:text-xs">{title}</p>
              <p className="text-foreground mt-0.5 truncate text-base leading-tight font-bold sm:text-xl">{value}</p>
            </div>
            {Icon && (
              <div className={cn("shrink-0 rounded-md p-1.5 sm:rounded-lg sm:p-2", iconBgColor)}>
                <Icon className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", iconColor)} />
              </div>
            )}
          </div>
          {trend && (
            <p className={cn("mt-1 text-[10px] sm:text-xs", trend.value >= 0 ? "text-green-600" : "text-red-600")}>
              {trend.value >= 0 ? "+" : ""}
              {trend.value}% {trend.label}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  if (variant === "large") {
    return (
      <Card className={cn("border", className)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3.5 pt-3.5 pb-2 sm:px-6 sm:pt-6 sm:pb-2">
          <CardTitle className="text-muted-foreground truncate text-xs font-medium sm:text-sm">{title}</CardTitle>
          {Icon && (
            <div className={cn("shrink-0 rounded-lg p-2 sm:p-2.5", iconBgColor)}>
              <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", iconColor)} />
            </div>
          )}
        </CardHeader>
        <CardContent className="px-3.5 pb-3.5 sm:px-6 sm:pb-6">
          <div className="text-xl font-bold sm:text-3xl">{value}</div>
          {description && <p className="text-muted-foreground mt-1 line-clamp-1 text-xs sm:text-sm">{description}</p>}
          {trend && (
            <p className={cn("mt-1 text-xs sm:mt-2 sm:text-sm", trend.value >= 0 ? "text-green-600" : "text-red-600")}>
              {trend.value >= 0 ? "+" : ""}
              {trend.value}% {trend.label}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn("border", className)}>
      {/* Mobile: compact horizontal row with clear, balanced typography */}
      <div className="flex items-center justify-between gap-2.5 px-3.5 py-2.5 sm:hidden">
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-xs font-medium">{title}</p>
          <p className="text-foreground line-clamp-2 text-sm leading-tight font-bold break-words" title={String(value)}>
            {value}
          </p>
          {description && <p className="text-muted-foreground line-clamp-1 text-[11px]">{description}</p>}
          {trend && (
            <p className={cn("text-[11px]", trend.value >= 0 ? "text-green-600" : "text-red-600")}>
              {trend.value >= 0 ? "+" : ""}
              {trend.value}% {trend.label}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn("shrink-0 rounded-lg p-1.5", iconBgColor)}>
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
        )}
      </div>

      {/* sm+ : desktop/tablet two-block layout */}
      <CardHeader className="hidden flex-row items-center justify-between space-y-0 px-6 pt-6 pb-2 sm:flex">
        <CardTitle className="text-muted-foreground truncate text-sm font-medium">{title}</CardTitle>
        {Icon && (
          <div className={cn("rounded-lg p-1.5", iconBgColor)}>
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
        )}
      </CardHeader>
      <CardContent className="hidden px-6 pb-6 sm:block">
        <div className="line-clamp-2 text-xl font-bold break-words lg:text-2xl" title={String(value)}>
          {value}
        </div>
        {description && <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">{description}</p>}
        {trend && (
          <p className={cn("mt-1 text-xs", trend.value >= 0 ? "text-green-600" : "text-red-600")}>
            {trend.value >= 0 ? "+" : ""}
            {trend.value}% {trend.label}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
