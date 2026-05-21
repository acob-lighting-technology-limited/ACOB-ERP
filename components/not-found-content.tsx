"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/ui/container"
import { Home, ArrowLeft, LayoutDashboard, Users, ClipboardList, Mail } from "lucide-react"

export function NotFoundContent() {
  const router = useRouter()

  return (
    <div className="bg-background relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,0,0,0.02)_0%,transparent_50%)] dark:bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.02)_0%,transparent_50%)]"></div>
      <div className="bg-primary/5 absolute top-20 left-20 h-32 w-32 rounded-full blur-3xl"></div>
      <div className="bg-primary/5 absolute right-20 bottom-20 h-40 w-40 rounded-full blur-3xl"></div>

      <Container className="relative z-10 flex min-h-screen items-center justify-center px-4 py-8">
        <div className="mx-auto max-w-lg text-center">
          <div className="mb-8">
            <h1 className="from-primary to-primary/70 bg-linear-to-r bg-clip-text text-6xl leading-none font-black text-transparent select-none md:text-8xl">
              404
            </h1>
          </div>

          <div className="mb-8 space-y-4">
            <h2 className="text-foreground text-2xl font-bold md:text-3xl">Page Not Found</h2>
            <p className="text-muted-foreground text-base leading-relaxed md:text-lg">
              The page you&apos;re looking for doesn&apos;t exist or has been moved.
            </p>
          </div>

          <div className="mb-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/profile">
              <Button size="lg" className="w-full px-6 py-2 sm:w-auto">
                <Home className="mr-2 h-4 w-4" />
                Go to Home
              </Button>
            </Link>
            <Button size="lg" variant="outline" onClick={() => router.back()} className="w-full px-6 py-2 sm:w-auto">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go Back
            </Button>
          </div>

          <div className="bg-card/50 border-border rounded-xl border p-6 shadow-sm backdrop-blur-sm">
            <h3 className="text-foreground mb-4 text-lg font-semibold">Quick Links</h3>
            <div className="grid grid-cols-3 gap-3">
              <Link href="/profile" className="group">
                <div className="bg-muted/50 hover:bg-muted border-border rounded-lg border p-3 transition-colors">
                  <div className="bg-primary mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-md">
                    <LayoutDashboard className="text-primary-foreground h-4 w-4" />
                  </div>
                  <h4 className="text-foreground text-sm font-medium">Home</h4>
                </div>
              </Link>

              <Link href="/admin/users" className="group">
                <div className="bg-muted/50 hover:bg-muted border-border rounded-lg border p-3 transition-colors">
                  <div className="bg-primary mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-md">
                    <Users className="text-primary-foreground h-4 w-4" />
                  </div>
                  <h4 className="text-foreground text-sm font-medium">Users</h4>
                </div>
              </Link>

              <Link href="/tasks" className="group">
                <div className="bg-muted/50 hover:bg-muted border-border rounded-lg border p-3 transition-colors">
                  <div className="bg-primary mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-md">
                    <ClipboardList className="text-primary-foreground h-4 w-4" />
                  </div>
                  <h4 className="text-foreground text-sm font-medium">Tasks</h4>
                </div>
              </Link>
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground mb-3 text-sm">Need help?</p>
            <div className="flex flex-col items-center justify-center gap-4 text-sm sm:flex-row">
              <a
                href="mailto:info@acoblighting.com"
                className="text-primary hover:text-primary/80 flex items-center gap-2 transition-colors"
              >
                <Mail className="h-4 w-4" />
                info@acoblighting.com
              </a>
            </div>
          </div>
        </div>
      </Container>
    </div>
  )
}
