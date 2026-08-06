import { PageHeader, PageWrapper } from "@/components/layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MediaDownloader } from "./_components/media-downloader"
import { MediaConverter } from "./_components/media-converter"
import { MediaCompressor } from "./_components/media-compressor"
import { PdfTools } from "./_components/pdf-tools"
import { Download, RefreshCw, Minimize2, FileText, Wrench } from "lucide-react"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Media & PDF Suite | ACOB ERP",
  description: "A comprehensive media downloading, converting, compressing, and PDF management utility suite.",
}

export default function ToolsTestPage() {
  return (
    <PageWrapper maxWidth="full" background="gradient">
      <div className="space-y-6">
        <PageHeader
          title="Media & PDF Suite"
          description="Download media, convert formats, compress file sizes, and manage PDF documents."
          icon={Wrench}
          backLink={{ href: "/tools", label: "Back to Tools" }}
        />

        <Tabs defaultValue="downloader" className="w-full">
          <TabsList className="bg-muted grid h-auto w-full grid-cols-2 p-1 md:grid-cols-4">
            <TabsTrigger value="downloader" className="py-2.5">
              <Download className="mr-2 h-4 w-4" /> Media Downloader
            </TabsTrigger>
            <TabsTrigger value="converter" className="py-2.5">
              <RefreshCw className="mr-2 h-4 w-4" /> Media Converter
            </TabsTrigger>
            <TabsTrigger value="compressor" className="py-2.5">
              <Minimize2 className="mr-2 h-4 w-4" /> Media Compressor
            </TabsTrigger>
            <TabsTrigger value="pdf" className="py-2.5">
              <FileText className="mr-2 h-4 w-4" /> PDF Tools
            </TabsTrigger>
          </TabsList>

          <TabsContent value="downloader" className="mt-6 border-none p-0 focus-visible:ring-0">
            <MediaDownloader />
          </TabsContent>

          <TabsContent value="converter" className="mt-6 border-none p-0 focus-visible:ring-0">
            <MediaConverter />
          </TabsContent>

          <TabsContent value="compressor" className="mt-6 border-none p-0 focus-visible:ring-0">
            <MediaCompressor />
          </TabsContent>

          <TabsContent value="pdf" className="mt-6 border-none p-0 focus-visible:ring-0">
            <PdfTools />
          </TabsContent>
        </Tabs>
      </div>
    </PageWrapper>
  )
}
