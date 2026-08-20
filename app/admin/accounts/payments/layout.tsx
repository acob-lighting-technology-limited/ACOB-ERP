import type { ReactNode } from "react"

export default function AdminPaymentsLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <>
      {children}
      {modal}
    </>
  )
}
