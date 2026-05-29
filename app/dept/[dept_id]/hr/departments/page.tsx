import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminDepartmentsPage from "@/app/admin/hr/departments/page"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptDepartmentsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminDepartmentsPage backLinkHref={`/dept/${dept_id}/hr`} employeesBasePath={`/dept/${dept_id}/hr/employees`} />
  )
}
