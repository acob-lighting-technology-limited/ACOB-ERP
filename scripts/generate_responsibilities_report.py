import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

# Define Output Path
OUTPUT_PDF = r"C:\Users\IT_COMMS\Downloads\Trainee_Core_Responsibilities_Report.pdf"

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
        canvas.drawRightString(558, 745, "Trainee Core Responsibilities & Work Plan")
        canvas.setStrokeColor(colors.HexColor('#DCFCE7'))  # Light Green Accent
        canvas.setLineWidth(0.75)
        canvas.line(54, 737, 558, 737)
        
    # Running Footer (on all pages)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#64748B'))  # Slate 500
    canvas.drawString(54, 40, "ICT Operations - Trainee Core Responsibilities Report")
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
        
    story.append(Paragraph("TRAINEE CORE RESPONSIBILITIES REPORT", title_style))
    story.append(Paragraph("Comprehensive Scope of ICT Deliverables & Operations at ACOB Lighting", subtitle_style))
    story.append(Spacer(1, 5))
    
    # Metadata Block
    meta_data = [
        [Paragraph("Prepared By:", meta_label_style), Paragraph("Chibuikem Michael Ilonze, Graduate Trainee (IT & Communications Department)", meta_val_style)],
        [Paragraph("Date:", meta_label_style), Paragraph("June 18, 2026", meta_val_style)],
        [Paragraph("Department:", meta_label_style), Paragraph("IT & Communications Department (ICT)", meta_val_style)],
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
    story.append(Spacer(1, 10))
    story.append(Paragraph("<font color='#DCFCE7'>__________________________________________________________________________________________</font>", body_style))
    story.append(Spacer(1, 10))
    
    # Core Areas
    story.append(Paragraph("1. Matrix System Development & Onboarding", h1_style))
    story.append(Paragraph(
        "I drive the functional engineering, system design, and implementation of the <b>Matrix System</b> "
        "(ACOB's central operational database console). My work focuses on building operational features, "
        "managing database schemas, and coordinating user testing:",
        body_style
    ))
    story.append(Paragraph("1. <b>User Dashboard & Console Design:</b> Designing and maintaining user dashboard interfaces to ensure clean, responsive, and easy-to-use screens for administrative tasks on both mobile devices and desktops.", bullet_style))
    story.append(Paragraph("2. <b>Backend Database & API Engineering:</b> Structuring and maintaining the central database, managing data schemas, and developing secure server APIs that process attendance logs, leaves, and appraiser feedback.", bullet_style))
    story.append(Paragraph("3. <b>Performance Optimization & Data Caching:</b> Implementing database indexing, caching strategies, and page load optimizations to ensure dashboards and grids render instantly under heavy administrative usage.", bullet_style))
    story.append(Paragraph("4. <b>New Feature - Assistant Chatbot Integration:</b> Developing and deploying the internal AI assistant chatbot (AcoBot) to provide staff with helpful, role-appropriate answers to system queries.", bullet_style))
    story.append(Paragraph("5. <b>New Feature - Automated Birthday Greetings:</b> Building and scheduling system controls that run daily checks and automatically send personalized birthday messages to employees, with built-in duplicate dispatch prevention.", bullet_style))
    story.append(Paragraph("6. <b>Operational Modules Customization:</b> Designing, building, and refining workflows for employee attendance tracking (clock-in/clock-out records), leave request approvals, IT Helpdesk ticketing, and appraisal reviews.", bullet_style))
    story.append(Paragraph("7. <b>End-User Testing & Coordination:</b> Collaborating directly with the HR Lead and Accounts Lead to test leave application workflows, CBT training modules, and vendor bill payment verification systems.", bullet_style))
    story.append(Paragraph("8. <b>Access Control & Staff Onboarding:</b> Provisioning corporate user accounts, managing role permissions, assigning department access levels, and training employees on how to submit tickets and log daily activities.", bullet_style))
    
    story.append(Spacer(1, 5))
    
    story.append(Paragraph("2. Official Web Portal Maintenance (ACOB Website)", h1_style))
    story.append(Paragraph(
        "I maintain and optimize the company's official public web portal. My responsibilities span content updates, user interface design, search optimization, and performance tracking:",
        body_style
    ))
    story.append(Paragraph("1. <b>User Interface & Layout Updates:</b> Performing regular layout updates and design enhancements to keep the website modern, visually appealing, and fully responsive across all screens.", bullet_style))
    story.append(Paragraph("2. <b>Backend & Content Architecture:</b> Modeling content schemas within the headless content management system (CMS) to manage company project portfolios, solar product specifications, and frequently asked questions.", bullet_style))
    story.append(Paragraph("3. <b>Search Engine & Performance Optimization (SEO):</b> Optimizing web pages, managing search keywords, compressing assets, and configuring edge content caching to ensure the website loads fast and ranks highly on Google search results.", bullet_style))
    story.append(Paragraph("4. <b>New Feature - Customer Support Chatbot:</b> Managing and updating the automated customer assistant chatbot (ACOBot) to help answer visitor questions and capture customer leads.", bullet_style))
    story.append(Paragraph("5. <b>New Feature - Multilingual Support:</b> Implementing and maintaining translation content to keep the website accessible in multiple regional languages, including English, Hausa, Igbo, and Yoruba.", bullet_style))
    story.append(Paragraph("6. <b>Web Health & Visitor Analytics Monitoring:</b> Tracking page loading speeds, SEO health, and visitor traffic reports to identify areas for improvement.", bullet_style))
    
    story.append(PageBreak())
    
    story.append(Paragraph("3. IT Infrastructure, Maintenance, and Support", h1_style))
    story.append(Paragraph(
        "I provide comprehensive IT support and infrastructure maintenance to ensure zero downtime for daily office operations:",
        body_style
    ))
    story.append(Paragraph("1. <b>Corporate Email Environments Administration:</b> Managing and configuring both the cPanel email servers (for the <i>@org.acoblighting.com</i> domain) and Microsoft Exchange/Office 365 (for the <i>@acoblighting.com</i> domain). This includes provisioning email accounts, setting up distribution groups and aliases, managing storage quotas, and resolving mail delivery or access issues.", bullet_style))
    story.append(Paragraph("2. <b>Hardware & Software Support:</b> Diagnosing staff computer errors, installing authorized software packages, fixing hardware faults (printers, PCs, routers), and specifying technical requirements for device procurement.", bullet_style))
    story.append(Paragraph("3. <b>Local Helpdesk Management:</b> Handling day-to-day IT support tickets submitted by staff, maintaining an inventory of company IT hardware assets, and coordinating vendor repairs.", bullet_style))
    
    story.append(Spacer(1, 5))
    
    story.append(Paragraph("4. System Control & Cybersecurity", h1_style))
    story.append(Paragraph(
        "I handle network security and system control to protect ACOB Lighting's intellectual property and digital assets:",
        body_style
    ))
    story.append(Paragraph("1. <b>Network Administration:</b> Monitoring internet links and local networks via <b>MikroTik</b> routers and <b>FortiGate</b> firewall consoles. Configuring firewall rules, bandwidth allocation policies, failover thresholds, and port mapping.", bullet_style))
    story.append(Paragraph("2. <b>Internet Billing Management:</b> Managing link subscriptions, generating monthly usage metrics, and checking invoice schedules to avoid provider disconnects.", bullet_style))
    story.append(Paragraph("3. <b>Data Protection & Recovery:</b> Implementing daily automated database snapshots, preventing data leaks, and supporting staff immediately in case of data loss or device security compromise.", bullet_style))
    
    doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
    print("Core responsibilities PDF report compiled successfully.")

if __name__ == '__main__':
    build_pdf()
