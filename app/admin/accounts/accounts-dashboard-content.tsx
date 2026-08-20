"use client"

import type { ComponentType } from "react"
import Link from "next/link"
import {
  Landmark,
  CreditCard,
  Receipt,
  FileText,
  FileBarChart,
  ClipboardCheck,
  Wallet,
  ShoppingCart,
  Building2,
  Package,
  ChevronRight,
} from "lucide-react"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { Badge } from "@/components/ui/badge"
import { IconFill } from "@/components/ui/icon-fill"

interface ModuleCardProps {
  href: string
  icon: ComponentType<{ className?: string }>
  fillColor: string
  title: string
  badgeText: string
  badgeColorClass: string
  hoverBorderClass: string
  hoverTextClass: string
  iconColorClass: string
  description: string
  footerLabel: string
}

function ModuleCard({
  href,
  icon,
  fillColor,
  title,
  badgeText,
  badgeColorClass,
  hoverBorderClass,
  hoverTextClass,
  iconColorClass,
  description,
  footerLabel,
}: ModuleCardProps) {
  return (
    <Link href={href} className="group block">
      <div
        className={`bg-card border-border flex h-full flex-col justify-between rounded-xl border p-4.5 shadow-md transition-all duration-200 hover:-translate-y-0.5 ${hoverBorderClass} hover:shadow-xl`}
      >
        <div className="space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <IconFill
                icon={icon}
                fillColor={fillColor}
                className={`h-9 w-9 rounded-lg border ${badgeColorClass} ${iconColorClass} transition-transform duration-200 group-hover:scale-105`}
                iconClassName="h-5 w-5"
              />
              <h3 className={`text-foreground text-base font-semibold transition-colors ${hoverTextClass}`}>{title}</h3>
            </div>
            <Badge
              variant="outline"
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeColorClass} ${iconColorClass}`}
            >
              {badgeText}
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
        </div>
        <div className="border-border/40 mt-4 flex items-center justify-between border-t pt-2.5">
          <span className="text-muted-foreground text-[11px] font-medium">{footerLabel}</span>
          <IconFill
            icon={ChevronRight}
            fillColor={fillColor}
            hoverTextClassName="group-hover:text-white"
            className="border-border h-6 w-6 rounded-full border transition-all duration-200 group-hover:translate-x-0.5"
            iconClassName="text-muted-foreground h-3.5 w-3.5"
            aria-hidden="true"
          />
        </div>
      </div>
    </Link>
  )
}

export function AccountsDashboardContent({
  basePath,
  lockedDepartmentId,
}: { basePath?: string; lockedDepartmentId?: string } = {}) {
  const base = basePath ?? "/admin"
  const isDeptView = Boolean(lockedDepartmentId)

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Accounts"
        description={
          isDeptView
            ? "Manage department requisitions, payments, bills, invoices, reports, and assets"
            : "Manage requisitions, payments, bills, invoices, payroll, reports, purchasing, assets, and inventory"
        }
        icon={Landmark}
        backLink={{ href: base, label: isDeptView ? "Back to Dept" : "Back to Admin" }}
      />

      {/* Accounts Modules Grid */}
      <Section title={isDeptView ? "Department Accounts Modules" : "Accounts Modules"}>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {/* 1. Requisitions */}
          <ModuleCard
            href={`${base}/accounts/requisitions`}
            icon={ClipboardCheck}
            fillColor="bg-amber-500"
            title="Requisitions"
            badgeText="Funding Requests"
            badgeColorClass="border-amber-500/20 bg-amber-500/10"
            hoverBorderClass="hover:border-amber-500/60 dark:hover:border-amber-400/60"
            hoverTextClass="group-hover:text-amber-500"
            iconColorClass="text-amber-600 dark:text-amber-400"
            description="Manage purchase requisitions, funding requests, and department approvals"
            footerLabel="Requisition Workflow"
          />

          {/* 2. Payments */}
          <ModuleCard
            href={`${base}/accounts/payments`}
            icon={CreditCard}
            fillColor="bg-emerald-500"
            title="Payments"
            badgeText="Vouchers"
            badgeColorClass="border-emerald-500/20 bg-emerald-500/10"
            hoverBorderClass="hover:border-emerald-500/60 dark:hover:border-emerald-400/60"
            hoverTextClass="group-hover:text-emerald-500"
            iconColorClass="text-emerald-600 dark:text-emerald-400"
            description="Manage department payment vouchers, disbursements, and receipts"
            footerLabel="Payment Records"
          />

          {/* 3. Bills */}
          <ModuleCard
            href={`${base}/accounts/bills`}
            icon={Receipt}
            fillColor="bg-rose-500"
            title="Bills"
            badgeText="Vendor Bills"
            badgeColorClass="border-rose-500/20 bg-rose-500/10"
            hoverBorderClass="hover:border-rose-500/60 dark:hover:border-rose-400/60"
            hoverTextClass="group-hover:text-rose-500"
            iconColorClass="text-rose-600 dark:text-rose-400"
            description="Track vendor bills, payment due dates, and operational expenses"
            footerLabel="Payables & Expenses"
          />

          {/* 4. Invoices */}
          <ModuleCard
            href={`${base}/accounts/invoices`}
            icon={FileText}
            fillColor="bg-indigo-500"
            title="Invoices"
            badgeText="Client Billing"
            badgeColorClass="border-indigo-500/20 bg-indigo-500/10"
            hoverBorderClass="hover:border-indigo-500/60 dark:hover:border-indigo-400/60"
            hoverTextClass="group-hover:text-indigo-500"
            iconColorClass="text-indigo-600 dark:text-indigo-400"
            description="Create, send, and track client billing invoices and receivables"
            footerLabel="Receivables & Invoicing"
          />

          {/* 5. Payroll (Admin only) */}
          {!isDeptView && (
            <ModuleCard
              href="/admin/payroll"
              icon={Wallet}
              fillColor="bg-cyan-500"
              title="Payroll"
              badgeText="Salaries & Wages"
              badgeColorClass="border-cyan-500/20 bg-cyan-500/10"
              hoverBorderClass="hover:border-cyan-500/60 dark:hover:border-cyan-400/60"
              hoverTextClass="group-hover:text-cyan-500"
              iconColorClass="text-cyan-600 dark:text-cyan-400"
              description="Manage employee salaries, allowances, deductions, and pay slips"
              footerLabel="Payroll Management"
            />
          )}

          {/* 6. Finance Reports */}
          <ModuleCard
            href={`${base}/accounts/reports`}
            icon={FileBarChart}
            fillColor="bg-teal-500"
            title="Finance Reports"
            badgeText="Statements"
            badgeColorClass="border-teal-500/20 bg-teal-500/10"
            hoverBorderClass="hover:border-teal-500/60 dark:hover:border-teal-400/60"
            hoverTextClass="group-hover:text-teal-500"
            iconColorClass="text-teal-600 dark:text-teal-400"
            description="Financial summaries, spending analytics, and audit statements"
            footerLabel="Financial Statements"
          />

          {/* 7. Purchasing (Admin only) */}
          {!isDeptView && (
            <ModuleCard
              href="/admin/purchasing"
              icon={ShoppingCart}
              fillColor="bg-purple-500"
              title="Purchasing"
              badgeText="Procurement"
              badgeColorClass="border-purple-500/20 bg-purple-500/10"
              hoverBorderClass="hover:border-purple-500/60 dark:hover:border-purple-400/60"
              hoverTextClass="group-hover:text-purple-500"
              iconColorClass="text-purple-600 dark:text-purple-400"
              description="Manage suppliers, purchase orders, and goods receipts"
              footerLabel="Procurement & Orders"
            />
          )}

          {/* 8. Assets */}
          <ModuleCard
            href={`${base}/assets`}
            icon={Building2}
            fillColor="bg-sky-500"
            title="Assets"
            badgeText="Asset Tracker"
            badgeColorClass="border-sky-500/20 bg-sky-500/10"
            hoverBorderClass="hover:border-sky-500/60 dark:hover:border-sky-400/60"
            hoverTextClass="group-hover:text-sky-500"
            iconColorClass="text-sky-600 dark:text-sky-400"
            description="Track company assets, equipment assignments, and reported issues"
            footerLabel="Fixed Assets & Issues"
          />

          {/* 9. Inventory (Admin only) */}
          {!isDeptView && (
            <ModuleCard
              href="/admin/inventory"
              icon={Package}
              fillColor="bg-blue-500"
              title="Inventory"
              badgeText="Stock Manager"
              badgeColorClass="border-blue-500/20 bg-blue-500/10"
              hoverBorderClass="hover:border-blue-500/60 dark:hover:border-blue-400/60"
              hoverTextClass="group-hover:text-blue-500"
              iconColorClass="text-blue-600 dark:text-blue-400"
              description="Manage products, stock levels, categories, and warehouses"
              footerLabel="Stock & Warehouses"
            />
          )}
        </div>
      </Section>
    </PageWrapper>
  )
}
