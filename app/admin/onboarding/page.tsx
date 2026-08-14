import { requireAdminSectionAccess } from "@/lib/admin/rbac"
import { OnboardingContent } from "./onboarding-content"

export default async function OnboardingPage() {
  await requireAdminSectionAccess("settings")

  return <OnboardingContent />
}
