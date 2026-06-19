import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

# Define Output Path
OUTPUT_PDF = r"C:\Users\IT_COMMS\Downloads\Matrix_System_Past_Month_Work_Report.pdf"

def draw_header_footer(canvas, doc):
    canvas.saveState()
    # Page width is 612 pt, height is 792 pt
    
    # Running Header (on all pages except page 1)
    if doc.page > 1:
        canvas.setFont('Helvetica-Bold', 8)
        canvas.setFillColor(colors.HexColor('#166534'))  # Deep Green
        canvas.drawString(54, 745, "ACOB LIGHTING TECHNOLOGY LIMITED")
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.HexColor('#475569'))  # Slate 600
        canvas.drawRightString(558, 745, "Matrix System - 1-Month Work Accomplishment Report")
        canvas.setStrokeColor(colors.HexColor('#DCFCE7'))  # Light Green Accent
        canvas.setLineWidth(0.75)
        canvas.line(54, 737, 558, 737)
        
    # Running Footer (on all pages)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#64748B'))  # Slate 500
    canvas.drawString(54, 40, "Confidential - Internal ICT Development Report")
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
    doc = SimpleDocTemplate(
        OUTPUT_PDF,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=72,
        bottomMargin=72
    )
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#166534'),  # Deep Green
        spaceAfter=6
    )
    
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        leading=15,
        textColor=colors.HexColor('#B58900'),  # True Gold
        spaceAfter=20
    )
    
    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=colors.HexColor('#166534'),  # Deep Green
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True
    )
    
    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor('#334155'),
        spaceAfter=8
    )
    
    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=body_style,
        leftIndent=20,
        firstLineIndent=-15,
        spaceAfter=5
    )
    
    meta_label_style = ParagraphStyle(
        'MetaLabel',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#166534')  # Deep Green
    )
    
    meta_val_style = ParagraphStyle(
        'MetaValue',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#334155')
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
        
    story.append(Paragraph("MATRIX SYSTEM WORK DONE IN THE PAST 1 MONTH", title_style))
    story.append(Paragraph("Summary of System Improvements, Security Auditing, & Core Integrations", subtitle_style))
    story.append(Spacer(1, 5))
    
    # Metadata Block
    meta_data = [
        [Paragraph("Prepared By:", meta_label_style), Paragraph("Chibuikem Michael Ilonze, Graduate Trainee (IT & Communications Department)", meta_val_style)],
        [Paragraph("Date:", meta_label_style), Paragraph("June 18, 2026", meta_val_style)],
        [Paragraph("Reporting Period:", meta_label_style), Paragraph("May 18, 2026 - June 18, 2026", meta_val_style)],
        [Paragraph("System:", meta_label_style), Paragraph("Matrix System (Internal Core Portal & Database Console)", meta_val_style)],
    ]
    t_meta = Table(meta_data, colWidths=[1.4*inch, 5.6*inch])
    t_meta.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 10))
    story.append(Paragraph("<font color='#DCFCE7'>__________________________________________________________________________________________</font>", body_style))
    story.append(Spacer(1, 10))
    
    # Executive Summary
    story.append(Paragraph("Executive Summary", h1_style))
    story.append(Paragraph(
        "This report outlines the technical achievements and development work completed in the <b>Matrix System</b> "
        "codebase during the past one month. The focus has been on integrating biometric attendance devices, centralizing "
        "access control security, standardizing user interface views, deploying the AcoBot AI chatbot helper, "
        "implementing an automated de-duplicated birthday greeting system, and refining official correspondence workflows.",
        body_style
    ))
    story.append(Spacer(1, 5))
    
    # Section 1
    story.append(Paragraph("1. Biometric Hardware Integration & Attendance API Hardening", h1_style))
    story.append(Paragraph("1. <b>Biometric Scanner Integration:</b> Connecting the system to the physical office fingerprint/facial scanners to automatically record employee clock-in and clock-out logs.", bullet_style))
    story.append(Paragraph("2. <b>Real-time Log Processing:</b> Setting up the system to immediately process and save scan logs, ensuring employee attendance records show up in the database instantly.", bullet_style))
    story.append(Paragraph("3. <b>Continuous Scanning Adjustments:</b> Modifying the system to update the employee's clock-out time on every subsequent scan in the afternoon, rather than ignoring repeat scans.", bullet_style))
    story.append(Paragraph("4. <b>Timezone Offset Correction:</b> Configuring the database to store the scanner's local time directly to avoid errors caused by automatic timezone conversions.", bullet_style))
    story.append(Paragraph("5. <b>Attendance Security & Anti-tampering:</b> Adding security limits and checks to prevent duplicate submissions or unauthorized network calls to the attendance system.", bullet_style))
    
    story.append(PageBreak())
    
    # Section 2
    story.append(Paragraph("2. Role-Based Access Control (RBAC v2) & Security Hardening", h1_style))
    story.append(Paragraph("1. <b>Centralized Access Security:</b> Restructuring the system's access permissions to establish a centralized role-based security framework.", bullet_style))
    story.append(Paragraph("2. <b>Granular Permission Control:</b> Upgrading security rules to grant access based on specific employee roles, replacing older, looser email-domain check rules.", bullet_style))
    story.append(Paragraph("3. <b>Department Console Separation:</b> Restricting database views so that employees can only access operational records within their own authorized departments.", bullet_style))
    
    story.append(Spacer(1, 8))
    
    # Section 3
    story.append(Paragraph("3. Page Architecture, UI Components & Compilation Optimizations", h1_style))
    story.append(Paragraph("1. <b>Dashboard Component Standardization:</b> Creating clean, uniform tables, loading animations, and layouts that look professional and work perfectly on both mobile screens and desktops.", bullet_style))
    story.append(Paragraph("2. <b>System Cleanups & Build Fixes:</b> Splitting combined creation and editing page layouts into separate files, resolving coding errors and improving system build reliability.", bullet_style))
    story.append(Paragraph("3. <b>System Upgrade Preparation:</b> Cleaning up software libraries and updating configuration files to support the latest framework upgrades.", bullet_style))
    story.append(Paragraph("4. <b>Navigation & Workflow Alignment:</b> Aligning navigation links and workflows for the correspondence tracking and attendance consoles.", bullet_style))
    
    story.append(Spacer(1, 8))
    
    # Section 4
    story.append(Paragraph("4. Chatbot Integration & Automated Workflows", h1_style))
    story.append(Paragraph("1. <b>Internal Assistant Chatbot (AcoBot):</b> Developing and deploying an internal AI chatbot (AcoBot) to provide staff with helpful, role-appropriate answers to their questions, with built-in speed limits to prevent abuse.", bullet_style))
    story.append(Paragraph("2. <b>Onboarding Registration Fixes:</b> Updating the employee onboarding setup to allow trainees and new hires to edit and resubmit their details if their profile is rejected.", bullet_style))
    story.append(Paragraph("3. <b>Standardized Email Layouts:</b> Designing clean email notification templates and adding automated approval sign-offs for onboarding processes.", bullet_style))
    
    story.append(Spacer(1, 8))
    
    # Section 5
    story.append(Paragraph("5. Automated Birthday Notification System", h1_style))
    story.append(Paragraph("1. <b>Duplicate Broadcast Prevention:</b> Setting up system controls to ensure employees do not receive duplicate birthday greeting emails, keeping the messaging system clean and reliable.", bullet_style))
    story.append(Paragraph("2. <b>Daily Automated Greetings:</b> Scheduling the system to run daily checks and automatically send out personalized birthday messages to employees on their birthdays.", bullet_style))
    
    story.append(Spacer(1, 8))
    
    # Section 6
    story.append(Paragraph("6. Official Correspondence Tracking & Workflow System", h1_style))
    story.append(Paragraph("1. <b>Approval Workflow Fixes:</b> Resolved an issue in the approval state machine where duplicate notification emails were sent when two separate managers approved a correspondence record.", bullet_style))
    story.append(Paragraph("2. <b>Route and Navigation Alignment:</b> Restructured navigation links and URL pathways to seamlessly connect correspondence workflows with the administration console.", bullet_style))
    story.append(Paragraph("3. <b>Cloud Storage Migration:</b> Developed scripts to automate document imports, successfully migrating legacy correspondence files to OneDrive/SharePoint cloud storage.", bullet_style))
    story.append(Paragraph("4. <b>System Reminders Integration:</b> Connected the correspondence tracking system with automated reminders to alert staff of pending actions.", bullet_style))
    
    doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
    print("Monthly work done report compiled successfully.")

if __name__ == '__main__':
    build_pdf()
