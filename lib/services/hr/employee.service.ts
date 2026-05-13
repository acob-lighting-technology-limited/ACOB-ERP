import { BaseService } from "../base.service"

/**
 * Employee Service
 * Handles all employee/employee related operations
 */
export class EmployeeService extends BaseService {
  constructor() {
    super("profiles")
  }

  /**
   * Get all employees with department info
   */
  async getAllEmployees(options?: { department?: string; role?: string; isActive?: boolean }) {
    const supabase = await this.getClient()

    let query = supabase.from("profiles").select("*").order("first_name", { ascending: true })

    if (options?.department) {
      query = query.eq("department", options.department)
    }

    if (options?.role) {
      query = query.eq("role", options.role)
    }

    const { data, error } = await query

    if (error) throw error
    return data
  }

  /**
   * Get employee by ID with full details
   */
  async getEmployeeById(id: string) {
    const supabase = await this.getClient()

    const { data, error } = await supabase.from("profiles").select("*").eq("id", id).single()

    if (error) throw error
    return data
  }

  /**
   * Update employee profile
   */
  async updateEmployee(
    id: string,
    data: {
      first_name?: string
      last_name?: string
      other_names?: string
      department?: string
      role?: string
      phone_number?: string
      additional_phone?: string
      office_location?: string
      residential_address?: string
      current_work_location?: string
      bank_name?: string
      bank_account_number?: string
      bank_account_name?: string
      date_of_birth?: string
      employment_date?: string
      job_description?: string
    }
  ) {
    const supabase = await this.getClient()

    const { data: updated, error } = await supabase.from("profiles").update(data).eq("id", id).select().single()

    if (error) throw error
    return updated
  }

  /**
   * Get employees by department
   */
  async getByDepartment(department: string) {
    return this.getAllEmployees({ department })
  }

  /**
   * Search employees by name
   */
  async searchByName(searchTerm: string) {
    const supabase = await this.getClient()

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`)
      .order("first_name", { ascending: true })

    if (error) throw error
    return data
  }
}

// Export singleton instance
export const employeeService = new EmployeeService()
