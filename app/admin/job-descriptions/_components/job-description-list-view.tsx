"use client"

import { formatWATDate } from "@/lib/utils/date"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Eye, ArrowUp, ArrowDown } from "lucide-react"
import { getRoleDisplayName, getRoleBadgeColor } from "@/lib/permissions"
import { formatName } from "@/lib/utils"
import type { UserRole } from "@/types/database"

interface Profile {
  id: string
  first_name: string
  last_name: string
  company_email: string
  department: string
  designation: string | null
  phone_number: string | null
  role: UserRole
  job_description: string | null
  job_description_updated_at: string | null
  created_at: string
}

function getCompletionColor(hasDescription: boolean): string {
  return hasDescription
    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "Never"
  return formatWATDate(dateString, { month: "short", day: "numeric", year: "numeric" })
}

interface JobDescriptionListViewProps {
  profiles: Profile[]
  nameSortOrder: "asc" | "desc"
  onToggleSort: () => void
  onView: (profile: Profile) => void
}

export function JobDescriptionListView({ profiles, nameSortOrder, onToggleSort, onView }: JobDescriptionListViewProps) {
  return (
    <Card className="border-2">
      <CardContent className="p-3 sm:p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>
                <div className="flex items-center gap-2">
                  <span>Name</span>
                  <Button variant="ghost" size="sm" onClick={onToggleSort} className="h-6 w-6 p-0">
                    {nameSortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  </Button>
                </div>
              </TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {profiles.map((profile, index) => (
              <TableRow key={profile.id}>
                <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
                <TableCell className="font-medium">
                  {formatName(profile.last_name)}, {formatName(profile.first_name)}
                </TableCell>
                <TableCell>{profile.department}</TableCell>
                <TableCell>{profile.designation || "-"}</TableCell>
                <TableCell>
                  <Badge className={getRoleBadgeColor(profile.role)}>{getRoleDisplayName(profile.role)}</Badge>
                </TableCell>
                <TableCell>
                  <Badge className={getCompletionColor(!!profile.job_description)}>
                    {profile.job_description ? "Completed" : "Pending"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(profile.job_description_updated_at)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onView(profile)}
                    className="gap-2"
                    disabled={!profile.job_description}
                  >
                    <Eye className="h-4 w-4" />
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
