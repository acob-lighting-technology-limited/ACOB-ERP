import Link from "next/link"
import { FileBarChart, ChevronRight } from "lucide-react"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { PageHeader, PageWrapper } from "@/components/layout"
import { PageSection } from "@/components/ui/patterns"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptReportsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Reports"
        description="Manage reports for this department."
        icon={FileBarChart}
        backLink={{ href: `/dept/${dept_id}`, label: "Back to Department" }}
      />
      <PageSection title="Reports" className="space-y-4">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Link href={`/dept/${dept_id}/reports/weekly`} className="group">
            <Card className="hover:border-primary h-full border-2 transition-all hover:shadow-lg">
              <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 transition-transform group-hover:scale-110 dark:bg-indigo-900/30 dark:text-indigo-400">
                  <FileBarChart className="h-6 w-6" />
                </div>
                <CardTitle className="group-hover:text-primary text-xl transition-colors">Weekly Reports</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <CardDescription>Review and manage weekly reports for this department.</CardDescription>
                <div className="text-primary flex items-center text-sm font-medium">
                  Open <ChevronRight className="ml-1 h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </PageSection>
    </PageWrapper>
  )
}
