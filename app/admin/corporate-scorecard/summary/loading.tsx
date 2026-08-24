import { TablePageSkeleton } from "@/components/skeletons"

export default function Loading() {
  return <TablePageSkeleton filters={0} columns={5} rows={10} showStats={true} statCards={5} actions={0} />
}
