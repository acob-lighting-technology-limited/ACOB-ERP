import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, degrees } from "pdf-lib"

export interface HandoverPolicyData {
  employeeName?: string
  department?: string
  designation?: string
  residentialAddress?: string
  assetType?: string
  assetModel?: string
  assetBrand?: string
  serialNumber?: string
  uniqueCode?: string
  accessories?: string
  condition?: string
  handoverDate?: string
  signatureDate?: string
  issuingStaffName?: string
  includeDate?: boolean
}

// Brand Colors
const BRAND_GREEN = rgb(0 / 255, 128 / 255, 60 / 255) // #00803C
const FOREST_GREEN = rgb(0 / 255, 75 / 255, 35 / 255) // #004B23
const TEXT_BLACK = rgb(17 / 255, 24 / 255, 39 / 255) // #111827
const MUTED_GRAY = rgb(107 / 255, 114 / 255, 128 / 255) // #6B7280
const BORDER_BLACK = rgb(0, 0, 0)
const WHITE = rgb(1, 1, 1)

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN_X = 54
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2

// Typography — matched against the source Word document (Calibri 11pt body / 13pt bold headings)
const BODY_SIZE = 11
const BODY_LINE_HEIGHT = 13.5
const HEADING_SIZE = 13
const HEADING_GAP = 16
const TABLE_SIZE = 10.5

function drawDashedLine(
  page: PDFPage,
  start: { x: number; y: number },
  end: { x: number; y: number },
  thickness: number,
  color: any,
  dashLength = 4,
  gapLength = 3
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const totalLength = Math.sqrt(dx * dx + dy * dy)
  if (totalLength === 0) return

  const ux = dx / totalLength
  const uy = dy / totalLength

  let traveled = 0
  let drawing = true

  while (traveled < totalLength) {
    const segLength = drawing ? dashLength : gapLength
    const nextTraveled = Math.min(traveled + segLength, totalLength)

    if (drawing) {
      page.drawLine({
        start: { x: start.x + ux * traveled, y: start.y + uy * traveled },
        end: { x: start.x + ux * nextTraveled, y: start.y + uy * nextTraveled },
        thickness,
        color,
      })
    }

    traveled = nextTraveled
    drawing = !drawing
  }
}

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean)
  const lines: string[] = []
  let currentLine = ""

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = word
    }
  }

  if (currentLine) lines.push(currentLine)
  return lines.length > 0 ? lines : [""]
}

async function fetchLogoBytes(): Promise<Uint8Array | null> {
  try {
    const res = await fetch("/images/exports/acob-lighting-full.png")
    if (res.ok) {
      const buf = await res.arrayBuffer()
      return new Uint8Array(buf)
    }
  } catch {
    // Fallback if not in browser or unavailable
  }
  return null
}

// Draws everything except the "Page X of Y" footer number, which depends on the
// final page count and is filled in by drawPageNumbers() once the document is complete.
function drawHeader(page: PDFPage, title: string, logoImage: any | null, fontReg: PDFFont, fontBold: PDFFont) {
  const topY = PAGE_HEIGHT - 32

  if (logoImage) {
    const logoScale = logoImage.scaleToFit(130, 24)
    page.drawImage(logoImage, {
      x: MARGIN_X,
      y: topY - logoScale.height + 2,
      width: logoScale.width,
      height: logoScale.height,
    })
  }

  page.drawText("ACOB LIGHTING TECHNOLOGY LIMITED", {
    x: PAGE_WIDTH - MARGIN_X - fontBold.widthOfTextAtSize("ACOB LIGHTING TECHNOLOGY LIMITED", 8.5),
    y: topY,
    size: 8.5,
    font: fontBold,
    color: TEXT_BLACK,
  })

  page.drawText(title, {
    x: PAGE_WIDTH - MARGIN_X - fontBold.widthOfTextAtSize(title, 9.5),
    y: topY - 12,
    size: 9.5,
    font: fontBold,
    color: TEXT_BLACK,
  })

  const lineY = topY - 26
  page.drawLine({
    start: { x: MARGIN_X, y: lineY },
    end: { x: PAGE_WIDTH - MARGIN_X, y: lineY },
    thickness: 1,
    color: BRAND_GREEN,
  })
}

function drawFooters(doc: PDFDocument, fontReg: PDFFont) {
  const pageCount = doc.getPageCount()
  const footerY = 32
  const pages = doc.getPages()

  // Skip cover page (page 0), number content pages from page 2 to pageCount
  for (let i = 1; i < pageCount; i++) {
    const page = pages[i]

    page.drawText("ACOB LIGHTING TECHNOLOGY LIMITED | Asset Handover Policy", {
      x: MARGIN_X,
      y: footerY,
      size: 8,
      font: fontReg,
      color: MUTED_GRAY,
    })

    const pageStr = `Page ${i + 1} of ${pageCount}`
    page.drawText(pageStr, {
      x: PAGE_WIDTH - MARGIN_X - fontReg.widthOfTextAtSize(pageStr, 8),
      y: footerY,
      size: 8,
      font: fontReg,
      color: MUTED_GRAY,
    })
  }
}

export async function generateHandoverPolicyPDFBlob(data: HandoverPolicyData): Promise<Blob> {
  const doc = await PDFDocument.create()
  const fontReg = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  const logoBytes = await fetchLogoBytes()
  let logoImage: any = null
  if (logoBytes) {
    try {
      logoImage = await doc.embedPng(logoBytes)
    } catch {
      // ignore
    }
  }

  const effectiveHandoverDate = data.includeDate !== false && data.handoverDate ? data.handoverDate : ""
  const effectiveSignatureDate = data.includeDate !== false ? data.signatureDate || data.handoverDate || "" : ""
  const tableX = MARGIN_X
  const tableWidth = CONTENT_WIDTH

  // Extract brand if not provided
  let brand = data.assetBrand || ""
  if (!brand && data.assetModel) {
    const parts = data.assetModel.trim().split(" ")
    if (parts.length > 0) brand = parts[0]
  }

  // ==========================================
  // PAGE 1: COVER PAGE
  // ==========================================
  const page1 = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  const frameLeft = MARGIN_X
  const frameRight = PAGE_WIDTH - MARGIN_X
  const frameTop = PAGE_HEIGHT - 90
  const frameBottom = 75
  const frameWidth = frameRight - frameLeft
  const frameHeight = frameTop - frameBottom

  page1.drawRectangle({
    x: frameLeft,
    y: frameBottom,
    width: frameWidth,
    height: frameHeight,
    borderColor: BRAND_GREEN,
    borderWidth: 1.5,
    color: WHITE,
  })

  if (logoImage) {
    const logoScale = logoImage.scaleToFit(175, 34)
    const logoX = frameLeft + 12
    const logoY = frameTop - logoScale.height / 2

    page1.drawRectangle({
      x: logoX - 4,
      y: logoY - 3,
      width: logoScale.width + 8,
      height: logoScale.height + 6,
      color: WHITE,
    })

    page1.drawImage(logoImage, {
      x: logoX,
      y: logoY,
      width: logoScale.width,
      height: logoScale.height,
    })
  }

  const drawOrnament = (pg: PDFPage, centerY: number) => {
    const midX = frameLeft + frameWidth / 2
    const lineLen = 60
    const dSize = 7
    drawDashedLine(pg, { x: midX - lineLen - 12, y: centerY }, { x: midX - 12, y: centerY }, 1.2, BRAND_GREEN)
    pg.drawRectangle({
      x: midX - dSize / 2,
      y: centerY - dSize / 2,
      width: dSize,
      height: dSize,
      color: BRAND_GREEN,
      rotate: degrees(45),
    })
    drawDashedLine(pg, { x: midX + 12, y: centerY }, { x: midX + lineLen + 12, y: centerY }, 1.2, BRAND_GREEN)
  }

  const titleY = frameBottom + frameHeight / 2 + 20
  drawOrnament(page1, titleY + 76)

  const line1 = "COMPANY ASSET"
  const line2 = "HANDOVER POLICY"
  const sz1 = 32
  const w1 = fontBold.widthOfTextAtSize(line1, sz1)
  const w2 = fontBold.widthOfTextAtSize(line2, sz1)

  page1.drawText(line1, {
    x: frameLeft + (frameWidth - w1) / 2,
    y: titleY + 18,
    size: sz1,
    font: fontBold,
    color: TEXT_BLACK,
  })

  page1.drawText(line2, {
    x: frameLeft + (frameWidth - w2) / 2,
    y: titleY - 24,
    size: sz1,
    font: fontBold,
    color: TEXT_BLACK,
  })

  drawOrnament(page1, titleY - 78)

  // ==========================================
  // PAGES 2+: POLICIES & PROCEDURES (flows across as many pages as the content needs)
  // ==========================================
  const POLICY_TITLE = "COMPANY ASSET HANDOVER POLICY"
  const CONTENT_BOTTOM = 62

  let currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let activeTitle = POLICY_TITLE
  drawHeader(currentPage, activeTitle, logoImage, fontReg, fontBold)
  let curY = PAGE_HEIGHT - 82

  const startNewPage = () => {
    currentPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    drawHeader(currentPage, activeTitle, logoImage, fontReg, fontBold)
    curY = PAGE_HEIGHT - 82
  }

  const ensureSpace = (height: number) => {
    if (curY - height < CONTENT_BOTTOM) startNewPage()
  }

  const drawHeading = (text: string) => {
    ensureSpace(HEADING_SIZE + HEADING_GAP)
    currentPage.drawText(text, {
      x: MARGIN_X,
      y: curY,
      size: HEADING_SIZE,
      font: fontBold,
      color: FOREST_GREEN,
    })
    curY -= HEADING_GAP
  }

  const drawParagraph = (text: string, indent = 0) => {
    const lines = wrapText(text, CONTENT_WIDTH - indent, fontReg, BODY_SIZE)
    ensureSpace(lines.length * BODY_LINE_HEIGHT)
    for (const l of lines) {
      currentPage.drawText(l, {
        x: MARGIN_X + indent,
        y: curY,
        size: BODY_SIZE,
        font: fontReg,
        color: TEXT_BLACK,
      })
      curY -= BODY_LINE_HEIGHT
    }
    curY -= 4
  }

  const drawBullet = (title: string, text: string) => {
    const titleWidth = fontBold.widthOfTextAtSize(title, BODY_SIZE)
    const indentWidth = CONTENT_WIDTH - 22

    // First line shares the row with the bold title, so it gets less width than
    // the fully-indented continuation lines below it.
    const words = text.split(/\s+/).filter(Boolean)
    let firstLine = ""
    let rest = words
    for (let i = 0; i < words.length; i++) {
      const candidate = firstLine ? `${firstLine} ${words[i]}` : words[i]
      if (fontReg.widthOfTextAtSize(candidate, BODY_SIZE) <= indentWidth - titleWidth - 4) {
        firstLine = candidate
      } else {
        rest = words.slice(i)
        break
      }
      rest = []
    }
    const continuationLines = rest.length > 0 ? wrapText(rest.join(" "), indentWidth, fontReg, BODY_SIZE) : []

    ensureSpace((1 + continuationLines.length) * BODY_LINE_HEIGHT)
    currentPage.drawCircle({ x: MARGIN_X + 11, y: curY + 3.5, size: 2.6, color: BRAND_GREEN })
    currentPage.drawText(title, { x: MARGIN_X + 22, y: curY, size: BODY_SIZE, font: fontBold, color: TEXT_BLACK })
    currentPage.drawText(firstLine, {
      x: MARGIN_X + 22 + titleWidth + 4,
      y: curY,
      size: BODY_SIZE,
      font: fontReg,
      color: TEXT_BLACK,
    })
    curY -= BODY_LINE_HEIGHT
    for (const line of continuationLines) {
      currentPage.drawText(line, { x: MARGIN_X + 22, y: curY, size: BODY_SIZE, font: fontReg, color: TEXT_BLACK })
      curY -= BODY_LINE_HEIGHT
    }
    curY -= 4
  }

  drawHeading("1. Scope and Purpose")
  drawParagraph(
    "This Company Asset Handover Policy aims to establish guidelines for proper handover of Company proprieties issued to employees, and to ensure a secure and orderly transfer of the assets upon the termination of the employment of an employee, or the employee's exit from the organization, or employee's change of roles as the case may be."
  )
  drawParagraph(
    "The Company Assets is broken into three (3) categories which includes Physical Assets, Digital Assets and Confidential Information and such other property or properties that the Company may put in custody of any or all of the employees, contractors or such other person that may be in custody of the property."
  )

  drawBullet(
    "Physical Assets:",
    "includes but not limited to Laptops, Phones, CUG Lines, Safety Gears, Site/Engineering Tools, Flash Drives, Identification Card, Keys, Hard Drives, Extension Boxes, Cameras, Media Equipment, Meeting Speaker, Printers, Cars, E.t.c."
  )
  drawBullet(
    "Digital Assets:",
    "includes but not limited to Emails, Software access, Data files, Documents Templates, Passwords and Logins, Documents, Intellectual Property, e.t.c."
  )
  drawBullet(
    "Confidential Information:",
    "includes but not limited to Trade Secrets, Client Data, Client Contact, Business Strategies, e.t.c."
  )

  curY -= 4
  drawHeading("2. Parties Responsibilities:")
  drawParagraph(
    "Employee: Employee must ensure that every company asset within his or her care is handed over before the exit the organization. The Employee must ensure proper handover of every company asset within his or her care before departure from the organization. As it is the responsibility of all employees to ensure that company resources are used in a proper and efficient manner, while also ensuring that they are maintained in good condition and protected against potential risks such as loss, theft or damage, employee must therefore ensure that the Company Assets are handed over in good condition before his or her exit."
  )
  drawParagraph(
    "Employees who is found to have lost, stolen or misused Company property may be held personally responsible for the replacement or repair of such items."
  )
  drawParagraph(
    "Management: The Management which includes the Human Resources Lead, and the Senior Management must inspect the assets handed over by the employee, to ensure they are in good condition. The Management will also confirm with the record of assigned assets kept with the company that all company assets with the employee are well and successfully handed over before the employee is allowed to take an exit from the organization."
  )
  drawParagraph(
    "Information Technology Department: The Information Technology Department is tasked with the responsibility of assisting departing Employee with digital asset transfer and security. An officer of the Information Technology department will ensure that the Digital Assets are well transferred into the company archive and further ensure full protection of the company by ensuring the departing employee will no longer have access to the digital assets."
  )

  curY -= 4
  drawHeading("3. Procedure of Handover:")
  drawParagraph(
    "Upon employee submission of Notice to Quit, or a Notice of the termination of the employee's employment by the organization, the next step shall be the handover of the Company Assets that are with the employee."
  )
  drawParagraph(
    "The Human Resource Lead shall together with the employee identify and proceed to make a list of the Company Asset that are with the employee. The Human Resources Lead will then mandate the Employee to hand over the Assets before Employee's final exit date and time as contained in the Employee's Notice to Quit or Notice of Termination."
  )
  drawParagraph("The Employee will subsequently transfer the assets to the Company through the Human Resources Lead.")
  drawParagraph(
    "The Human Resources Lead will inform the Senior Management of the transfer, the Senior Management will in turn make a verification of the transferred Assets which includes the verification of their state at the point of transfer, and confirm that all assets have thus been transferred."
  )
  drawParagraph(
    "The Information Technology Department will subsequently ensure that all digital assets are transferred and secured and will share the secured assets with the Senior Management through the Human Resources Lead."
  )

  curY -= 4
  drawHeading("4. Consequences of Non-Compliance:")
  drawParagraph(
    "Where an Employee fails to comply with the company's procedure for handing over of assets, or fail to transfer the Company assets assigned to him or her to the Company before his or her exit, the Employee may be subject to the following sanctions which includes but not limited to:"
  )
  drawParagraph(
    "Delay or Denial of Final Payments and Employee's Benefits: The organization may decide to delay or deny the final payment of such Employee. This will include situations where the Employee hand over some, but fails to hand over all other assets in his/her care."
  )
  drawParagraph(
    "Legal Action: Where an Employee holds on to company asset at departure and refuses to hand over same, the Company will take Legal action against the employee. This may include instituting a civil or criminal case in a competent court of jurisdiction, or engaging Law Enforcement Agents to ensure the procurement of the assets."
  )
  drawParagraph("This will be subject to the prerogative of the Senior Management.")

  curY -= 4
  drawHeading("5. Acknowledgment of Return:")
  drawParagraph(
    "Upon returning the Company Assets, an acknowledgment will be made by the authorized officer designated to receive the assets. The acknowledgement will certify the departing employee of having returned all assets within his/her care in good condition."
  )

  curY -= 4
  drawHeading("6. Acknowledgment:")
  drawParagraph(
    "Having read and fully understood this policy, I acknowledge same, and hereby agree that all the terms as contained herein should be fully binding on me."
  )

  curY -= 12

  const rowHeight = 30
  const col1Width = 180

  // Table 2 exactly as in template:
  // Row 0: ['Employee Name:', '']
  // Row 1: ['Department:', '']
  // Row 2: ['Employee Home Address:', '']
  // Row 3: ['Employee Signature:', 'Date:']
  const p3Rows = [
    { label: "Employee Name:", val: data.employeeName || "" },
    { label: "Department:", val: data.department || "" },
    { label: "Employee Home Address:", val: data.residentialAddress || "" },
  ]

  ensureSpace(rowHeight * 4)
  let tY = curY
  for (let i = 0; i < p3Rows.length; i++) {
    const r = p3Rows[i]
    currentPage.drawRectangle({
      x: tableX,
      y: tY - rowHeight,
      width: tableWidth,
      height: rowHeight,
      borderColor: BORDER_BLACK,
      borderWidth: 1,
      color: WHITE,
    })

    currentPage.drawLine({
      start: { x: tableX + col1Width, y: tY },
      end: { x: tableX + col1Width, y: tY - rowHeight },
      thickness: 1,
      color: BORDER_BLACK,
    })

    currentPage.drawText(r.label, {
      x: tableX + 10,
      y: tY - 19,
      size: TABLE_SIZE,
      font: fontBold,
      color: TEXT_BLACK,
    })

    if (r.val) {
      currentPage.drawText(r.val, {
        x: tableX + col1Width + 10,
        y: tY - 19,
        size: TABLE_SIZE,
        font: fontReg,
        color: TEXT_BLACK,
      })
    }

    tY -= rowHeight
  }

  // Row 3: Col 0: Employee Signature:, Col 1: Date: [val]
  currentPage.drawRectangle({
    x: tableX,
    y: tY - rowHeight,
    width: tableWidth,
    height: rowHeight,
    borderColor: BORDER_BLACK,
    borderWidth: 1,
    color: WHITE,
  })

  currentPage.drawLine({
    start: { x: tableX + col1Width, y: tY },
    end: { x: tableX + col1Width, y: tY - rowHeight },
    thickness: 1,
    color: BORDER_BLACK,
  })

  currentPage.drawText("Employee Signature:", {
    x: tableX + 10,
    y: tY - 19,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })

  currentPage.drawText("Date:", {
    x: tableX + col1Width + 10,
    y: tY - 19,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })

  if (effectiveSignatureDate) {
    currentPage.drawText(effectiveSignatureDate, {
      x: tableX + col1Width + 48,
      y: tY - 19,
      size: TABLE_SIZE,
      font: fontReg,
      color: TEXT_BLACK,
    })
  }

  // ==========================================
  // PAGE: HANDOVER FORM (Tables 4, 5, 6, 7) — always starts on its own page
  // ==========================================
  activeTitle = "Company Asset Handover Form"
  startNewPage()
  const page4 = currentPage

  const drawExactTable = (
    pg: PDFPage,
    rows: {
      c1Label: string
      c1Val?: string
      c2Label?: string
      c2Val?: string
      c3Label?: string
      c3Val?: string
      c4Label?: string
      c4Val?: string
    }[],
    colWidths: number[]
  ) => {
    let y = curY
    const rHeight = 27
    for (const r of rows) {
      pg.drawRectangle({
        x: tableX,
        y: y - rHeight,
        width: tableWidth,
        height: rHeight,
        borderColor: BORDER_BLACK,
        borderWidth: 1,
        color: WHITE,
      })

      let curX = tableX
      for (let c = 0; c < colWidths.length - 1; c++) {
        curX += colWidths[c]
        pg.drawLine({
          start: { x: curX, y: y },
          end: { x: curX, y: y - rHeight },
          thickness: 1,
          color: BORDER_BLACK,
        })
      }

      if (colWidths.length === 2) {
        pg.drawText(r.c1Label, { x: tableX + 8, y: y - 18, size: TABLE_SIZE, font: fontBold, color: TEXT_BLACK })
        if (r.c1Val) {
          pg.drawText(r.c1Val, {
            x: tableX + colWidths[0] + 8,
            y: y - 18,
            size: TABLE_SIZE,
            font: fontReg,
            color: TEXT_BLACK,
          })
        }
      } else if (colWidths.length === 4) {
        pg.drawText(r.c1Label, { x: tableX + 8, y: y - 18, size: TABLE_SIZE, font: fontBold, color: TEXT_BLACK })
        if (r.c1Val) {
          pg.drawText(r.c1Val, {
            x: tableX + colWidths[0] + 8,
            y: y - 18,
            size: TABLE_SIZE,
            font: fontReg,
            color: TEXT_BLACK,
          })
        }
        const x3 = tableX + colWidths[0] + colWidths[1]
        const x4 = x3 + colWidths[2]
        if (r.c2Label) {
          pg.drawText(r.c2Label, { x: x3 + 8, y: y - 18, size: TABLE_SIZE, font: fontBold, color: TEXT_BLACK })
        }
        if (r.c2Val) {
          pg.drawText(r.c2Val, { x: x4 + 8, y: y - 18, size: TABLE_SIZE, font: fontReg, color: TEXT_BLACK })
        }
      }

      y -= rHeight
    }
    curY = y - 22
  }

  // Section 1: Employee Details
  drawHeading("Employee Details")
  drawExactTable(
    page4,
    [
      { c1Label: "Name:", c1Val: data.employeeName || "", c2Label: "Department:", c2Val: data.department || "" },
      {
        c1Label: "Position:",
        c1Val: data.designation || "",
        c2Label: "Date of Handover:",
        c2Val: effectiveHandoverDate,
      },
    ],
    [60, 150, 110, 184]
  )

  // Section 2: Asset Details
  drawHeading("Asset Details")
  drawExactTable(
    page4,
    [
      { c1Label: "Asset Type:", c1Val: data.assetType || "" },
      {
        c1Label: "Serial Number/ID:",
        c1Val: data.serialNumber
          ? data.uniqueCode
            ? `${data.serialNumber} (${data.uniqueCode})`
            : data.serialNumber
          : data.uniqueCode || "",
      },
      { c1Label: "Accessories:", c1Val: data.accessories || "" },
    ],
    [150, 354]
  )

  // Section 3: Asset Return
  drawHeading("Asset Return")
  drawExactTable(
    page4,
    [
      { c1Label: "Date of Return:", c1Val: "" },
      { c1Label: "Condition of Asset (Upon Return) :", c1Val: data.condition || "" },
      { c1Label: "Note (If any):", c1Val: "" },
    ],
    [210, 294]
  )

  // Section 4: Acknowledgement of Return
  drawHeading("Acknowledgement of Return")
  const ackLine = data.employeeName
    ? `I, ${data.employeeName}, confirm that the above-mentioned assets have been returned in the condition stated above.`
    : "I, __________________________________________________, confirm that the above-mentioned assets have been returned in the condition stated above."
  drawParagraph(ackLine)
  curY -= 4

  // Table 7 (2x2):
  // Row 0: ['Employee Signature:', 'Date:']
  // Row 1: ['HR Representative Signature:', 'Date:']
  const sigRowHeight = 28
  const sigCol1 = 340
  const sigCol2 = tableWidth - sigCol1
  let sY = curY
  const sigRows = ["Employee Signature:", "HR Representative Signature:"]

  for (const sLabel of sigRows) {
    page4.drawRectangle({
      x: tableX,
      y: sY - sigRowHeight,
      width: tableWidth,
      height: sigRowHeight,
      borderColor: BORDER_BLACK,
      borderWidth: 1,
      color: WHITE,
    })

    page4.drawLine({
      start: { x: tableX + sigCol1, y: sY },
      end: { x: tableX + sigCol1, y: sY - sigRowHeight },
      thickness: 1,
      color: BORDER_BLACK,
    })

    page4.drawText(sLabel, { x: tableX + 8, y: sY - 18, size: TABLE_SIZE, font: fontBold, color: TEXT_BLACK })
    page4.drawText("Date:", {
      x: tableX + sigCol1 + 8,
      y: sY - 18,
      size: TABLE_SIZE,
      font: fontBold,
      color: TEXT_BLACK,
    })

    sY -= sigRowHeight
  }

  // ==========================================
  // PAGE: STAFF LAPTOP USAGE POLICY ACCEPTANCE FORM (Tables 9, 10, 11) — its own page
  // ==========================================
  activeTitle = "STAFF LAPTOP USAGE POLICY ACCEPTANCE FORM"
  startNewPage()
  const page5 = currentPage

  // Table 9 (3x2):
  // Row 0: ['Laptop Serial Number:', '']
  // Row 1: ['Laptop Model:', '']
  // Row 2: ['Laptop brand:', '']
  const t9Rows = [
    { label: "Laptop Serial Number:", val: data.serialNumber || "" },
    { label: "Laptop Model:", val: data.assetModel || "" },
    { label: "Laptop brand:", val: brand || "" },
  ]

  let t9Y = curY
  const t9RowHeight = 28
  const t9Col1 = 190

  for (const r of t9Rows) {
    page5.drawRectangle({
      x: tableX,
      y: t9Y - t9RowHeight,
      width: tableWidth,
      height: t9RowHeight,
      borderColor: BORDER_BLACK,
      borderWidth: 1,
      color: WHITE,
    })

    page5.drawLine({
      start: { x: tableX + t9Col1, y: t9Y },
      end: { x: tableX + t9Col1, y: t9Y - t9RowHeight },
      thickness: 1,
      color: BORDER_BLACK,
    })

    page5.drawText(r.label, { x: tableX + 8, y: t9Y - 18, size: TABLE_SIZE, font: fontBold, color: TEXT_BLACK })
    if (r.val) {
      page5.drawText(r.val, { x: tableX + t9Col1 + 8, y: t9Y - 18, size: TABLE_SIZE, font: fontReg, color: TEXT_BLACK })
    }

    t9Y -= t9RowHeight
  }

  curY = t9Y - 16

  // Table 10 (4x3): Checkboxes table
  // Row 0: ['Item', 'Condition on Issue', 'Condition on Return']
  // Row 1: ['Power Cord', '☐ New    ☐ Used    ☐ Damaged', '☐ New    ☐ Used    ☐ Damaged']
  // Row 2: ['USB Mouse', '☐ New    ☐ Used    ☐ Damaged', '☐ New    ☐ Used    ☐ Damaged']
  // Row 3: ['Laptop', '☐ New    ☐ Used    ☐ Damaged', '☐ New    ☐ Used    ☐ Damaged']
  const t10Col1 = 130
  const t10Col2 = (tableWidth - t10Col1) / 2
  const t10Col3 = t10Col2
  const t10RowHeight = 27

  const drawCheckboxGroup = (pg: PDFPage, startX: number, startY: number) => {
    const labels = ["New", "Used", "Damaged"]
    let curCheckX = startX
    for (const l of labels) {
      // Draw square checkbox
      pg.drawRectangle({
        x: curCheckX,
        y: startY + 1,
        width: 9,
        height: 9,
        borderColor: BORDER_BLACK,
        borderWidth: 0.8,
        color: WHITE,
      })
      pg.drawText(l, {
        x: curCheckX + 12,
        y: startY + 2,
        size: 9.5,
        font: fontReg,
        color: TEXT_BLACK,
      })
      curCheckX += fontReg.widthOfTextAtSize(l, 9.5) + 26
    }
  }

  // Header Row
  page5.drawRectangle({
    x: tableX,
    y: curY - t10RowHeight,
    width: tableWidth,
    height: t10RowHeight,
    borderColor: BORDER_BLACK,
    borderWidth: 1,
    color: WHITE,
  })
  page5.drawLine({
    start: { x: tableX + t10Col1, y: curY },
    end: { x: tableX + t10Col1, y: curY - t10RowHeight },
    thickness: 1,
    color: BORDER_BLACK,
  })
  page5.drawLine({
    start: { x: tableX + t10Col1 + t10Col2, y: curY },
    end: { x: tableX + t10Col1 + t10Col2, y: curY - t10RowHeight },
    thickness: 1,
    color: BORDER_BLACK,
  })

  page5.drawText("Item", { x: tableX + 8, y: curY - 18, size: TABLE_SIZE, font: fontBold, color: TEXT_BLACK })
  page5.drawText("Condition on Issue", {
    x: tableX + t10Col1 + 8,
    y: curY - 18,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })
  page5.drawText("Condition on Return", {
    x: tableX + t10Col1 + t10Col2 + 8,
    y: curY - 18,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })

  curY -= t10RowHeight

  const items = ["Power Cord", "USB Mouse", "Laptop"]
  for (const item of items) {
    page5.drawRectangle({
      x: tableX,
      y: curY - t10RowHeight,
      width: tableWidth,
      height: t10RowHeight,
      borderColor: BORDER_BLACK,
      borderWidth: 1,
      color: WHITE,
    })
    page5.drawLine({
      start: { x: tableX + t10Col1, y: curY },
      end: { x: tableX + t10Col1, y: curY - t10RowHeight },
      thickness: 1,
      color: BORDER_BLACK,
    })
    page5.drawLine({
      start: { x: tableX + t10Col1 + t10Col2, y: curY },
      end: { x: tableX + t10Col1 + t10Col2, y: curY - t10RowHeight },
      thickness: 1,
      color: BORDER_BLACK,
    })

    page5.drawText(item, { x: tableX + 8, y: curY - 18, size: TABLE_SIZE, font: fontReg, color: TEXT_BLACK })
    drawCheckboxGroup(page5, tableX + t10Col1 + 10, curY - 18)
    drawCheckboxGroup(page5, tableX + t10Col1 + t10Col2 + 10, curY - 18)

    curY -= t10RowHeight
  }

  curY -= 16

  // Table 11 (4x2):
  // Row 0: ['Name of collecting Staff: <val>', 'Department: <val>']
  // Row 1: ['Signature:', 'Date: <val>']
  // Row 2: ['Name of Issuing Staff: <val>', '']
  // Row 3: ['Signature:', 'Date: <val>']
  const t11Col1 = 290
  const t11Col2 = tableWidth - t11Col1
  const t11RowHeight = 28

  // Row 0
  page5.drawRectangle({
    x: tableX,
    y: curY - t11RowHeight,
    width: tableWidth,
    height: t11RowHeight,
    borderColor: BORDER_BLACK,
    borderWidth: 1,
    color: WHITE,
  })
  page5.drawLine({
    start: { x: tableX + t11Col1, y: curY },
    end: { x: tableX + t11Col1, y: curY - t11RowHeight },
    thickness: 1,
    color: BORDER_BLACK,
  })
  page5.drawText("Name of collecting Staff:", {
    x: tableX + 8,
    y: curY - 18,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })
  if (data.employeeName) {
    page5.drawText(data.employeeName, {
      x: tableX + 145,
      y: curY - 18,
      size: TABLE_SIZE,
      font: fontReg,
      color: TEXT_BLACK,
    })
  }
  page5.drawText("Department:", {
    x: tableX + t11Col1 + 8,
    y: curY - 18,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })
  if (data.department) {
    page5.drawText(data.department, {
      x: tableX + t11Col1 + 82,
      y: curY - 18,
      size: TABLE_SIZE,
      font: fontReg,
      color: TEXT_BLACK,
    })
  }
  curY -= t11RowHeight

  // Row 1
  page5.drawRectangle({
    x: tableX,
    y: curY - t11RowHeight,
    width: tableWidth,
    height: t11RowHeight,
    borderColor: BORDER_BLACK,
    borderWidth: 1,
    color: WHITE,
  })
  page5.drawLine({
    start: { x: tableX + t11Col1, y: curY },
    end: { x: tableX + t11Col1, y: curY - t11RowHeight },
    thickness: 1,
    color: BORDER_BLACK,
  })
  page5.drawText("Signature:", { x: tableX + 8, y: curY - 18, size: TABLE_SIZE, font: fontBold, color: TEXT_BLACK })
  page5.drawText("Date:", {
    x: tableX + t11Col1 + 8,
    y: curY - 18,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })
  if (effectiveSignatureDate) {
    page5.drawText(effectiveSignatureDate, {
      x: tableX + t11Col1 + 44,
      y: curY - 18,
      size: TABLE_SIZE,
      font: fontReg,
      color: TEXT_BLACK,
    })
  }
  curY -= t11RowHeight

  // Row 2
  page5.drawRectangle({
    x: tableX,
    y: curY - t11RowHeight,
    width: tableWidth,
    height: t11RowHeight,
    borderColor: BORDER_BLACK,
    borderWidth: 1,
    color: WHITE,
  })
  page5.drawLine({
    start: { x: tableX + t11Col1, y: curY },
    end: { x: tableX + t11Col1, y: curY - t11RowHeight },
    thickness: 1,
    color: BORDER_BLACK,
  })
  page5.drawText("Name of Issuing Staff:", {
    x: tableX + 8,
    y: curY - 18,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })
  if (data.issuingStaffName) {
    page5.drawText(data.issuingStaffName, {
      x: tableX + 132,
      y: curY - 18,
      size: TABLE_SIZE,
      font: fontReg,
      color: TEXT_BLACK,
    })
  }
  curY -= t11RowHeight

  // Row 3
  page5.drawRectangle({
    x: tableX,
    y: curY - t11RowHeight,
    width: tableWidth,
    height: t11RowHeight,
    borderColor: BORDER_BLACK,
    borderWidth: 1,
    color: WHITE,
  })
  page5.drawLine({
    start: { x: tableX + t11Col1, y: curY },
    end: { x: tableX + t11Col1, y: curY - t11RowHeight },
    thickness: 1,
    color: BORDER_BLACK,
  })
  page5.drawText("Signature:", { x: tableX + 8, y: curY - 18, size: TABLE_SIZE, font: fontBold, color: TEXT_BLACK })
  page5.drawText("Date:", {
    x: tableX + t11Col1 + 8,
    y: curY - 18,
    size: TABLE_SIZE,
    font: fontBold,
    color: TEXT_BLACK,
  })
  if (effectiveSignatureDate) {
    page5.drawText(effectiveSignatureDate, {
      x: tableX + t11Col1 + 44,
      y: curY - 18,
      size: TABLE_SIZE,
      font: fontReg,
      color: TEXT_BLACK,
    })
  }

  drawFooters(doc, fontReg)

  const pdfBytes = await doc.save()
  const arrayBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer
  return new Blob([arrayBuffer], { type: "application/pdf" })
}

export async function printHandoverPolicyPDF(data: HandoverPolicyData): Promise<void> {
  const blob = await generateHandoverPolicyPDFBlob(data)
  const url = URL.createObjectURL(blob)
  const iframe = document.createElement("iframe")
  iframe.style.position = "fixed"
  iframe.style.right = "0"
  iframe.style.bottom = "0"
  iframe.style.width = "0"
  iframe.style.height = "0"
  iframe.style.border = "0"
  iframe.src = url
  document.body.appendChild(iframe)

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch {
      window.open(url, "_blank")
    }
  }
}

export async function downloadHandoverPolicyPDF(data: HandoverPolicyData, filename?: string): Promise<void> {
  const { default: saveAs } = await import("file-saver")
  const blob = await generateHandoverPolicyPDFBlob(data)
  const sanitizedName = (data.employeeName || "Staff").replace(/[^a-zA-Z0-9_-]/g, "_")
  saveAs(blob, filename || `ACOB_Asset_Handover_${sanitizedName}.pdf`)
}
