import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors FleetContent: back link, All / My tabs, inline action, four compact
// stat cards, and the row list it opens on a phone over the table it opens on
// a desktop.
export default function Loading() {
  return (
    <TablePageSkeleton
      filters={2}
      columns={5}
      rows={8}
      showStats
      statCardVariant="compact"
      statCards={4}
      spacing="tight"
      showBackLink
      inlineActions
      actions={1}
      tabs={2}
      list="responsive"
      groups={1}
    />
  )
}
