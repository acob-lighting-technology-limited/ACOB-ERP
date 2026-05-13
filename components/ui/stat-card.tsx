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
  if (variant === "compact") {
    return (
      <Card className={cn("border", className)}>
        <CardContent className="p-2.5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-[10px] font-medium">{title}</p>
              <p className="text-foreground mt-0.5 text-lg font-bold">{value}</p>
            </div>
            {Icon && (
              <div className={cn("rounded-lg p-1.5", iconBgColor)}>
                <Icon className={cn("h-3.5 w-3.5", iconColor)} />
              </div>
            )}
          </div>
          {trend && (
            <p className={cn("mt-1 text-[10px]", trend.value >= 0 ? "text-green-600" : "text-red-600")}>
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
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-3 pt-3 pb-1.5 sm:px-6 sm:pt-6 sm:pb-2">
          <CardTitle className="text-muted-foreground truncate text-[10px] font-medium sm:text-sm">{title}</CardTitle>
          {Icon && (
            <div className={cn("rounded-lg p-1.5 sm:p-2", iconBgColor)}>
              <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", iconColor)} />
            </div>
          )}
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-6 sm:pb-6">
          <div className="text-lg font-bold sm:text-3xl">{value}</div>
          {description && (
            <p className="text-muted-foreground mt-1 line-clamp-1 text-[10px] sm:text-sm">{description}</p>
          )}
          {trend && (
            <p
              className={cn(
                "mt-1 text-[10px] sm:mt-2 sm:text-sm",
                trend.value >= 0 ? "text-green-600" : "text-red-600"
              )}
            >
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
      {/* Mobile: single horizontal row for max vertical density */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 sm:hidden">
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-[10px] font-medium">{title}</p>
          <p className="text-foreground text-base leading-tight font-bold">{value}</p>
          {description && <p className="text-muted-foreground line-clamp-1 text-[10px]">{description}</p>}
          {trend && (
            <p className={cn("text-[10px]", trend.value >= 0 ? "text-green-600" : "text-red-600")}>
              {trend.value >= 0 ? "+" : ""}
              {trend.value}% {trend.label}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn("shrink-0 rounded-lg p-1.5", iconBgColor)}>
            <Icon className={cn("h-3.5 w-3.5", iconColor)} />
          </div>
        )}
      </div>

      {/* sm+ : original two-block vertical layout */}
      <CardHeader className="hidden flex-row items-center justify-between space-y-0 px-6 pt-6 pb-2 sm:flex">
        <CardTitle className="text-muted-foreground truncate text-sm font-medium">{title}</CardTitle>
        {Icon && (
          <div className={cn("rounded-lg p-1.5", iconBgColor)}>
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
        )}
      </CardHeader>
      <CardContent className="hidden px-6 pb-6 sm:block">
        <div className="text-2xl font-bold">{value}</div>
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
