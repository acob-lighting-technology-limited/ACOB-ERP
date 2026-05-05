type DbLikeError = {
  code?: string
  message?: string
}

export function isGovernanceSetupMissing(error: unknown): boolean {
  const candidate = error as DbLikeError | null
  if (!candidate) return false
  if (candidate.code === "42P01") return true // undefined_table
  if (candidate.code === "42883") return true // undefined_function
  const message = String(candidate.message || "").toLowerCase()
  return (
    message.includes("approval_workflows") ||
    message.includes("approval_workflow_stages") ||
    message.includes("access_paths") ||
    message.includes("access_path_role_rules") ||
    message.includes("is_path_allowed") ||
    message.includes("resolve_next_approver") ||
    message.includes("get_workflow_stages")
  )
}
