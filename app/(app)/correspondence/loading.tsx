import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors PortalReferenceGeneratorContent: inline actions, four compact stat
// cards, and the row list on a phone
// over the table on a desktop.
export default function Loading() {
  return (
    <TablePageSkeleton
      filters={2}
      rows={8}
      showStats
      statCardVariant="compact"
      statCards={4}
      spacing="tight"
      inlineActions
      actions={1}
      list="responsive"
      groups={1}
    />
  )
}
