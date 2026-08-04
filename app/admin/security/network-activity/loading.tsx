import { TablePageSkeleton } from "@/components/skeletons"

export default function AdminSecurityNetworkActivityLoading() {
  return <TablePageSkeleton filters={6} columns={4} rows={8} showStats={true} statCards={4} />
}
