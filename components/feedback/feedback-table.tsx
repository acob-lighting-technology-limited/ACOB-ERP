"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageSquare, Eye, ArrowUp, ArrowDown } from "lucide-react"
import { formatName } from "@/lib/utils"
import { formatWATDate } from "@/lib/utils/date"
import type { FeedbackRecord } from "@/components/feedback/types"

function getTypeColor(type: string): string {
  switch (type) {
    case "concern":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
    case "complaint":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
    case "suggestion":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "required_item":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "open":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    case "in_progress":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    case "resolved":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
    case "closed":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
  }
}

interface FeedbackTableProps {
  items: FeedbackRecord[]
  nameSortOrder: "asc" | "desc"
  onToggleSort: () => void
  onView: (item: FeedbackRecord) => void
  hasActiveFilters: boolean
}

export function FeedbackTable({ items, nameSortOrder, onToggleSort, onView, hasActiveFilters }: FeedbackTableProps) {
  if (items.length === 0) {
    return (
      <Card className="border-2">
        <CardContent className="p-12 text-center">
          <MessageSquare className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
          <h3 className="text-foreground mb-2 text-xl font-semibold">No Feedback Found</h3>
          <p className="text-muted-foreground">
            {hasActiveFilters ? "No feedback matches your filters" : "No feedback has been submitted yet"}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>
                  <div className="flex items-center gap-2">
                    <span>User</span>
                    <Button variant="ghost" size="sm" onClick={onToggleSort} className="h-6 w-6 p-0">
                      {nameSortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    </Button>
                  </div>
                </TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id} className="hover:bg-muted/50 cursor-pointer">
                  <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {item.user_id ? (
                        <>
                          <p className="font-medium">
                            {formatName(item.profiles?.last_name)}, {formatName(item.profiles?.first_name)}
                          </p>
                          <p className="text-muted-foreground text-xs">{item.profiles?.company_email}</p>
                        </>
                      ) : (
                        <p className="text-muted-foreground font-medium italic">Anonymous</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{item.user_id ? item.profiles?.department || "-" : "-"}</TableCell>
                  <TableCell>
                    <Badge className={getTypeColor(item.feedback_type)}>{item.feedback_type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{item.title}</TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatWATDate(item.created_at)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onView(item)
                      }}
                      className="gap-2"
                    >
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
