import { createClient } from "@/lib/supabase/server"

/**
 * Base service class with common patterns for all services.
 * Provides standardized CRUD operations and error handling.
 */
export abstract class BaseService {
  protected tableName: string

  constructor(tableName: string) {
    this.tableName = tableName
  }

  /**
   * Get Supabase client for server-side operations
   */
  protected async getClient() {
    return await createClient()
  }

  /**
   * Get all records with optional filters
   */
  async getAll(options?: {
    filters?: Record<string, unknown>
    orderBy?: { column: string; ascending?: boolean }
    limit?: number
    offset?: number
  }) {
    const supabase = await this.getClient()

    let query = supabase.from(this.tableName).select("*")

    if (options?.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value)
        }
      })
    }

    if (options?.orderBy) {
      query = query.order(options.orderBy.column, {
        ascending: options.orderBy.ascending ?? true,
      })
    }

    if (options?.limit) {
      query = query.limit(options.limit)
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 10) - 1)
    }

    const { data, error } = await query

    if (error) throw error
    return data
  }

  /**
   * Get a single record by ID
   */
  async getById(id: string) {
    const supabase = await this.getClient()

    const { data, error } = await supabase.from(this.tableName).select("*").eq("id", id).single()

    if (error) throw error
    return data
  }

  /**
   * Create a new record
   */
  async create(data: Record<string, unknown>) {
    const supabase = await this.getClient()

    const { data: created, error } = await supabase.from(this.tableName).insert(data).select().single()

    if (error) throw error
    return created
  }

  /**
   * Update an existing record
   */
  async update(id: string, data: Record<string, unknown>) {
    const supabase = await this.getClient()

    const { data: updated, error } = await supabase.from(this.tableName).update(data).eq("id", id).select().single()

    if (error) throw error
    return updated
  }

  /**
   * Delete a record
   */
  async delete(id: string) {
    const supabase = await this.getClient()

    const { error } = await supabase.from(this.tableName).delete().eq("id", id)

    if (error) throw error
    return true
  }

  /**
   * Count records with optional filters
   */
  async count(filters?: Record<string, unknown>) {
    const supabase = await this.getClient()

    let query = supabase.from(this.tableName).select("*", { count: "exact", head: true })

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value)
        }
      })
    }

    const { count, error } = await query

    if (error) throw error
    return count ?? 0
  }
}
