/**
 * DETAIL PAGE TEMPLATE
 *
 * Use this template for pages that display detailed view of a single item:
 * - Header with title and actions
 * - Main content area with sections
 * - Optional sidebar with meta information
 *
 * Examples: Project detail, employee profile, Task detail
 */

import { redirect, notFound } from "next/navigation"
import { formatWATDate } from "@/lib/utils/date"
import { createClient } from "@/lib/supabase/server"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Pencil, Trash2, Package } from "lucide-react"
import Link from "next/link"

// ============================================
// TYPES
// ============================================

interface Item {
  id: string
  name: string
  description: string | null
  status: string
  category_name?: string
  created_at: string
  updated_at: string
}

interface RelatedItem {
  id: string
  name: string
  type: string
}

// ============================================
// DATA FETCHING (Server-side)
// ============================================

async function getPageData(itemId: string) {
  const supabase = await createClient()

  // 1. Check authentication
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  // 2. Fetch the item
  const { data: item, error } = await supabase
    .from("items")
    .select("*, category:categories(name)")
    .eq("id", itemId)
    .single()

  if (error || !item) {
    return { notFound: true as const }
  }

  // 3. Fetch related data
  const { data: relatedItems } = await supabase.from("related_items").select("*").eq("item_id", itemId).limit(5)

  return {
    item: {
      ...item,
      category_name: item.category?.name,
    } as Item,
    relatedItems: relatedItems || [],
  }
}

// ============================================
// PAGE COMPONENT
// ============================================

interface DetailPageProps {
  params: Promise<{ id: string }>
}

export default async function DetailPage({ params }: DetailPageProps) {
  const { id } = await params
  const data = await getPageData(id)

  // Handle redirects
  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  // Handle not found
  if ("notFound" in data && data.notFound) {
    notFound()
  }

  const pageData = data as {
    item: Item
    relatedItems: RelatedItem[]
  }

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "active":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      case "inactive":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
    }
  }

  return (
    <PageWrapper maxWidth="content" background="gradient">
      {/* Page Header with Actions */}
      <PageHeader
        title={pageData.item.name}
        description={pageData.item.category_name || "Uncategorized"}
        icon={Package}
        backLink={{ href: "/admin/items", label: "Back to Items" }}
        actions={
          <div className="flex gap-2">
            <Link href={`/admin/items/${pageData.item.id}/edit`}>
              <Button variant="outline">
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
            <Button variant="destructive">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        }
      />

      {/* Main Content Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Main Content - 2 columns */}
        <div className="space-y-6 md:col-span-2">
          {/* Overview Section */}
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">Status:</span>
                <Badge className={getStatusColor(pageData.item.status)}>{pageData.item.status}</Badge>
              </div>

              {pageData.item.description && (
                <div>
                  <h4 className="text-muted-foreground mb-2 text-sm">Description</h4>
                  <p className="text-foreground">{pageData.item.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Related Items Section */}
          {pageData.relatedItems.length > 0 && (
            <Section title="Related Items">
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    {pageData.relatedItems.map((related) => (
                      <div key={related.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                        <span>{related.name}</span>
                        <Badge variant="outline">{related.type}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Section>
          )}
        </div>

        {/* Sidebar - 1 column */}
        <div className="space-y-6">
          {/* Meta Information */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono">{pageData.item.id.slice(0, 8)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatWATDate(pageData.item.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span>{formatWATDate(pageData.item.updated_at)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageWrapper>
  )
}
