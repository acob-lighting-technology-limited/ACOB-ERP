import { AdminPmsPage } from "./view"

export default async function AdminPmsPageRoute({ searchParams }: { searchParams: Promise<{ cycle_id?: string }> }) {
  const { cycle_id } = await searchParams
  return <AdminPmsPage cycleId={cycle_id} />
}
