import { TablePageSkeleton } from "@/components/skeletons"

export default function AssetsLoading() {
  return <TablePageSkeleton filters={3} columns={11} rows={8} showStats={true} statCards={5} />
}
