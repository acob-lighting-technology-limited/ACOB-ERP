"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminRoutesPicker } from "@/components/ui/admin-routes-picker"
import { Plus } from "lucide-react"
import { useDepartments } from "@/hooks/use-departments"
import type { UserRole } from "@/types/database"
import { getRoleDisplayName } from "@/lib/permissions"
import { getAssignableRolesForActor } from "@/lib/role-management"
import type { UserProfile } from "@/app/admin/hr/employees/admin-employee-content"

const createUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  otherNames: z.string(),
  email: z.string().min(1, "Email is required").email("Invalid email address"),
  department: z.string().min(1, "Department is required"),
  companyRole: z.string(),
  phoneNumber: z.string(),
  role: z.string(),
  admin_routes: z.array(z.string()),
  employmentType: z.enum(["full_time", "part_time", "contract"]),
  contractCategoryCode: z.string(),
})

type CreateUserFormValues = z.infer<typeof createUserSchema>

interface CreateUserForm {
  firstName: string
  lastName: string
  otherNames: string
  email: string
  department: string
  companyRole: string
  phoneNumber: string
  role: UserRole
  admin_routes: string[]
  employmentType: "full_time" | "part_time" | "contract"
  contractCategoryCode: string
}

interface CreateUserDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  form: CreateUserForm
  setForm: (form: CreateUserForm) => void
  onCreate: () => void
  isCreating: boolean
  canManageUsers: boolean
  userProfile: UserProfile
}

export function CreateUserDialog({
  isOpen,
  onOpenChange,
  form: parentForm,
  setForm: setParentForm,
  onCreate,
  isCreating,
  canManageUsers: _canManageUsers,
  userProfile,
}: CreateUserDialogProps) {
  const { departments: DEPARTMENTS } = useDepartments()

  const { data: contractCategories = [] } = useQuery<any[]>({
    queryKey: ["contract-categories"],
    queryFn: async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("contract_categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: isOpen,
  })

  const rhf = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      firstName: parentForm.firstName,
      lastName: parentForm.lastName,
      otherNames: parentForm.otherNames,
      email: parentForm.email,
      department: parentForm.department,
      companyRole: parentForm.companyRole,
      phoneNumber: parentForm.phoneNumber,
      role: parentForm.role,
      admin_routes: parentForm.admin_routes,
      employmentType: parentForm.employmentType || "full_time",
      contractCategoryCode: parentForm.contractCategoryCode || "",
    },
  })

  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = rhf

  // Sync form state back to parent whenever values change
  useEffect(() => {
    const subscription = watch((values) => {
      setParentForm({
        firstName: values.firstName ?? "",
        lastName: values.lastName ?? "",
        otherNames: values.otherNames ?? "",
        email: values.email ?? "",
        department: values.department ?? "",
        companyRole: values.companyRole ?? "",
        phoneNumber: values.phoneNumber ?? "",
        role: (values.role ?? "employee") as UserRole,
        admin_routes: (values.admin_routes ?? []).filter((value): value is string => Boolean(value)),
        employmentType: (values.employmentType ?? "full_time") as "full_time" | "part_time" | "contract",
        contractCategoryCode: values.contractCategoryCode ?? "",
      })
    })
    return () => subscription.unsubscribe()
  }, [watch, setParentForm])

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (isOpen) {
      rhf.reset({
        firstName: parentForm.firstName,
        lastName: parentForm.lastName,
        otherNames: parentForm.otherNames,
        email: parentForm.email,
        department: parentForm.department,
        companyRole: parentForm.companyRole,
        phoneNumber: parentForm.phoneNumber,
        role: parentForm.role,
        admin_routes: parentForm.admin_routes,
        employmentType: parentForm.employmentType || "full_time",
        contractCategoryCode: parentForm.contractCategoryCode || "",
      })
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const getAvailableRoles = (): UserRole[] => {
    if (!userProfile) return []
    return getAssignableRolesForActor(userProfile.role) as UserRole[]
  }

  const roleValue = watch("role")
  const firstNameValue = watch("firstName")
  const lastNameValue = watch("lastName")
  const emailValue = watch("email")
  const departmentValue = watch("department")
  const employmentTypeValue = watch("employmentType")
  const contractCategoryCodeValue = watch("contractCategoryCode")

  const getPreviewId = () => {
    const currentYear = new Date().getFullYear()
    if (employmentTypeValue === "full_time") {
      return `ACOB/${currentYear}/...`
    } else if (employmentTypeValue === "part_time") {
      return `ACOB/PT/${currentYear}/...`
    } else {
      const catCode = contractCategoryCodeValue || "CATEGORY"
      return `ACOB/${catCode}/${currentYear}/...`
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="space-y-3 border-b pb-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
              <Plus className="text-primary h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl">Create New User</DialogTitle>
              <DialogDescription className="mt-1">
                Add a new employees member to the system. Name, email, and department are required.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="create_first_name">
                First Name * <span className="text-destructive">*</span>
              </Label>
              <Input id="create_first_name" {...register("firstName")} placeholder="John" className="mt-1.5" />
              {errors.firstName && <p className="text-destructive mt-1 text-xs">{errors.firstName.message}</p>}
            </div>
            <div>
              <Label htmlFor="create_last_name">
                Last Name * <span className="text-destructive">*</span>
              </Label>
              <Input id="create_last_name" {...register("lastName")} placeholder="Doe" className="mt-1.5" />
              {errors.lastName && <p className="text-destructive mt-1 text-xs">{errors.lastName.message}</p>}
            </div>
          </div>

          <div>
            <Label htmlFor="create_other_names">Other Names</Label>
            <Input
              id="create_other_names"
              {...register("otherNames")}
              placeholder="Middle name or other names (optional)"
              className="mt-1.5"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="create_employment_type">Employment Type</Label>
              <Select
                value={employmentTypeValue}
                onValueChange={(value) => {
                  setValue("employmentType", value as any)
                  if (value !== "contract") {
                    setValue("contractCategoryCode", "")
                  } else if (contractCategories.length > 0) {
                    setValue("contractCategoryCode", contractCategories[0].code)
                  }
                }}
              >
                <SelectTrigger id="create_employment_type" className="mt-1.5">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full Time</SelectItem>
                  <SelectItem value="part_time">Part Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {employmentTypeValue === "contract" && (
              <div>
                <Label htmlFor="create_contract_category">Contract Category</Label>
                <Select
                  value={contractCategoryCodeValue}
                  onValueChange={(value) => setValue("contractCategoryCode", value)}
                >
                  <SelectTrigger id="create_contract_category" className="mt-1.5">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.code}>
                        {cat.name} ({cat.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="bg-muted/30 rounded-lg border p-3">
            <span className="text-muted-foreground text-xs font-semibold uppercase">Assigned ID Preview</span>
            <p className="text-primary mt-1 font-mono text-sm font-bold">{getPreviewId()}</p>
            <p className="text-muted-foreground mt-0.5 text-xs">The exact number will be generated automatically.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="create_email">
                Email * <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create_email"
                type="email"
                {...register("email")}
                placeholder="john.doe@company.com"
                className="mt-1.5"
              />
              {errors.email && <p className="text-destructive mt-1 text-xs">{errors.email.message}</p>}
            </div>
            <div>
              <Label htmlFor="create_phone">Phone Number</Label>
              <Input
                id="create_phone"
                type="tel"
                {...register("phoneNumber")}
                placeholder="+234 800 000 0000"
                className="mt-1.5"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="create_department">
                Department * <span className="text-destructive">*</span>
              </Label>
              <Select value={departmentValue} onValueChange={(value) => setValue("department", value)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((dept) => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.department && <p className="text-destructive mt-1 text-xs">{errors.department.message}</p>}
            </div>
            <div>
              <Label htmlFor="create_role">Role</Label>
              <Select
                value={roleValue}
                onValueChange={(value: string) => {
                  setValue("role", value)
                  if (value !== "admin") {
                    setValue("admin_routes", [])
                  }
                }}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getAvailableRoles().map((role) => (
                    <SelectItem key={role} value={role}>
                      {getRoleDisplayName(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {roleValue === "admin" && (
            <div>
              <Label>Admin Routes *</Label>
              <AdminRoutesPicker
                values={watch("admin_routes")}
                onChange={(values) => setValue("admin_routes", values)}
              />
              <p className="text-muted-foreground mt-1 text-xs">Admin must have at least one route.</p>
            </div>
          )}

          <div>
            <Label htmlFor="create_designation">Designation</Label>
            <Input
              id="create_designation"
              {...register("companyRole")}
              placeholder="e.g., Senior Developer, Manager"
              className="mt-1.5"
            />
          </div>
        </div>
        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button
            onClick={onCreate}
            disabled={
              isCreating || !firstNameValue.trim() || !lastNameValue.trim() || !emailValue.trim() || !departmentValue
            }
            className="gap-2"
          >
            {isCreating ? (
              "Creating..."
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Create User
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
