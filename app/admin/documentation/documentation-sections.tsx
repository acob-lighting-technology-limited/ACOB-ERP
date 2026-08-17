import Link from "next/link"
import { FileText, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader, PageWrapper, Section } from "@/components/layout"
import { IconFill } from "@/components/ui/icon-fill"

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
          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={FileText}
                  fillColor="bg-blue-500"
                  className="h-8 w-8 rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 transition-transform duration-200 group-hover:scale-105 dark:text-blue-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-blue-500">Internal Documentation</span>
              </CardTitle>
              <CardDescription>Knowledge docs, writeups, and employee-created documentation.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${basePath}/internal`}>
                <Button className="w-full">Open Internal Docs ({documentationCount})</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="group">
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <IconFill
                  icon={FolderOpen}
                  fillColor="bg-emerald-500"
                  className="h-8 w-8 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 transition-transform duration-200 group-hover:scale-105 dark:text-emerald-400"
                  iconClassName="h-4 w-4"
                />
                <span className="transition-colors group-hover:text-emerald-500">Department Documents</span>
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
