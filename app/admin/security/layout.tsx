import type { Metadata } from "next"
import { requireAdminSectionAccess } from "@/lib/admin/rbac"

export const metadata: Metadata = {
  title: "Admin Security | ACOB Lighting Technology Limited",
  description: "Security and network activity in the admin dashboard.",
}

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAdminSectionAccess("security")
  return children
}
