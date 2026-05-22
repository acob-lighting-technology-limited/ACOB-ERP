"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Pencil, Users } from "lucide-react"
import { EmptyState } from "@/components/ui/patterns"
import { TableSkeleton } from "@/components/ui/query-states"
import type { User } from "../_lib/queries"

const roleColors: Record<string, string> = {
  developer: "destructive",
  super_admin: "destructive",
  admin: "default",
  employee: "secondary",
  visitor: "secondary",
}

interface UsersTableProps {
  users: User[]
  loading: boolean
  onEdit: (user: User) => void
  formatDate: (date: string) => string
}

export function UsersTable({ users, loading, onEdit, formatDate }: UsersTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>All Users</CardTitle>
        <CardDescription>{users.length} users</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : users.length === 0 ? (
          <EmptyState title="No users found" icon={Users} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">
                    {user.first_name || user.last_name
                      ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email || "—"}</TableCell>
                  <TableCell>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Badge variant={roleColors[user.role] as any} className="capitalize">
                      {user.role?.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.department || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "secondary"}>
                      {user.employment_status === "exited" ? "Exited" : user.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(user.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(user)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
