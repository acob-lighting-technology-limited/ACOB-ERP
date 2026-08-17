import type { ComponentType, HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

interface IconFillProps extends HTMLAttributes<HTMLDivElement> {
  icon: ComponentType<{ className?: string }>
  /** Solid background color class for the fill, e.g. "bg-blue-500" */
  fillColor: string
  /** Size, shape (rounded-*), border, and rest-state bg/text/border classes for the container */
  className?: string
  /** Size and rest-state text color class for the icon itself */
  iconClassName?: string
  /** Icon text color once the fill has expanded, defaults to white */
  hoverTextClassName?: string
}

/**
 * Icon container that fills with a solid color on hover of an ancestor `.group`,
 * matching the ACOB-Website social-icon animation (scale-0 -> scale-100 circle/chip
 * behind the icon, icon crossfading to a light color on top).
 */
export function IconFill({
  icon: Icon,
  fillColor,
  className,
  iconClassName,
  hoverTextClassName = "group-hover:text-white",
  ...rest
}: IconFillProps) {
  return (
    <div className={cn("relative flex shrink-0 items-center justify-center overflow-hidden", className)} {...rest}>
      <div
        className={cn(
          "absolute inset-0 origin-center scale-0 rounded-[inherit] transition-transform duration-500 ease-out group-hover:scale-100",
          fillColor
        )}
      />
      <Icon className={cn("relative z-10 transition-colors duration-500", hoverTextClassName, iconClassName)} />
    </div>
  )
}
