import type { ReactNode } from "react"
import { PmsNav } from "./_components/pms-nav"

export default function PmsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl">
      <PmsNav />
      {children}
    </div>
  )
}
