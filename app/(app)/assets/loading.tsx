import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors AssetsContent: back link, four compact stat cards, and the row list
// it opens on a phone over the table it opens on a desktop.
export default function Loading() {
  return (
    <TablePageSkeleton
      filters={2}
      columns={6}
      rows={8}
      showStats
      statCardVariant="compact"
      statCards={4}
      spacing="tight"
      showBackLink
      actions={0}
      list="responsive"
      groups={1}
    />
  )
}
