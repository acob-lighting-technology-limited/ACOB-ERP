"use client"

import Link from "next/link"
import { FileSignature, Droplet, ChevronRight, Wrench, Briefcase, Video } from "lucide-react"
import { PageHeader, PageWrapper } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"
import { cn } from "@/lib/utils"

const tools = [
  {
    name: "Email Signature",
    description: "Generate a professional email signature with your ACOB contact details",
    href: "/tools/signature",
    icon: FileSignature,
    tag: "Branding",
    subLabel: "Signature builder",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    fill: "bg-blue-500",
    hoverBorder: "hover:border-blue-500/60 dark:hover:border-blue-400/60",
    hoverText: "group-hover:text-blue-500",
  },
  {
    name: "10th Anniversary Signature",
    description: "Generate the temporary anniversary email signature with the commemorative branding",
    href: "/tools/signature-anniversary",
    icon: FileSignature,
    tag: "Special",
    subLabel: "Anniversary edition",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    fill: "bg-amber-500",
    hoverBorder: "hover:border-amber-500/60 dark:hover:border-amber-400/60",
    hoverText: "group-hover:text-amber-500",
  },
  {
    name: "Watermark Studio",
    description: "Add ACOB branding watermarks to your images and videos",
    href: "/tools/watermark",
    icon: Droplet,
    tag: "Media",
    subLabel: "Image & video branding",
    color: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
    fill: "bg-teal-500",
    hoverBorder: "hover:border-teal-500/60 dark:hover:border-teal-400/60",
    hoverText: "group-hover:text-teal-500",
  },
  {
    name: "Job Description",
    description: "View, edit, and print your job description from the tools workspace",
    href: "/tools/job-description",
    icon: Briefcase,
    tag: "HR",
    subLabel: "Role details & duties",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    fill: "bg-emerald-500",
    hoverBorder: "hover:border-emerald-500/60 dark:hover:border-emerald-400/60",
    hoverText: "group-hover:text-emerald-500",
  },
  {
    name: "Media & PDF Suite",
    description: "Download, convert, compress media, and manage PDF documents",
    href: "/tools/test",
    icon: Video,
    tag: "Utility",
    subLabel: "PDF & media tools",
    color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    fill: "bg-indigo-500",
    hoverBorder: "hover:border-indigo-500/60 dark:hover:border-indigo-400/60",
    hoverText: "group-hover:text-indigo-500",
  },
]

export default function ToolsPage() {
  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Tools"
        description="Utility tools to help with your work"
        icon={Wrench}
        backLink={{ href: "/profile", label: "Back to Dashboard" }}
      />

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <Link key={tool.name} href={tool.href} className="group block">
            <div
              className={cn(
                "bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl",
                tool.hoverBorder
              )}
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <IconFill
                      icon={tool.icon}
                      fillColor={tool.fill}
                      className={cn(
                        "h-9 w-9 rounded-lg border transition-transform duration-200 group-hover:scale-105",
                        tool.color
                      )}
                      iconClassName="h-5 w-5"
                    />
                    <h3 className={cn("text-foreground text-base font-semibold transition-colors", tool.hoverText)}>
                      {tool.name}
                    </h3>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", tool.color)}
                  >
                    {tool.tag}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">{tool.description}</p>
              </div>
              <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
                <span className="text-muted-foreground text-[11px] font-medium">{tool.subLabel}</span>
                <IconFill
                  icon={ChevronRight}
                  fillColor={tool.fill}
                  hoverTextClassName="group-hover:text-white"
                  className={cn(
                    "border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5",
                    tool.hoverBorder
                  )}
                  iconClassName="text-muted-foreground h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </PageWrapper>
  )
}
