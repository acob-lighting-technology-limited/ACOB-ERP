import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { logger } from "@/lib/logger"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
import { computePortfolioHealth, computeProjectHealth, type ProjectHealthTask } from "@/lib/projects/health"
import { toLocalISODate } from "@/lib/utils/date"

export const dynamic = "force-dynamic"
const log = logger("portfolios-api")

const PortfolioSchema = z.object({
  name: z.string().trim().min(1, "Portfolio name is required"),
  code: z.string().trim().max(32).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(["active", "on_hold", "closed"]).default("active"),
})

type ProjectRow = {
  id: string
  project_name: string
  portfolio_id: string | null
  deployment_start_date: string | null
  deployment_end_date: string | null
  status: string | null
  tasks: ProjectHealthTask[] | null
}

/**
 * GET /api/portfolios
 *
 * Returns each portfolio with its projects' health rolled up. Progress is
 * derived from the tasks on every read — nothing about delivery is stored, so
 * a portfolio can never report a figure its own tasks disagree with.
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`portfolios:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  try {
    const [{ data: portfolios, error: portfolioError }, { data: projects, error: projectError }] = await Promise.all([
      supabase.from("portfolios").select("*").order("name", { ascending: true }),
      supabase
        .from("projects")
        .select(
          `id, project_name, portfolio_id, deployment_start_date, deployment_end_date, status,
           tasks:tasks(id, status, weight, rating, is_archived, due_date, task_end_date)`
        )
        .order("project_name", { ascending: true }),
    ])

    if (portfolioError) throw portfolioError
    if (projectError) throw projectError

    const today = toLocalISODate()
    const projectsByPortfolio = new Map<string, ProjectRow[]>()
    for (const project of (projects || []) as ProjectRow[]) {
      const key = project.portfolio_id || ""
      const bucket = projectsByPortfolio.get(key) || []
      bucket.push(project)
      projectsByPortfolio.set(key, bucket)
    }

    const withHealth = (portfolioId: string) => {
      const rows = projectsByPortfolio.get(portfolioId) || []
      const health = rows.map((project) => ({
        id: project.id,
        project_name: project.project_name,
        // The lifecycle status the PM set by hand, kept distinct from the
        // derived health status the roll-up computes below.
        lifecycle_status: project.status,
        ...computeProjectHealth({
          startDate: project.deployment_start_date,
          endDate: project.deployment_end_date,
          tasks: project.tasks || [],
          today,
        }),
      }))
      return { projects: health, rollup: computePortfolioHealth(health) }
    }

    const data = (portfolios || []).map((portfolio) => ({ ...portfolio, ...withHealth(portfolio.id) }))

    // Projects created before portfolios existed, or deliberately left out of
    // one, still need somewhere to be seen rather than silently vanishing.
    const unassigned = withHealth("")

    return NextResponse.json({ data, unassigned })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to load portfolios")
    return apiError("Failed to load portfolios", ApiErrorCode.DATABASE_ERROR, 500)
  }
}

/** POST /api/portfolios — create a portfolio. Admin-only, enforced by RLS. */
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`portfolios-write:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) {
    return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError("Unauthorized", ApiErrorCode.UNAUTHORIZED, 401)

  const parsed = PortfolioSchema.safeParse(await request.json())
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Validation failed", ApiErrorCode.VALIDATION_ERROR, 400)
  }

  const { data, error } = await supabase
    .from("portfolios")
    .insert({
      name: parsed.data.name,
      code: parsed.data.code || null,
      description: parsed.data.description || null,
      status: parsed.data.status,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    log.error({ err: error.message }, "Failed to create portfolio")
    return apiError(error.message, ApiErrorCode.DATABASE_ERROR, 400)
  }

  return NextResponse.json({ data })
}
