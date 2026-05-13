import type { Metadata } from "next"
import "./birthday.css"

export const metadata: Metadata = {
  title: "Birthday Spotlight | ACOB Lighting Technology Limited",
  description: "Weekly birthday spotlight in the ERP",
}

export default function BirthdayLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <div className="birthday-route">{children}</div>
}
