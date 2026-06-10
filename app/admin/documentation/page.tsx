import { redirect } from "next/navigation"
import { getAdminDocumentationData, type AdminDocumentationDataResult } from "./data"
import { DocumentationSections } from "./documentation-sections"

export default async function AdminDocumentationPage() {
  const data = await getAdminDocumentationData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const pageData = data as Exclude<AdminDocumentationDataResult, { redirect: "/auth/login" | "/profile" }>

  return (
    <DocumentationSections
      basePath="/admin/documentation"
      documentationCount={pageData.documentation.length}
      departmentDocsEnabled={pageData.departmentDocs.enabled}
      backLink={{ href: "/admin", label: "Back to Admin" }}
    />
  )
}
