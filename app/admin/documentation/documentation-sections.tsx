import Link from "next/link"
import { FileText, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader, PageWrapper, Section } from "@/components/layout"

interface DocumentationSectionsProps {
  basePath: string
  documentationCount: number
  departmentDocsEnabled: boolean
  backLink: { href: string; label: string }
}

export function DocumentationSections({
  basePath,
  documentationCount,
  departmentDocsEnabled,
  backLink,
}: DocumentationSectionsProps) {
  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Documentation"
        description="Manage internal writeups and department file repository"
        icon={FileText}
        backLink={backLink}
      />

      <Section title="Documentation Sections">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Internal Documentation
              </CardTitle>
              <CardDescription>Knowledge docs, writeups, and employee-created documentation.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/internal`}>
                <Button className="w-full">Open Internal Docs ({documentationCount})</Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                Department Documents
              </CardTitle>
              <CardDescription>Confidential department files stored in OneDrive.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/department`}>
                <Button className="w-full" disabled={!departmentDocsEnabled}>
                  {departmentDocsEnabled ? "Open Department Documents" : "Unavailable"}
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Section>
    </PageWrapper>
  )
}
