"use client"

import Link from "next/link"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FileSignature, Droplet, ArrowRight, Wrench, Briefcase, Video } from "lucide-react"
import { PageHeader, PageWrapper } from "@/components/layout"

const tools = [
  {
    name: "Email Signature",
    description: "Generate a professional email signature with your ACOB contact details",
    href: "/tools/signature",
    icon: FileSignature,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
  },
  {
    name: "10th Anniversary Signature",
    description: "Generate the temporary anniversary email signature with the commemorative branding",
    href: "/tools/signature-anniversary",
    icon: FileSignature,
    color: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
  },
  {
    name: "Watermark Studio",
    description: "Add ACOB branding watermarks to your images and videos",
    href: "/tools/watermark",
    icon: Droplet,
    color: "text-teal-500",
    bgColor: "bg-teal-50 dark:bg-teal-950/30",
  },
  {
    name: "Job Description",
    description: "View, edit, and print your job description from the tools workspace",
    href: "/tools/job-description",
    icon: Briefcase,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  {
    name: "Media & PDF Suite",
    description: "Download, convert, compress media, and manage PDF documents",
    href: "/tools/test",
    icon: Video,
    color: "text-indigo-500",
    bgColor: "bg-indigo-50 dark:bg-indigo-950/30",
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <Link key={tool.name} href={tool.href}>
            <Card className="hover:border-primary/30 group h-full cursor-pointer transition-all hover:shadow-lg">
              <CardHeader>
                <div className={`h-12 w-12 rounded-lg ${tool.bgColor} mb-3 flex items-center justify-center`}>
                  <tool.icon className={`h-6 w-6 ${tool.color}`} />
                </div>
                <CardTitle className="flex items-center justify-between">
                  {tool.name}
                  <ArrowRight className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
                </CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </PageWrapper>
  )
}
