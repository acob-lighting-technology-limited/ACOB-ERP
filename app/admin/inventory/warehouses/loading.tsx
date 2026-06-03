import { TablePageSkeleton } from "@/components/skeletons"

export default function WarehousesLoading() {
  return <TablePageSkeleton filters={1} columns={5} rows={6} showStats={true} statCards={3} actions={2} />
}
