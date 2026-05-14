"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ItemInfoButton } from "@/components/ui/item-info-button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CorrespondenceRecord } from "@/types/correspondence"

interface CorrespondenceTableProps {
  records: CorrespondenceRecord[]
  dispatchingId: string | null
  onUpdateStatus: (recordId: string, status: string) => void
  onDispatch: (recordId: string) => void
}

function buildReferenceInfo(record: CorrespondenceRecord) {
  return {
    title: `${record.reference_number} reference guide`,
    summary: "This explains what this reference is for and what action is expected from the current handler.",
    details: [
      {
        label: "What this item is",
        value: `${record.reference_number} is a ${(record.letter_type || "external").toLowerCase()} correspondence item for ${record.department_name || record.assigned_department_name || "the selected department"}.`,
      },
      {
        label: "Current workflow meaning",
        value: `Status is ${record.status.replaceAll("_", " ")} and the subject is "${record.subject}".`,
      },
      {
        label: "What to do next",
        value:
          record.status === "draft"
            ? "Review the draft details, then send it for review when the reference is ready to leave draft state."
            : record.status === "approved"
              ? "This reference is approved and can be dispatched when the final outgoing action is ready."
              : "Check the latest review state and any approver note so the next department action is clear.",
      },
    ],
  }
}

export function CorrespondenceTable({ records, dispatchingId, onUpdateStatus, onDispatch }: CorrespondenceTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My References</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">S/N</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record, index) => (
              <TableRow key={record.id}>
                <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1">
                    <span>{record.reference_number}</span>
                    <ItemInfoButton {...buildReferenceInfo(record)} />
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{record.letter_type || "external"}</Badge>
                </TableCell>
                <TableCell>{record.department_name || record.assigned_department_name || "-"}</TableCell>
                <TableCell>
                  <Badge>{record.status}</Badge>
                </TableCell>
                <TableCell>{record.subject}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    {record.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => onUpdateStatus(record.id, "under_review")}>
                        Send for Review
                      </Button>
                    )}
                    {record.status === "approved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onDispatch(record.id)}
                        disabled={dispatchingId === record.id}
                      >
                        {dispatchingId === record.id ? "Dispatching..." : "Dispatch"}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
