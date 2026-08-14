import type { Metadata } from "next"
import { requireAdminSectionAccess } from "@/lib/admin/rbac"

export const metadata: Metadata = {
  title: "Onboarding | ACOB Lighting Technology Limited",
  description: "Track which staff accounts have signed in and which have never been used.",
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAdminSectionAccess("settings")
  return children
}
