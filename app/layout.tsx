import type React from "react"
import type { Metadata, Viewport } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Analytics } from "@vercel/analytics/next"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { Suspense } from "react"
import { HeaderWrapper } from "@/components/header-wrapper"
import { SidebarProvider } from "@/components/sidebar-context"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope } from "@/lib/admin/rbac"
import { NProgressProvider } from "@/components/nprogress-provider"
import { NProgressHandler } from "@/components/nprogress-handler"
import { ClientErrorMonitor } from "@/components/telemetry/client-error-monitor"
import { QueryProvider } from "@/providers/query-provider"
import { SeasonalFaviconSwitcher } from "@/components/seasonal-favicon-switcher"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getAvatarSignedUrl } from "@/lib/profile-photos"
import "./globals.css"

export const metadata: Metadata = {
  title: "Matrix",
  description: "Matrix — the internal workspace platform for ACOB Lighting Technology Limited",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

async function HeaderWrapperWithData() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()

  // Only show header for authenticated users
  if (!data?.user) {
    return null
  }

  const canAccessAdmin = Boolean(await resolveAdminScope(supabase, data.user.id))

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { data: profile } = await dataClient
    .from("profiles")
    .select("avatar_path, first_name, last_name")
    .eq("id", data.user.id)
    .maybeSingle()

  const avatarUrl = profile?.avatar_path ? await getAvatarSignedUrl(dataClient, profile.avatar_path) : null

  // Serialize only the necessary user data to avoid hydration issues
  const userData = {
    email: data.user.email,
    user_metadata: {
      ...data.user.user_metadata,
      first_name: profile?.first_name || data.user.user_metadata?.first_name,
      last_name: profile?.last_name || data.user.user_metadata?.last_name,
      avatar_url: avatarUrl || data.user.user_metadata?.avatar_url || data.user.user_metadata?.picture,
    },
  }

  return <HeaderWrapper user={userData} canAccessAdmin={canAccessAdmin} avatarUrl={avatarUrl} />
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable} overflow-x-clip`}>
        <Suspense fallback={null}>
          {/* Theme follows system preference automatically (light/dark mode) */}
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="acob-theme">
            <QueryProvider>
              <SeasonalFaviconSwitcher />
              <SidebarProvider>
                <NProgressProvider />
                <NProgressHandler />
                <ClientErrorMonitor />
                <HeaderWrapperWithData />
                {/* Intentionally public routes outside (app): /employee/new, /maintenance */}
                {children}
                <Toaster />
              </SidebarProvider>
            </QueryProvider>
          </ThemeProvider>
        </Suspense>
        <Analytics />
      </body>
    </html>
  )
}
