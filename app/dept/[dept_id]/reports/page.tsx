import Link from "next/link"
import { FileBarChart, ChevronRight } from "lucide-react"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { PageHeader, PageWrapper } from "@/components/layout"
import { PageSection } from "@/components/ui/patterns"
import { IconFill } from "@/components/ui/icon-fill"

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
          <Link href={`/dept/${dept_id}/reports/weekly`} className="group block">
            <div className="bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/60 hover:shadow-xl dark:hover:border-indigo-400/60">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={FileBarChart}
                      fillColor="bg-indigo-500"
                      className="h-9 w-9 rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 transition-transform duration-200 group-hover:scale-105 dark:text-indigo-400"
                      iconClassName="h-5 w-5"
                    />
                    <h3 className="text-foreground text-base font-semibold transition-colors group-hover:text-indigo-500">
                      Weekly Reports
                    </h3>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Review and manage weekly reports for this department.
                </p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">Department Updates</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor="bg-indigo-500"
                  hoverTextClassName="group-hover:text-white"
                  className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5 hover:border-indigo-500/60 dark:hover:border-indigo-400/60"
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>
        </div>
      </PageSection>
    </PageWrapper>
  )
}
