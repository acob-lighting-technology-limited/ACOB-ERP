/**
 * Standalone payslip print document.
 *
 * The dialog markup is styled with Tailwind classes, which do not exist in a
 * fresh print window — copying its innerHTML produces an unstyled text dump.
 * This module builds a self-contained A4 document with fully inline styles and
 * an absolute logo URL, then prints it from a hidden iframe (no popup blocker,
 * no race with `window.close()`).
 */

import { formatPayslipAmount, PAYSLIP_COMPANY_ADDRESS, type PayslipLine, type PayslipPrintData } from "./payslip-types"

export type { PayslipLine, PayslipPrintData }

const COMPANY_ADDRESS = PAYSLIP_COMPANY_ADDRESS

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Naira amount, always exactly two decimals. */
export function formatNaira(value: number): string {
  return `&#8358;${formatPayslipAmount(value)}`
}

function amountRows(lines: PayslipLine[], amountColor: string): string {
  return lines
    .map(
      ({ label, amount }) => `
        <tr>
          <td style="padding:3px 0;border-bottom:1px solid #f3f4f6;color:#4b5563;">${esc(label)}</td>
          <td style="padding:3px 0;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:${amountColor};white-space:nowrap;">${formatNaira(
            amount
          )}</td>
        </tr>`
    )
    .join("")
}

function totalRow(label: string, amount: number, amountColor: string): string {
  return `
    <tr>
      <td style="padding:6px 0 0;border-top:1px solid #d1d5db;font-weight:700;color:#111827;">${esc(label)}</td>
      <td style="padding:6px 0 0;border-top:1px solid #d1d5db;text-align:right;font-weight:700;color:${amountColor};white-space:nowrap;">${formatNaira(
        amount
      )}</td>
    </tr>`
}

function column(title: string, accent: string, body: string): string {
  return `
    <td style="width:50%;vertical-align:top;padding:0 10px;">
      <div style="margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid ${accent}33;font-size:8.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${accent};">${esc(
        title
      )}</div>
      <table style="width:100%;border-collapse:collapse;font-size:10.5px;">
        <tbody>${body}</tbody>
      </table>
    </td>`
}

export function buildPayslipHtml(data: PayslipPrintData, origin: string): string {
  const statusColor = data.statusPaid ? "#059669" : "#d97706"
  const logo = `${origin}/images/exports/acob-lighting-full.png`

  const infoCell = (label: string, value: string, mono = false) => `
    <td style="width:50%;padding:4px 0;vertical-align:top;">
      <div style="font-size:8px;letter-spacing:0.8px;text-transform:uppercase;color:#9ca3af;">${esc(label)}</div>
      <div style="font-size:11px;font-weight:600;color:#1f2937;${
        mono ? "font-family:'Courier New',monospace;" : ""
      }">${esc(value)}</div>
    </td>`

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Payslip - ${esc(data.fullName)} - ${esc(data.periodName)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @page { size: A4 portrait; margin: 14mm; }
      body {
        font-family: "Segoe UI", Arial, Helvetica, sans-serif;
        font-size: 11px;
        color: #1f2937;
        background: #ffffff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      table { border-collapse: collapse; }
    </style>
  </head>
  <body>
    <div style="max-width:180mm;margin:0 auto;">

      <!-- Header -->
      <table style="width:100%;border-bottom:1px solid #e5e7eb;padding-bottom:10px;">
        <tr>
          <td style="vertical-align:top;">
            <img src="${esc(logo)}" alt="ACOB Lighting Technology Limited" style="width:200px;height:auto;display:block;" />
            <div style="margin-top:6px;font-size:9px;line-height:1.4;color:#6b7280;max-width:105mm;">${esc(
              COMPANY_ADDRESS
            )}</div>
            <div style="font-size:9px;color:#6b7280;">Email: info@acoblighting.com &nbsp;|&nbsp; Web: www.acoblighting.com</div>
          </td>
          <td style="vertical-align:top;text-align:right;white-space:nowrap;">
            <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#047857;">Payslip</div>
            <div style="font-size:9px;color:#6b7280;">Period: <span style="font-weight:600;color:#374151;">${esc(
              data.periodName
            )}</span></div>
            <div style="font-size:9px;color:#6b7280;">Pay Date: <span style="font-weight:600;color:#374151;">${esc(
              data.payDate
            )}</span></div>
            <div style="margin-top:4px;font-size:9px;font-weight:700;text-transform:uppercase;color:${statusColor};">&#9679; ${esc(
              data.statusLabel
            )}</div>
          </td>
        </tr>
      </table>

      <!-- Employee info -->
      <table style="width:100%;margin-top:14px;background:#f9fafb;border:1px solid #f3f4f6;border-radius:4px;padding:8px 14px;">
        <tr>
          ${infoCell("Employee Name", data.fullName)}
          ${infoCell("Staff ID", data.employeeNumber, true)}
        </tr>
        <tr>
          ${infoCell("Department", data.department || "—")}
          ${infoCell("Designation", data.designation || "—")}
        </tr>
      </table>

      <!-- Earnings & deductions -->
      <table style="width:100%;margin-top:16px;table-layout:fixed;">
        <tr>
          ${column(
            "Earnings",
            "#047857",
            amountRows(data.earnings, "#1f2937") + totalRow(data.grossLabel, data.gross, "#111827")
          )}
          ${column(
            "Deductions",
            "#dc2626",
            amountRows(data.deductions, "#dc2626") + totalRow("Total Deductions", data.totalDeductions, "#dc2626")
          )}
        </tr>
      </table>

      <!-- Net pay -->
      <table style="width:100%;margin-top:18px;background:#059669;border-radius:6px;">
        <tr>
          <td style="padding:12px 18px;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Net Pay (Take Home)</td>
          <td style="padding:12px 18px;color:#ffffff;font-size:17px;font-weight:800;text-align:right;white-space:nowrap;">${formatNaira(
            data.netPay
          )}</td>
        </tr>
      </table>

      <!-- Signatures -->
      <table style="width:100%;margin-top:34px;">
        <tr>
          <td style="width:32%;border-top:1px solid #d1d5db;padding-top:4px;font-size:9px;text-align:center;color:#6b7280;">Employee Signature</td>
          <td style="width:36%;padding:0 12px;font-size:8.5px;text-align:center;color:#9ca3af;vertical-align:bottom;">This payslip is computer-generated and valid without a signature.</td>
          <td style="width:32%;border-top:1px solid #d1d5db;padding-top:4px;font-size:9px;text-align:center;color:#6b7280;">Authorised Signatory</td>
        </tr>
      </table>

    </div>
  </body>
</html>`
}

/** Renders the payslip in a hidden iframe and opens the browser print dialog. */
export function printPayslip(data: PayslipPrintData): void {
  if (typeof window === "undefined") return

  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;"
  iframe.srcdoc = buildPayslipHtml(data, window.location.origin)

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    iframe.remove()
  }

  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) {
      remove()
      return
    }
    win.addEventListener("afterprint", remove)
    win.focus()
    win.print()
    // Safari/Firefox may never fire afterprint — clean up regardless.
    window.setTimeout(remove, 60_000)
  }

  document.body.appendChild(iframe)
}
