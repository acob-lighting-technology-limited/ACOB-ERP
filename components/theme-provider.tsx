"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>

// next-themes injects a <script> tag to set theme class before hydration
// to prevent dark/light theme flicker. React 19 logs a dev warning:
// "Encountered a script tag while rendering React component..."
// The inline script is intentional for SSR anti-flicker. Suppress this false positive in dev mode.
if (typeof window !== "undefined") {
  const filterScriptWarning = (originalFn: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      const msg = typeof args[0] === "string" ? args[0] : ""
      if (msg.includes("Encountered a script tag") || msg.includes("Scripts inside React components")) {
        return
      }
      originalFn(...args)
    }
  }

  console.error = filterScriptWarning(console.error)
  console.warn = filterScriptWarning(console.warn)
}

export function ThemeProvider({ children, scriptProps, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider scriptProps={{ id: "next-themes-script", ...scriptProps }} {...props}>
      {children}
    </NextThemesProvider>
  )
}
