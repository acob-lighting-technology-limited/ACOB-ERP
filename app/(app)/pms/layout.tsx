import type { ReactNode } from "react"

export default function PmsLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl">{children}</div>
}
