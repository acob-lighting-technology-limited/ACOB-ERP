import { BaseService } from "../base.service"

/**
 * Attendance Service
 * Handles all attendance-related operations
 */
export class AttendanceService extends BaseService {
  constructor() {
    super("attendance_records")
  }

  /**
   * Get attendance records for an employee
   */
  async getEmployeeAttendance(
    employeeId: string,
    options?: {
      startDate?: string
      endDate?: string
      limit?: number
    }
  ) {
    const supabase = await this.getClient()

    let query = supabase
      .from("attendance_records")
      .select("*")
      .eq("employee_id", employeeId)
      .order("date", { ascending: false })

    if (options?.startDate) {
      query = query.gte("date", options.startDate)
    }

    if (options?.endDate) {
      query = query.lte("date", options.endDate)
    }

    if (options?.limit) {
      query = query.limit(options.limit)
    }

    const { data, error } = await query

    if (error) throw error
    return data
  }

  /**
   * Get attendance for a specific date
   */
  async getByDate(date: string, department?: string) {
    const supabase = await this.getClient()

    const query = supabase
      .from("attendance_records")
      .select(
        `
        *,
        employee:profiles(id, first_name, last_name, department)
      `
      )
      .eq("date", date)

    const { data, error } = await query

    if (error) throw error

    // Filter by department if provided
    if (department && data) {
      return data.filter((record: { employee?: { department?: string | null } | null }) => {
        return record.employee?.department === department
      })
    }

    return data
  }

  /**
   * Record clock in
   */
  async clockIn(employeeId: string) {
    const supabase = await this.getClient()
    const now = new Date()
    const today = now.toISOString().split("T")[0]
    const time = now.toTimeString().split(" ")[0]

    const { data, error } = await supabase
      .from("attendance_records")
      .insert({
        employee_id: employeeId,
        date: today,
        clock_in: time,
        status: "present",
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Record clock out
   */
  async clockOut(recordId: string) {
    const supabase = await this.getClient()
    const now = new Date()
    const time = now.toTimeString().split(" ")[0]

    const { data, error } = await supabase
      .from("attendance_records")
      .update({ clock_out: time })
      .eq("id", recordId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get attendance summary for an employee
   */
  async getEmployeeSummary(employeeId: string, month: number, year: number) {
    const supabase = await this.getClient()

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`
    const endDate = new Date(year, month, 0).toISOString().split("T")[0]

    const { data, error } = await supabase
      .from("attendance_records")
      .select("*")
      .eq("employee_id", employeeId)
      .gte("date", startDate)
      .lte("date", endDate)

    if (error) throw error

    const summary = {
      present: 0,
      absent: 0,
      late: 0,
      total: data?.length || 0,
    }

    data?.forEach((record: { status?: string | null }) => {
      if (record.status === "present") summary.present++
      if (record.status === "absent") summary.absent++
      if (record.status === "late") summary.late++
    })

    return summary
  }
}

// Export singleton instance
export const attendanceService = new AttendanceService()
