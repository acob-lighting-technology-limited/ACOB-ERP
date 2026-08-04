import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton filters={3} columns={6} rows={8} showStats={true} statCards={4} tabs={2} actions={2} />
}
