import { TablePageSkeleton } from "@/components/skeletons"

export default function AuditLogsLoading() {
  return <TablePageSkeleton filters={4} columns={5} rows={10} showStats={true} statCards={3} actions={1} />
}
