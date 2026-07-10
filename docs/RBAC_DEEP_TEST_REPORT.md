# RBAC Deep Test Report

Generated: 2026-03-08T18:49:23.613Z

## Summary
- Static checks: 11
- DB checks: 0 (skipped)
- Failed checks: 0
- Live leads found: 0 (skipped)
- finance_global_lead live count: 0 (skipped)
- hr_global_lead live count: 0 (skipped)
- leads with empty lead_departments: 0 (skipped)

## Static Checks
- PASS: Admin layout blocks non-admin roles (components/admin-layout.tsx)
- PASS: Finance departments legacy route redirects to finance payments (app/admin/finance/payments/departments/page.tsx)
- PASS: Legacy payments departments route redirects to finance payments (app/admin/payments/departments/page.tsx)
- PASS: Finance dashboard department entry points to finance payments (app/admin/finance/page.tsx)
- PASS: HR employees page has explicit mutate permission gate (app/admin/hr/employees/admin-employee-content.tsx)
- PASS: Employees page has explicit mutate permission gate (app/admin/employees/admin-employee-content.tsx)
- PASS: HR departments page has explicit mutate permission gate (app/admin/hr/departments/page.tsx)
- PASS: Create-user API uses central RBAC scope (app/api/admin/create-user/route.ts)
- PASS: Create-user API allows HR global lead (app/api/admin/create-user/route.ts)
- PASS: Departments create API allows HR global lead (app/api/departments/route.ts)
- PASS: Departments update/delete API allows HR global lead (app/api/departments/[id]/route.ts)

## DB Checks
- SKIPPED: DB checks disabled (set SKIP_DB=1)

## Route Access Matrix
| Route | Allowed Roles | Scope Rule |
|---|---|---|
| /admin | super_admin, admin, lead | lead scoped |
| /admin/hr* | super_admin, admin, lead | hr_global full, other leads scoped |
| /admin/finance* | super_admin, admin, lead | finance_global full, other leads scoped |
| /admin/assets* | super_admin, admin, lead | lead scoped by department + office |
| /admin/employees* | super_admin, admin, lead | all leads view all; mutate only hr_global/admin/super_admin |
| /admin/hr/departments | super_admin, admin, lead | all leads view all; mutate only hr_global/admin/super_admin |
| /admin/reports* | super_admin, admin, lead | lead scoped; create own dept, edit/delete own records |
| /admin/onedrive* | super_admin, admin, lead | lead scoped paths |

## CRUD Matrix
| Role Persona | Admin Dashboard | Employees View | Employees Mutate | Departments View | Departments Mutate | Finance Scope |
|---|---|---|---|---|---|---|
| super_admin | Full | All | Yes | All | Yes | Full |
| admin | Full | All | Yes | All | Yes | Full |
| hr_global_lead | Scoped | All | Yes | All | Yes | Scoped |
| finance_global_lead | Scoped | All | No | All | No | Full |
| dept_scoped_lead | Scoped | All | No | All | No | Scoped |
| employee | Denied | N/A | N/A | N/A | N/A | N/A |

## Live Lead Mapping (Department + Office)
Skipped in this run.
