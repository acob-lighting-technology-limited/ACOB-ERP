import { BaseService } from "../base.service"
import type { Database } from "@/types/database"

/**
 * Payment Service
 * Handles all payment-related operations
 */
export class PaymentService extends BaseService {
  constructor() {
    super("department_payments")
  }

  /**
   * Get all payments with department info
   */
  async getAllPayments(options?: {
    departmentId?: string
    paymentType?: "one-time" | "recurring"
    category?: string
    status?: string
  }) {
    const supabase = await this.getClient()

    let query = supabase
      .from("department_payments")
      .select(
        `
        *,
        department:departments(*),
        documents:payment_documents(id, document_type, file_path, file_name, applicable_date)
      `
      )
      .order("created_at", { ascending: false })

    if (options?.departmentId) {
      query = query.eq("department_id", options.departmentId)
    }

    if (options?.paymentType) {
      query = query.eq("payment_type", options.paymentType)
    }

    if (options?.category) {
      query = query.eq("category", options.category)
    }

    if (options?.status) {
      query = query.eq("status", options.status)
    }

    const { data, error } = await query

    if (error) throw error
    return data
  }

  /**
   * Get payment by ID with full details
   */
  async getPaymentById(id: string) {
    const supabase = await this.getClient()

    const { data, error } = await supabase
      .from("department_payments")
      .select(
        `
        *,
        department:departments(*),
        documents:payment_documents(*)
      `
      )
      .eq("id", id)
      .single()

    if (error) throw error
    return data
  }

  /**
   * Create a new payment
   */
  async createPayment(data: {
    department_id: string
    payment_type: "one-time" | "recurring"
    category: string
    title: string
    description?: string
    amount: number
    currency?: string
    recurrence_period?: string
    next_payment_due?: string
    payment_date?: string
    issuer_name: string
    issuer_phone_number: string
    issuer_address?: string
    payment_reference?: string
    notes?: string
    created_by: string
  }) {
    const supabase = await this.getClient()

    const paymentData = {
      ...data,
      currency: data.currency || "NGN",
      status: data.payment_type === "one-time" ? "paid" : "due",
    }

    const { data: created, error } = await supabase
      .from("department_payments")
      .insert(paymentData)
      .select(
        `
        *,
        department:departments(*)
      `
      )
      .single()

    if (error) throw error
    return created
  }

  /**
   * Update payment status
   */
  async updateStatus(id: string, status: string) {
    const supabase = await this.getClient()

    const { data, error } = await supabase.from("department_payments").update({ status }).eq("id", id).select().single()

    if (error) throw error
    return data
  }

  /**
   * Get payments by department
   */
  async getByDepartment(departmentId: string) {
    return this.getAllPayments({ departmentId })
  }

  /**
   * Get upcoming recurring payments
   */
  async getUpcomingPayments(daysAhead: number = 30) {
    const supabase = await this.getClient()

    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + daysAhead)

    const { data, error } = await supabase
      .from("department_payments")
      .select(
        `
        *,
        department:departments(*)
      `
      )
      .eq("payment_type", "recurring")
      .lte("next_payment_due", futureDate.toISOString().split("T")[0])
      .order("next_payment_due", { ascending: true })

    if (error) throw error
    return data
  }

  /**
   * Get payment statistics
   */
  async getStatistics(departmentId?: string) {
    const supabase = await this.getClient()

    let query = supabase.from("department_payments").select("*")

    if (departmentId) {
      query = query.eq("department_id", departmentId)
    }

    const { data, error } = await query

    if (error) throw error

    const stats = {
      total: data?.length || 0,
      oneTime: 0,
      recurring: 0,
      totalAmount: 0,
      paid: 0,
      due: 0,
    }

    type PaymentStatsRow = Pick<
      Database["public"]["Tables"]["department_payments"]["Row"],
      "payment_type" | "amount" | "status"
    >

    data?.forEach((payment: PaymentStatsRow) => {
      if (payment.payment_type === "one-time") stats.oneTime++
      if (payment.payment_type === "recurring") stats.recurring++
      stats.totalAmount += payment.amount || 0
      if (payment.status === "paid") stats.paid++
      if (payment.status === "due") stats.due++
    })

    return stats
  }
}

// Export singleton instance
export const paymentService = new PaymentService()
