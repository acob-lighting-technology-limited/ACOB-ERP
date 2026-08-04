import type { Metadata } from "next"
import LaunchClient from "./launch-client"

export const metadata: Metadata = {
  title: "Matrix — One platform. Every operation.",
  description:
    "Matrix is the enterprise workspace built for ACOB Lighting Technology Limited — unifying attendance, payroll, performance, correspondence, assets and more into one secure system.",
  openGraph: {
    title: "Matrix — One platform. Every operation.",
    description:
      "The enterprise workspace that now runs ACOB Lighting Technology Limited. Twenty modules, one secure system.",
    type: "website",
  },
}

// Public marketing / launch page. Exempted from auth in proxy.ts middleware allowlist.
export default function LaunchPage() {
  return <LaunchClient />
}
