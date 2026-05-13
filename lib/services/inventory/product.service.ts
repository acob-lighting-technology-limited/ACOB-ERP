import { BaseService } from "../base.service"

export interface ProductCategoryFields {
  id?: string
  name: string
  description?: string
  created_at?: string
  updated_at?: string
}

export interface ProductFields {
  id?: string
  sku: string
  name: string
  description?: string
  category_id?: string
  unit_cost: number
  selling_price: number
  quantity_on_hand: number
  reorder_level: number
  status: "active" | "inactive" | "discontinued"
  created_by?: string
  created_at?: string
  updated_at?: string
}

type ProductRow = ProductFields & {
  id: string
  created_at: string
  updated_at: string
}
type ProductWithCategoryRow = ProductRow & {
  category?: {
    name: string | null
  } | null
}

/**
 * Service for managing products in the inventory module.
 */
export class ProductService extends BaseService {
  constructor() {
    super("products")
  }

  /**
   * Get all products with category names
   */
  async getAllWithCategories() {
    const supabase = await this.getClient()

    const { data, error } = await supabase
      .from(this.tableName)
      .select("*, category:product_categories(name)")
      .order("name")

    if (error) {
      if (error.code === "42P01") {
        // Table doesn't exist yet
        return []
      }
      throw error
    }

    return ((data || []) as ProductWithCategoryRow[]).map((product) => ({
      ...product,
      category_name: product.category?.name,
    }))
  }

  /**
   * Get products with low stock (at or below reorder level)
   */
  async getLowStockProducts() {
    const supabase = await this.getClient()

    const { data, error } = await supabase.from(this.tableName).select("*")

    if (error) throw error
    return ((data || []) as ProductRow[]).filter((product) => product.quantity_on_hand <= product.reorder_level)
  }

  /**
   * Get product statistics
   */
  async getStats() {
    const supabase = await this.getClient()

    const [totalResult, activeResult, productsResult] = await Promise.all([
      supabase.from(this.tableName).select("*", { count: "exact", head: true }),
      supabase.from(this.tableName).select("*", { count: "exact", head: true }).eq("status", "active"),
      supabase.from(this.tableName).select("unit_cost, quantity_on_hand, reorder_level"),
    ])

    if (totalResult.error) throw totalResult.error
    if (activeResult.error) throw activeResult.error
    if (productsResult.error) throw productsResult.error

    const products = productsResult.data || []
    const typedProducts = products as Pick<ProductRow, "unit_cost" | "quantity_on_hand" | "reorder_level">[]
    const lowStock = typedProducts.filter((product) => product.quantity_on_hand <= product.reorder_level).length
    const totalValue = typedProducts.reduce(
      (sum: number, product) => sum + product.unit_cost * product.quantity_on_hand,
      0
    )

    return {
      total: totalResult.count || 0,
      active: activeResult.count || 0,
      lowStock,
      totalValue,
    }
  }

  /**
   * Update product stock quantity
   */
  async updateStock(id: string, quantity: number) {
    return this.update(id, { quantity_on_hand: quantity })
  }
}

export const productService = new ProductService()
