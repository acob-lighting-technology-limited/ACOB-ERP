import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { ErrorState } from "@/components/ui/patterns"
import Image from "next/image"
import { getSeasonalLogoPaths } from "@/lib/seasonal-branding"

export default function AuthErrorPage() {
  return (
    <div className="from-background via-background to-muted/20 flex min-h-screen w-full items-center justify-center bg-gradient-to-br p-4 md:p-6">
      <div className="w-full max-w-lg">
        <Card className="border-2 shadow-xl">
          <CardHeader className="space-y-3 pb-6 text-center">
            <div className="mb-2 flex justify-center">
              <Image
                src={getSeasonalLogoPaths("light").navbar}
                alt="ACOB Lighting"
                width={170}
                height={52}
                className="h-14 w-auto"
                priority
              />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">Authentication Error</CardTitle>
            <CardDescription className="text-base">Something went wrong during authentication</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ErrorState
              title="Something went wrong during authentication"
              description="Please try again. If the problem persists, contact support."
              className="border-0 bg-transparent p-0"
            />
            <div className="flex gap-2">
              <Link href="/auth/login" className="flex-1">
                <Button className="h-11 w-full text-base">Back to Login</Button>
              </Link>
              <Link href="/auth/sign-up" className="flex-1">
                <Button variant="outline" className="h-11 w-full bg-transparent text-base">
                  Sign Up
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
