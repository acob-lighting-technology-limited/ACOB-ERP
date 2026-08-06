import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Wrench, ArrowRight, FileSignature, Droplet, Video } from "lucide-react"
import { AdminTablePage } from "@/components/admin/admin-table-page"

const tools = [
  {
    name: "Email Signature",
    description: "Generate professional employee email signatures",
    href: "/tools/signature",
    icon: FileSignature,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
  },
  {
    name: "10th Anniversary Signature",
    description: "Generate the temporary anniversary version of the employee email signature",
    href: "/tools/signature-anniversary",
    icon: FileSignature,
    color: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
  },
  {
    name: "Watermark Studio",
    description: "Apply branded watermarks to uploaded media",
    href: "/tools/watermark",
    icon: Droplet,
    color: "text-teal-500",
    bgColor: "bg-teal-50 dark:bg-teal-950/30",
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

export default function AdminToolsPage() {
  return (
    <AdminTablePage
      title="Tools"
      description="Administrative tools and utilities"
      icon={Wrench}
      backLinkHref="/admin"
      backLinkLabel="Back to Dashboard"
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <Link key={tool.name} href={tool.href}>
            <Card className="hover:border-primary/30 group h-full cursor-pointer transition-all hover:shadow-lg">
              <CardHeader>
                <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-lg ${tool.bgColor}`}>
                  <tool.icon className={`h-6 w-6 ${tool.color}`} />
                </div>
                <CardTitle className="flex items-center justify-between">
                  {tool.name}
                  <ArrowRight className="text-muted-foreground group-hover:text-primary h-4 w-4 transition-colors" />
                </CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </AdminTablePage>
  )
}
