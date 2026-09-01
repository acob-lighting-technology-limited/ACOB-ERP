import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors HelpDeskContent: back link, three scope tabs, inline actions, four
// compact stat cards, and the row list it opens on a phone over the table it
// opens on a desktop.
export default function Loading() {
  return (
    <TablePageSkeleton
      filters={3}
      columns={5}
      rows={8}
      showStats
      statCards={4}
      spacing="tight"
      showBackLink
      inlineActions
      actions={2}
      tabs={3}
      list="responsive"
      groups={1}
    />
  )
}
