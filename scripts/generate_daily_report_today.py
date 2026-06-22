import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

# Define Output Path
OUTPUT_PDF = r"C:\Users\IT_COMMS\Downloads\Chibuikem_Ilonze_daily_report_2026_06_18.pdf"

def draw_header_footer(canvas, doc):
    canvas.saveState()
    # Margins are 54 pt (0.75 inch)
    # Page width is 612 pt, height is 792 pt
    
    # Running Footer (on all pages)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#64748B'))  # Slate 500
    canvas.drawString(54, 40, "Confidential - IT & Communications Department (ICT)")
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
    # Single-page document setup
    doc = SimpleDocTemplate(
        OUTPUT_PDF,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=64
    )
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#166534'),  # Deep Green
        spaceAfter=4
    )
    
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#B58900'),  # True Gold
        spaceAfter=15
    )
    
    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=colors.HexColor('#166534'),  # Deep Green
        spaceBefore=10,
        spaceAfter=6,
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
    
    table_cell_style = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=10,
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
        story.append(Spacer(1, 8))
    else:
        story.append(Spacer(1, 10))
        
    story.append(Paragraph("DAILY WORK ACCOMPLISHMENT REPORT", title_style))
    story.append(Paragraph("IT & Communications Department (ICT) - Daily Operations", subtitle_style))
    
    # Metadata Block
    meta_data = [
        [Paragraph("Prepared By:", meta_label_style), Paragraph("Chibuikem Michael Ilonze, Graduate Trainee (IT & Communications Department)", meta_val_style)],
        [Paragraph("Date of Report:", meta_label_style), Paragraph("June 18, 2026 (Today)", meta_val_style)],
        [Paragraph("Department:", meta_label_style), Paragraph("IT & Communications Department (ICT)", meta_val_style)],
    ]
    t_meta = Table(meta_data, colWidths=[1.3*inch, 5.7*inch])
    t_meta.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 8))
    story.append(Paragraph("<font color='#DCFCE7'>__________________________________________________________________________________________</font>", body_style))
    story.append(Spacer(1, 8))
    
    # Accomplishments Section
    story.append(Paragraph("Summary of Key Activities & Accomplishments", h1_style))
    
    story.append(Paragraph("1. <b>CCTV SharePoint Integration Assessment:</b> Evaluated the feasibility of integrating the office CCTV camera feeds with Microsoft SharePoint as requested. Concluded that the V380 CCTV hardware does not support native SharePoint integration; recommended using the manufacturer's V380 cloud-hosting services as the optimal storage alternative.", bullet_style))
    
    story.append(Paragraph("2. <b>Matrix System Alignment Session:</b> Conducted a technical planning session with the Head of Corporate Services (HCS) to review the Matrix System implementation roadmap, clarify core Trainee IT responsibilities, and coordinate reporting processes.", bullet_style))
    
    story.append(Paragraph("3. <b>Office Local Area Network (LAN) Audit:</b> Tested all physical Ethernet network wall ports across company offices to identify faulty outlets and map connectivity status. The details of the audit findings are documented below:", bullet_style))
    
    # Audit Table
    table_headers = [
        Paragraph("<b>Department / Office Location</b>", table_cell_bold_style),
        Paragraph("<b>Available Ports</b>", table_cell_bold_style),
        Paragraph("<b>Functional Ports</b>", table_cell_bold_style),
        Paragraph("<b>Status / Remarks</b>", table_cell_bold_style)
    ]
    
    table_rows = [
        table_headers,
        [Paragraph("Operations", table_cell_style), Paragraph("2", table_cell_style), Paragraph("0", table_cell_style), Paragraph("<font color='#B45309'><b>0% functional (needs maintenance)</b></font>", table_cell_style)],
        [Paragraph("Admin Department", table_cell_style), Paragraph("2", table_cell_style), Paragraph("1", table_cell_style), Paragraph("50% functional (1 port working)", table_cell_style)],
        [Paragraph("ICT Department", table_cell_style), Paragraph("1", table_cell_style), Paragraph("1", table_cell_style), Paragraph("100% functional", table_cell_style)],
        [Paragraph("Project Department", table_cell_style), Paragraph("4", table_cell_style), Paragraph("3", table_cell_style), Paragraph("75% functional (3 ports working)", table_cell_style)],
        [Paragraph("BGI Office", table_cell_style), Paragraph("3", table_cell_style), Paragraph("2", table_cell_style), Paragraph("67% functional (2 ports working)", table_cell_style)],
        [Paragraph("MD's Conference Room", table_cell_style), Paragraph("2", table_cell_style), Paragraph("2", table_cell_style), Paragraph("100% functional", table_cell_style)],
        [Paragraph("Accounts Department", table_cell_style), Paragraph("4", table_cell_style), Paragraph("4", table_cell_style), Paragraph("100% functional", table_cell_style)],
        [Paragraph("Regulatory Department", table_cell_style), Paragraph("4", table_cell_style), Paragraph("2", table_cell_style), Paragraph("50% functional (2 ports working)", table_cell_style)],
        [Paragraph("Technical Department", table_cell_style), Paragraph("2", table_cell_style), Paragraph("2", table_cell_style), Paragraph("100% functional", table_cell_style)]
    ]
    
    # 7.0 inches total printable width (colWidths: 164, 90, 90, 160 pt)
    t_audit = Table(table_rows, colWidths=[2.2*inch, 1.25*inch, 1.25*inch, 2.3*inch])
    t_audit.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F0FDF4')), # Soft Green header
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#DCFCE7')), # Light Green grid
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_audit)
    
    doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
    print("Today's daily report compiled successfully.")

if __name__ == '__main__':
    build_pdf()
