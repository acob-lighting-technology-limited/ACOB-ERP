import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton filters={3} columns={5} rows={8} showStats={true} statCards={4} />
}
