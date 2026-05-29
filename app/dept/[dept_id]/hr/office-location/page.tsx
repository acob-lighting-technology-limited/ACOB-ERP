import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminOfficeLocationPage from "@/app/admin/hr/office-location/page"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptOfficeLocationPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminOfficeLocationPage backLinkHref={`/dept/${dept_id}/hr`} employeesBasePath={`/dept/${dept_id}/hr/employees`} />
  )
}
