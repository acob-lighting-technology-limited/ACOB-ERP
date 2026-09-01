import { TablePageSkeleton } from "@/components/skeletons"

// Mirrors the requisition portal: back link, three scope tabs, inline actions,
// four compact stat cards, and the row list it opens on a phone over the table
// it opens on a desktop.
export default function RequisitionLoading() {
  return (
    <TablePageSkeleton
      filters={4}
      columns={6}
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
