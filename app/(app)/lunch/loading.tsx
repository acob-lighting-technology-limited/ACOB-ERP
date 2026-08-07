import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton filters={2} columns={5} rows={6} showStats={true} statCards={4} tabs={2} actions={0} />
}
