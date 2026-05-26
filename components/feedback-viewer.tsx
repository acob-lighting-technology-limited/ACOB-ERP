"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { formatWATDate, formatWATDateTime } from "@/lib/utils/date"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { toast } from "sonner"
import { Eye, List, LayoutGrid, MessageSquare } from "lucide-react"
import { formatName } from "@/lib/utils"
import { writeAuditLogClient } from "@/lib/audit/client"
import type { FeedbackRecord } from "@/components/feedback/types"

interface FeedbackViewerProps {
  feedback: FeedbackRecord[]
}

export function FeedbackViewer({ feedback }: FeedbackViewerProps) {
  const [filteredFeedback, setFilteredFeedback] = useState(feedback)
  const [selectedType, setSelectedType] = useState("all")
  const [selectedStatus, setSelectedStatus] = useState("all")
  const [viewMode, setViewMode] = useState<"list" | "card">("list")
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackRecord | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  // Real-time filtering with useEffect
  useEffect(() => {
    let filtered = feedback

    if (selectedType !== "all") {
      filtered = filtered.filter((item) => item.feedback_type === selectedType)
    }

    if (selectedStatus !== "all") {
      filtered = filtered.filter((item) => item.status === selectedStatus)
    }

    setFilteredFeedback(filtered)
  }, [feedback, selectedType, selectedStatus])

  const getTypeColor = (type: string) => {
    switch (type) {
      case "concern":
        return "bg-yellow-100 text-yellow-800"
      case "complaint":
        return "bg-red-100 text-red-800"
      case "suggestion":
        return "bg-blue-100 text-blue-800"
      case "required_item":
        return "bg-purple-100 text-purple-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-green-100 text-green-800"
      case "in_progress":
        return "bg-blue-100 text-blue-800"
      case "resolved":
        return "bg-purple-100 text-purple-800"
      case "closed":
        return "bg-gray-100 text-gray-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const handleViewDetails = (item: FeedbackRecord) => {
    setSelectedFeedback(item)
    setIsModalOpen(true)
  }

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedFeedback) return

    const supabase = createClient()
    setIsUpdating(true)

    try {
      const { error } = await supabase
        .from("feedback")
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedFeedback.id)

      if (error) throw error

      // Log audit
      await writeAuditLogClient(
        supabase,
        {
          action: "status_change",
          entityType: "feedback",
          entityId: selectedFeedback.id,
          oldValues: {
            status: selectedFeedback.status,
          },
          newValues: {
            status: newStatus,
          },
          metadata: {
            event: "feedback_status_updated",
          },
          context: {
            source: "ui",
            route: "/admin/feedback",
          },
        },
        { failOpen: true }
      )

      toast.success("Status updated successfully!")

      // Update local state
      const updatedFeedback = { ...selectedFeedback, status: newStatus }
      setSelectedFeedback(updatedFeedback)

      // Update in the list
      setFilteredFeedback(filteredFeedback.map((item) => (item.id === selectedFeedback.id ? updatedFeedback : item)))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update status"
      toast.error(message)
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Filters</CardTitle>
            <div className="flex items-center rounded-lg border p-1">
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="gap-2"
              >
                <List className="h-4 w-4" />
                List
              </Button>
              <Button
                variant={viewMode === "card" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("card")}
                className="gap-2"
              >
                <LayoutGrid className="h-4 w-4" />
                Card
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Feedback Type</label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="concern">Concern</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                  <SelectItem value="suggestion">Suggestion</SelectItem>
                  <SelectItem value="required_item">Required Item</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feedback List */}
      {filteredFeedback.length > 0 ? (
        viewMode === "list" ? (
          <Card>
            <CardHeader>
              <CardTitle>Feedback Items</CardTitle>
              <CardDescription>Total: {filteredFeedback.length} items</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredFeedback.map((item, index) => (
                      <TableRow key={item.id} className="hover:bg-muted/50 cursor-pointer">
                        <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {item.user_id ? (
                              <>
                                <p className="font-medium">
                                  {formatName(item.profiles?.first_name)} {formatName(item.profiles?.last_name)}
                                </p>
                                <p className="text-muted-foreground text-xs">{item.profiles?.company_email}</p>
                              </>
                            ) : (
                              <p className="text-muted-foreground font-medium italic">Anonymous</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getTypeColor(item.feedback_type)}>{item.feedback_type}</Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{item.title}</TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatWATDate(item.created_at)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleViewDetails(item)
                            }}
                          >
                            <Eye className="mr-1 h-4 w-4" />
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
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredFeedback.map((item) => (
              <Card key={item.id} className="border-2 transition-shadow hover:shadow-lg">
                <CardHeader className="from-primary/5 to-background border-b bg-gradient-to-r">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-1 items-start gap-3">
                      <div className="bg-primary/10 rounded-lg p-2">
                        <MessageSquare className="text-primary h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="line-clamp-2 text-lg">{item.title}</CardTitle>
                        <div className="mt-2 flex items-center gap-2">
                          <Badge className={getTypeColor(item.feedback_type)}>{item.feedback_type}</Badge>
                          <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  <div className="text-sm">
                    {item.user_id ? (
                      <>
                        <p className="font-medium">
                          {item.profiles?.first_name} {item.profiles?.last_name}
                        </p>
                        <p className="text-muted-foreground text-xs">{item.profiles?.company_email}</p>
                      </>
                    ) : (
                      <p className="text-muted-foreground font-medium italic">Anonymous</p>
                    )}
                  </div>
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {item.description || "No description provided."}
                  </p>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-muted-foreground text-xs">{formatWATDate(item.created_at)}</span>
                    <Button variant="outline" size="sm" onClick={() => handleViewDetails(item)} className="gap-2">
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <MessageSquare className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
            <h3 className="text-foreground mb-2 text-xl font-semibold">No Feedback Found</h3>
            <p className="text-muted-foreground">
              {selectedType !== "all" || selectedStatus !== "all"
                ? "No feedback matches your filters"
                : "No feedback has been submitted yet"}
            </p>
          </CardContent>
        </Card>
      )}

      <Link href="/admin">
        <Button variant="outline">Back to Admin Dashboard</Button>
      </Link>

      {/* Feedback Details Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Feedback Details</DialogTitle>
            <DialogDescription>View and manage feedback details</DialogDescription>
          </DialogHeader>

          {selectedFeedback && (
            <div className="space-y-6">
              {/* User Information */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Submitted By</Label>
                <div className="bg-muted rounded-md p-3">
                  {selectedFeedback.user_id ? (
                    <>
                      <p className="font-medium">
                        {selectedFeedback.profiles?.first_name} {selectedFeedback.profiles?.last_name}
                      </p>
                      <p className="text-muted-foreground text-sm">{selectedFeedback.profiles?.company_email}</p>
                    </>
                  ) : (
                    <p className="text-muted-foreground font-medium italic">Anonymous Submission</p>
                  )}
                  <p className="text-muted-foreground mt-1 text-xs">
                    Submitted: {formatWATDateTime(selectedFeedback.created_at)}
                  </p>
                  {selectedFeedback.updated_at !== selectedFeedback.created_at && (
                    <p className="text-muted-foreground text-xs">
                      Updated: {formatWATDateTime(selectedFeedback.updated_at)}
                    </p>
                  )}
                </div>
              </div>

              {/* Feedback Type and Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Feedback Type</Label>
                  <div>
                    <Badge className={getTypeColor(selectedFeedback.feedback_type)}>
                      {selectedFeedback.feedback_type}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Status</Label>
                  <div>
                    <Badge className={getStatusColor(selectedFeedback.status)}>{selectedFeedback.status}</Badge>
                  </div>
                </div>
              </div>

              {/* Title */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Title</Label>
                <div className="bg-muted rounded-md p-3">
                  <p>{selectedFeedback.title}</p>
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Description</Label>
                <div className="bg-muted min-h-[100px] rounded-md p-3">
                  <p className="whitespace-pre-wrap">{selectedFeedback.description || "No description provided."}</p>
                </div>
              </div>

              {/* Update Status */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Update Status</Label>
                <Select
                  value={selectedFeedback.status}
                  onValueChange={(value) => handleUpdateStatus(value)}
                  disabled={isUpdating}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-4">
                <Button onClick={() => setIsModalOpen(false)} variant="outline" className="flex-1">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
