import { TablePageSkeleton } from "@/components/skeletons"

export default function JobDescriptionsLoading() {
  return <TablePageSkeleton filters={2} columns={4} rows={8} showStats={true} statCards={3} actions={1} />
}
