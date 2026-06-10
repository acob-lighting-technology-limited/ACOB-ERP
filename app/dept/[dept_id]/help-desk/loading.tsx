import { TablePageSkeleton } from "@/components/skeletons"

export default function AdminHelpDeskLoading() {
  return <TablePageSkeleton filters={0} columns={7} rows={8} showStats={true} statCards={4} />
}
