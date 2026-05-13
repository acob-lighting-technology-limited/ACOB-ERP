import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import Image from "next/image"
import { getSeasonalLogoPaths } from "@/lib/seasonal-branding"

export default function SignUpSuccessPage() {
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
            <CardTitle className="text-3xl font-bold tracking-tight">Check Your Email</CardTitle>
            <CardDescription className="text-base">We&apos;ve sent you a confirmation link</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">
              Please check your email inbox and click the confirmation link to verify your account. Once confirmed, you
              can log in to access the employee portal.
            </p>
            <p className="text-muted-foreground text-sm">
              If you don&apos;t see the email, check your spam folder or try signing up again.
            </p>
            <Link href="/auth/login" className="block">
              <Button className="h-11 w-full text-base font-semibold">Back to Login</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
