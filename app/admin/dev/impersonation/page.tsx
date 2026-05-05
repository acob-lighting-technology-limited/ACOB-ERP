import { DataTablePage } from "@/components/ui/data-table"
import { requireAdminSectionAccess } from "@/lib/admin/rbac"
import { DevImpersonationContent } from "./impersonation-content"

export default async function DevImpersonationPage() {
  await requireAdminSectionAccess("dev")

  return (
    <DataTablePage
      title="Session Impersonation"
      description="Developer-only account switching for flow testing."
      backLink={{ href: "/admin/dev", label: "Back to DEV" }}
    >
      <DevImpersonationContent />
    </DataTablePage>
  )
}
