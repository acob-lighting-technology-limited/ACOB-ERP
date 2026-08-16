"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// Regular CBT questions moved to the department-lead view; there's no
// admin-side cycle deep link to send this to anymore.
export default function AdminPmsCbtCycleRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/admin/hr/pms/cbt")
  }, [router])

  return null
}
