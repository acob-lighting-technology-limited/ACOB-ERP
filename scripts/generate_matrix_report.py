import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

# Define Output Path
OUTPUT_PDF = r"C:\Users\IT_COMMS\Downloads\Matrix_System_Development_Report.pdf"

def draw_header_footer(canvas, doc):
    canvas.saveState()
    # Margins are 54 pt (0.75 inch)
    # Page width is 612 pt, height is 792 pt
    
    # Running Header (on all pages except page 1)
    if doc.page > 1:
        canvas.setFont('Helvetica-Bold', 8)
        canvas.setFillColor(colors.HexColor('#166534'))  # Deep Green
        canvas.drawString(54, 745, "ACOB LIGHTING TECHNOLOGY LIMITED")
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.HexColor('#475569'))  # Slate 600
        canvas.drawRightString(558, 745, "Matrix System Progress & Status Report")
        canvas.setStrokeColor(colors.HexColor('#DCFCE7'))  # Light Green Accent
        canvas.setLineWidth(0.75)
        canvas.line(54, 737, 558, 737)
        
    # Running Footer (on all pages)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#64748B'))  # Slate 500
    canvas.drawString(54, 40, "Confidential - Internal IT Operations & Matrix Development Report")
    canvas.drawRightString(558, 40, f"Page {doc.page}")
    canvas.setStrokeColor(colors.HexColor('#E2E8F0'))
    canvas.setLineWidth(0.75)
    canvas.line(54, 52, 558, 52)
    
    # Draw Cover Page Anniversary Banner (on Page 1 only)
    if doc.page == 1:
        canvas.setFillColor(colors.HexColor('#166534'))  # Deep Green
        canvas.rect(0, 782, 612, 10, fill=True, stroke=False)
        canvas.setFillColor(colors.HexColor('#D4AF37'))  # True Gold
        canvas.rect(0, 777, 612, 5, fill=True, stroke=False)
        
    canvas.restoreState()

def build_pdf():
    # Page Setup: Letter, 0.75 inch margins, height offset for header
    doc = SimpleDocTemplate(
        OUTPUT_PDF,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    
    styles = getSampleStyleSheet()
    
    # Custom Styles
    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#166534'),  # Deep Green
        spaceAfter=4
    )
    
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10.5,
        leading=13,
        textColor=colors.HexColor('#B58900'),  # Solar Gold
        spaceAfter=10
    )
    
    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=15,
        textColor=colors.HexColor('#166534'),  # Deep Green
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True
    )
    
    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=13,
        textColor=colors.HexColor('#166534'),  # Deep Green
        spaceBefore=8,
        spaceAfter=3,
        keepWithNext=True
    )
    
    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12.5,
        textColor=colors.HexColor('#334155'),
        spaceAfter=6
    )
    
    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=body_style,
        leftIndent=20,
        firstLineIndent=-15,
        spaceAfter=4
    )
    
    meta_label_style = ParagraphStyle(
        'MetaLabel',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#166534')  # Deep Green
    )
    
    meta_val_style = ParagraphStyle(
        'MetaValue',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#334155')
    )
    
    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor('#334155')
    )
    
    table_cell_bold_style = ParagraphStyle(
        'TableCellBold',
        parent=table_cell_style,
        fontName='Helvetica-Bold',
        textColor=colors.HexColor('#166534')  # Deep Green
    )

    story = []
    
    # Add Company Logo if it exists (wider logo)
    logo_path = r"C:\Users\IT_COMMS\GitHubProjects\ACOB-Website\public\images\acob-logo-light.png"
    if os.path.exists(logo_path):
        logo_img = Image(logo_path, width=180, height=63)
        logo_img.hAlign = 'LEFT'
        story.append(logo_img)
        story.append(Spacer(1, 10))
    else:
        story.append(Spacer(1, 15))
        
    # --- PAGE 1: TITLE & EXECUTIVE OVERVIEW ---
    story.append(Paragraph("MATRIX SYSTEM DEVELOPMENT REPORT", title_style))
    story.append(Paragraph("Operational Status, Timeline Analysis & Module Roadmap", subtitle_style))
    story.append(Spacer(1, 5))
    
    # Metadata Block
    meta_data = [
        [Paragraph("Prepared By:", meta_label_style), Paragraph("Chibuikem Michael Ilonze, Graduate Trainee (IT & Communications Department)", meta_val_style)],
        [Paragraph("Date:", meta_label_style), Paragraph("June 18, 2026", meta_val_style)],
        [Paragraph("Target System:", meta_label_style), Paragraph("Matrix System (Core Portal & Consolidated Consoles)", meta_val_style)],
    ]
    t_meta = Table(meta_data, colWidths=[1.2*inch, 5.8*inch])
    t_meta.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 8))
    story.append(Paragraph("<font color='#DCFCE7'>__________________________________________________________________________________________</font>", body_style))
    story.append(Spacer(1, 8))
    
    # Section 1: Executive Overview
    story.append(Paragraph("1. Executive Overview", h1_style))
    story.append(Paragraph(
        "This development report outlines the current status of the Matrix System (ACOB's central operational "
        "database console). It provides a detailed, comprehensive overview of outstanding modules, development status keys, "
        "and active timelines. Modules have been categorized according to their testing dependencies, administrative review "
        "requirements, and specialized developer resource needs.",
        body_style
    ))
    
    # Section 2: Completed Core Modules & Key Achievements (Page 1 start)
    story.append(Paragraph("2. Completed Core Modules & Key Achievements", h1_style))
    story.append(Paragraph(
        "A substantial portion of the Matrix System has been fully developed, tested, and deployed to active production. "
        "The following operational systems have been successfully completed:",
        body_style
    ))
    
    story.append(Paragraph("1. <b>Official Correspondence Tracking System:</b> Developed a secure incoming and outgoing letter registry with dynamic route alignment and navigation paths. It features OneDrive/SharePoint cloud storage migration (saving local database storage), integrated automated email reminder flags for letters pending response, and a strict state-machine approval workflow that prevents double email notifications when two supervisors approve.", bullet_style))
    story.append(Paragraph("2. <b>Weekly Reports & General Meetings Archive:</b> Created a department-wide report aggregation and compilation dashboard. It automatically formats weekly reports into standard templates, supports PDF previewing, handles automated administrative distribution via dynamic email templates, and runs cloud storage backfill scripts to archive official weekly reports and meeting minutes in SharePoint.", bullet_style))
    story.append(Paragraph("3. <b>Automated Birthday Greeting System:</b> Programmed an automated cron utility that performs a daily scan of the staff database at midnight to detect employee birthdays. It automatically dispatches personalized corporate greeting cards via email, using a robust application-level double-check to guarantee zero duplicate greeting cards are sent.", bullet_style))
    story.append(Paragraph("4. <b>Corporate Notification & Communication Engine:</b> Integrated a central transactional email engine (linking cPanel and Microsoft mail domains) with custom HTML templates for system alerts. Features support-ticket updates, leave approval notifications, onboarding statuses, and departmental announcements, with customizable personal notification options.", bullet_style))
    story.append(Paragraph("5. <b>Biometric Attendance Integration (Hikvision):</b> Integrated physical office biometric fingerprint/facial scanners (Hikvision DS-K1T804MF) with the database via a secured webhook receiver. Configured token-based authentication to prevent spoofing, localized timezone offsets (West Africa Time) to resolve clock-drift errors, and unique logic where the first scan of the day clocks an employee in, while all subsequent scans dynamically update the clock-out time (ensuring the last scan is the true departure time). HR can view live device-sourced logs directly from their dashboard.", bullet_style))
    
    story.append(PageBreak())
    
    # Section 2 Continued (Page 2)
    story.append(Paragraph("6. <b>Branded Email Signature Generator & Watermarking Tool:</b> Designed a self-service email signature tool to standardize company-wide signatures. Also implemented a Batch Image Watermarking Tool with a default 'Website Optimized' preset (20% offset, 30% opacity, 18% size) and custom sequential file naming (e.g. Home_1, Home_2) exported directly into zip files for the website portfolio.", bullet_style))
    story.append(Paragraph("7. <b>IT Assets Inventory & Reallocation Tracker:</b> Formulated a hardware asset management inventory to audit and track corporate equipment (laptops, printers, desktops, routers, and switches). Links each asset's service history, specifications, serial numbers, and current assignments, supporting structured reallocations to streamline hardware handovers.", bullet_style))
    story.append(Paragraph("8. <b>Employee Directory & Automated Onboarding Pipeline:</b> Established a complete staff registry and public onboarding portal. The registration page automatically adapts to light and dark modes (using semantic shadcn/ui styles), letting new hires and trainees submit profile details, upload credentials, and automatically trigger HR verification alerts.", bullet_style))
    story.append(Paragraph("9. <b>Documentation Library & SOP Repository:</b> Created an organizational knowledge base for Standard Operating Procedures (SOPs), onboarding manuals, and training resources, backed by automated file syncs to SharePoint/OneDrive.", bullet_style))
    story.append(Paragraph("10. <b>Role-Based Access Control (RBAC) & Security Hardening:</b> Audited and patched 39 key files in the API and admin trees to enforce strict role separation. Restructured the system so that managers toggle into 'Lead Mode' to see only their department's data, while stripping admin bypasses from the personal portal (e.g., `/correspondence` and `/help-desk`) to ensure staff see only their own personal records, validated by type-checks and lint validations.", bullet_style))
    story.append(Paragraph("11. <b>Payment and Financial Tracker Improvements:</b> Upgraded the billing and scheduling console with an optional 'Reference Number' input field for tracking transaction codes. Renamed the status terminology to 'Due' (with dynamic status logic for Due, Paid, Overdue, Cancelled), added an 'Amount Due' column to track outstanding balances, and created a Receipt Selection Dialog to handle multi-receipt print options.", bullet_style))
    
    # Section 3: Operational Timeline Rationale (Page 2)
    story.append(Paragraph("3. Operational Timeline Rationale", h1_style))
    story.append(Paragraph(
        "To ensure that the Matrix System operates reliably within ACOB Lighting's daily business workflow, "
        "outstanding development roadmaps are designated as In Progress. These timelines are driven by the following "
        "operational testing and integration dependencies:<br/><br/>"
        "1. <b>Leave Management (2-Week Timeline):</b> The primary codebase has been built. Transitioning this module "
        "to active use requires manual user-acceptance testing of reliever designations and supervisory approval flows. "
        "This testing will be supervised by the HR Lead to verify alignment with corporate policies.<br/>"
        "2. <b>PMS, Tasks, and Help Desk (2-Month Timeline):</b> These modules represent a comprehensive administrative "
        "framework. While frontend layout and backend tables are established, they require extensive customization, review loops, "
        "and direct feedback from department heads to align corporate KPIs, appraisal forms, and IT ticketing queues before release.<br/>"
        "3. <b>Computer-Based Testing (1-Week Timeline):</b> The question bank and scoring engine require complex automated "
        "logic. The coding scripts will be optimized using a specialized Claude AI coding environment to accelerate deployment.<br/>"
        "4. <b>Finance & Payments (Timeline Unknown):</b> As this represents the most sensitive security and billing section of the "
        "application, no changes will be promoted to production without a thorough operational concept sign-off and transaction "
        "audits conducted by the Accounts Lead. Development will leverage Claude AI triggers and audits to ensure security.",
        body_style
    ))
    
    story.append(PageBreak())
    
    # --- PAGE 3: SPREADSHEET STATUS BREAKDOWN ---
    story.append(Paragraph("4. Matrix System Module Tracker Status & Timelines", h1_style))
    story.append(Paragraph(
        "The development tracker spreadsheet has been updated to reflect progress, active timelines, and testing dependencies "
        "for the outstanding modules in the Matrix System. Below is the detailed breakdown of the development status keys "
        "and notes on critical dependencies:",
        body_style
    ))
    
    # Status Table
    table_headers = [
        Paragraph("<b>Module Scope</b>", table_cell_bold_style),
        Paragraph("<b>Status</b>", table_cell_bold_style),
        Paragraph("<b>Timeline</b>", table_cell_bold_style),
        Paragraph("<b>Testing & Implementation Rationale / Notes</b>", table_cell_bold_style)
    ]
    
    table_rows = [
        table_headers,
        [
            Paragraph("<b>Leave Management Workflows</b>", table_cell_style),
            Paragraph("<font color='#854D0E'><b>In Progress</b></font>", table_cell_style),
            Paragraph("2 weeks", table_cell_style),
            Paragraph("Requires coordinated end-user testing of the manual leave approval workflow inside the Matrix console, guided by the HR Lead, to verify proper approval routing and notification triggers.", table_cell_style)
        ],
        [
            Paragraph("<b>Computer-Based Testing (CBT)</b>", table_cell_style),
            Paragraph("<font color='#854D0E'><b>In Progress</b></font>", table_cell_style),
            Paragraph("1 week", table_cell_style),
            Paragraph("Crucial training assessment engine and question bank logic. Requires a dedicated Claude AI subscription to generate optimized question-scoping scripts and test scoring modules.", table_cell_style)
        ],
        [
            Paragraph("<b>Performance (PMS), Tasks, & Help Desk</b>", table_cell_style),
            Paragraph("<font color='#854D0E'><b>In Progress</b></font>", table_cell_style),
            Paragraph("2 months", table_cell_style),
            Paragraph("Codebase foundations are complete. Requires extensive testing, evaluation cycle setups, and department head input on KPIs, peer-feedback structures, and support ticket routing.", table_cell_style)
        ],
        [
            Paragraph("<b>Finance & Payments</b>", table_cell_style),
            Paragraph("<font color='#854D0E'><b>In Progress</b></font>", table_cell_style),
            Paragraph("unknown", table_cell_style),
            Paragraph("Most critical database security zone. Requires full operational review and transaction validation from the Accounts Lead, as well as Claude AI development support for security audits.", table_cell_style)
        ],
        [
            Paragraph("<b>Documentation & SOPs Library</b>", table_cell_style),
            Paragraph("<font color='#166534'><b>Completed</b></font>", table_cell_style),
            Paragraph("Done", table_cell_style),
            Paragraph("Ready for company-wide deployment. Admin and team members are actively uploading department documents, SOPs, and knowledge-sharing session presentations.", table_cell_style)
        ],
        [
            Paragraph("<b>Reports & General Meetings</b>", table_cell_style),
            Paragraph("<font color='#166534'><b>Completed</b></font>", table_cell_style),
            Paragraph("Done", table_cell_style),
            Paragraph("In active use by Admin and ICT teams. Department-wide usage is being actively encouraged as the weekly reports and general meeting logs are fully functional.", table_cell_style)
        ],
        [
            Paragraph("<b>Other Core Utilities</b>", table_cell_style),
            Paragraph("<font color='#166534'><b>Completed</b></font>", table_cell_style),
            Paragraph("Done", table_cell_style),
            Paragraph("Fully completed. Asset database is populated; feedback and reference letter tools are ready for large-scale employee onboarding.", table_cell_style)
        ]
    ]
    
    # 7.0 inches total printable width (colWidths: 1.8, 0.9, 0.8, 3.5 inches)
    t_status = Table(table_rows, colWidths=[1.8*inch, 0.9*inch, 0.8*inch, 3.5*inch])
    t_status.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F0FDF4')), # Soft Green header
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#DCFCE7')), # Light Green grid
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_status)
    story.append(Spacer(1, 10))
    
    # Section 5: Deprecations & Cleanups
    story.append(Paragraph("5. Deprecations and Structural Cleanups", h2_style))
    story.append(Paragraph(
        "Following feedback and alignment, the following updates were made to the tracker and active systems:<br/>"
        "1. <b>Job Descriptions Module Deprecation:</b> The job description preview and generation modules "
        "have been deprecated and removed from the active status list.<br/>"
        "2. <b>Offboarding Conflicts Removal:</b> The placeholder module for employee offboarding conflicts was "
        "removed to clean up the employee management scope.",
        body_style
    ))
    
    story.append(PageBreak())
    
    # --- PAGE 4: SUMMARY OF Core Categories & Requirements (Section 6 - the last) ---
    story.append(Paragraph("6. Summary of Core Categories & Requirements", h1_style))
    story.append(Paragraph(
        "To provide a clear roadmap for system implementation, the modules of the Matrix System have been grouped "
        "into six distinct development categories based on their operational status and requirements:",
        body_style
    ))
    
    story.append(Paragraph("1. <b>Coding & Technical Hardening (Claude AI Dependent):</b> Certain sections require complex scripting, custom mathematical logic, and code optimization. To handle this, a dedicated developer tool (Claude AI coding subscription at 14,000 NGN/month) is required to ensure rapid and clean implementation.", bullet_style))
    story.append(Paragraph("2. <b>Validation Against Existing Data:</b> Modules such as the Leave Management workflow must be tested extensively using the company's historical, real-world data to verify that reliever requests and approval loops route accurately.", bullet_style))
    story.append(Paragraph("3. <b>Adoption & Training (Active Modules):</b> Completed modules (such as Weekly Reports and the SOP/Documentation Library) are already live and functional, but require staff training sessions to ensure employees understand how to use them effectively.", bullet_style))
    story.append(Paragraph("4. <b>General Acceptance Testing:</b> Specific completed layouts and dashboards require final user-acceptance testing and verification by the IT team to officially certify them as ready for company-wide deployment.", bullet_style))
    story.append(Paragraph("5. <b>Department Head Consultations:</b> Sensitive, policy-driven administrative modules, especially the Finance and Billing console, cannot be finalized without direct consultations with department heads (such as the Accounts Lead) to ensure workflow compliance.", bullet_style))
    story.append(Paragraph("6. <b>New Core Feature Development (Claude AI Dependent):</b> New system requirements, specifically the upcoming Projects Tracker progress console, will be built using Claude AI to handle database triggers and dynamic progress visualizers.", bullet_style))
    
    # Build Document
    doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
    print("Matrix progress PDF report compiled successfully.")

if __name__ == '__main__':
    build_pdf()
