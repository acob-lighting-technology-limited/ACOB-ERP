import Link from "next/link"
import { redirect } from "next/navigation"
import { PageHeader, PageWrapper, Section } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { ChevronRight, FileText, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { getDocumentationData } from "./data"
import type { DocumentationAttachment } from "@/lib/documentation/sharepoint"

export interface Documentation {
  id: string
  title: string
  content: string
  category?: string
  tags?: string[]
  is_draft: boolean
  sharepoint_folder_path?: string | null
  sharepoint_text_file_path?: string | null
  sharepoint_attachments?: DocumentationAttachment[]
  created_at: string
  updated_at: string
}

export default async function DocumentationPage() {
  const data = await getDocumentationData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const docsData = data as {
    docs: Documentation[]
    departmentDocs: { enabled: boolean }
  }

  const docSections = [
    {
      title: "Internal Documentation",
      description: "Create and manage your internal work documentation and knowledge base.",
      href: "/documentation/internal",
      icon: FileText,
      tag: `${docsData.docs.length} Docs`,
      subLabel: "Internal knowledge base",
      enabled: true,
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      fill: "bg-blue-500",
      hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
      hoverText: "group-hover:text-blue-500",
    },
    {
      title: "Department Documents",
      description: "Browse your department's confidential OneDrive files and reference materials.",
      href: "/documentation/department",
      icon: FolderOpen,
      tag: docsData.departmentDocs.enabled ? "Available" : "Locked",
      subLabel: docsData.departmentDocs.enabled ? "OneDrive repository" : "Access disabled",
      enabled: docsData.departmentDocs.enabled,
      color: docsData.departmentDocs.enabled
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
        : "bg-muted text-muted-foreground border-muted-foreground/20",
      fill: "bg-emerald-500",
      hoverBorder: docsData.departmentDocs.enabled
        ? "hover:border-emerald-500/60 dark:hover:border-emerald-400/60"
        : "",
      hoverText: docsData.departmentDocs.enabled ? "group-hover:text-emerald-500" : "",
    },
  ]

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Documentation"
        description="Access internal knowledge docs and department file repository"
        icon={FileText}
        backLink={{ href: "/profile", label: "Back to Dashboard" }}
      />

      <Section title="Available Repositories">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {docSections.map((item) => {
            const cardContent = (
              <div
                className={cn(
                  "bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200",
                  item.enabled
                    ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-xl"
                    : "cursor-not-allowed opacity-60",
                  item.hoverBorder
                )}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <IconFill
                        icon={item.icon}
                        fillColor={item.fill}
                        className={cn(
                          "h-9 w-9 rounded-lg border transition-transform duration-200",
                          item.enabled && "group-hover:scale-105",
                          item.color
                        )}
                        iconClassName="h-5 w-5"
                      />
                      <h3 className={cn("text-foreground text-base font-semibold transition-colors", item.hoverText)}>
                        {item.title}
                      </h3>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", item.color)}
                    >
                      {item.tag}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">{item.description}</p>
                </div>
                <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                  <span className="text-muted-foreground text-[11px] font-medium">{item.subLabel}</span>
                  {item.enabled ? (
                    <IconFill
                      icon={ChevronRight}
                      fillColor={item.fill}
                      hoverTextClassName="group-hover:text-white"
                      className={cn(
                        "border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5",
                        item.hoverBorder
                      )}
                      iconClassName="text-muted-foreground h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs font-medium">Disabled</span>
                  )}
                </div>
              </div>
            )

            if (!item.enabled) {
              return <div key={item.title}>{cardContent}</div>
            }

            return (
              <Link key={item.title} href={item.href} className="group block">
                {cardContent}
              </Link>
            )
          })}
        </div>
      </Section>
    </PageWrapper>
  )
}
