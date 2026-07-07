import type { Metadata } from "next"
import "./birthday1.css"

export const metadata: Metadata = {
  title: "Birthday Spotlight v1 | ACOB Lighting Technology Limited",
  description: "Celebrant Spotlight Version 1",
}

export default function BirthdayLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return <div className="birthday-route">{children}</div>
}
