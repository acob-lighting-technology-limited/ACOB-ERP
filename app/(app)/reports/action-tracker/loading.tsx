import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors the Action Tracker: back link, Weekly / Directives tabs, inline
// actions, five compact stat cards, and the row list it opens on a phone over
// the table it opens on a desktop.
export default function Loading() {
  return (
    <TablePageSkeleton
      filters={4}
      columns={5}
      rows={8}
      showStats
      statCards={5}
      spacing="tight"
      showBackLink
      inlineActions
      actions={2}
      tabs={2}
      list="responsive"
      groups={1}
    />
  )
}
