import { TablePageSkeleton } from "@/components/skeletons"

export default function AuditLogsLoading() {
  return (
    <TablePageSkeleton
      filters={3}
      columns={6}
      rows={10}
      showStats={true}
      statCards={4}
      actions={1}
      showBackLink={true}
    />
  )
}
