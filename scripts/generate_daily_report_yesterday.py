import os
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

# Define Output Path
OUTPUT_PDF = r"C:\Users\IT_COMMS\Downloads\Chibuikem_Ilonze_daily_report_2026_06_17.pdf"

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
    # Set tight top/bottom margins for 1-page document
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
        spaceAfter=6
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
        story.append(Spacer(1, 8))
    else:
        story.append(Spacer(1, 10))
        
    story.append(Paragraph("DAILY WORK ACCOMPLISHMENT REPORT", title_style))
    story.append(Paragraph("IT & Communications Department (ICT) - Daily Operations", subtitle_style))
    
    # Metadata Block
    meta_data = [
        [Paragraph("Prepared By:", meta_label_style), Paragraph("Chibuikem Michael Ilonze, Graduate Trainee (IT & Communications Department)", meta_val_style)],
        [Paragraph("Date of Report:", meta_label_style), Paragraph("June 17, 2026 (Yesterday)", meta_val_style)],
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
    
    story.append(Paragraph("1. <b>ERP Correspondence Workflow Bug Fix:</b> Investigated and resolved a system bug where two duplicate notification emails were being sent when two different personnel approved the same official correspondence record.", bullet_style))
    
    story.append(Paragraph("2. <b>ERP Presentation-to-PDF Converter:</b> Developed and integrated an internal file conversion utility within the Matrix System to automate the conversion of PowerPoint (PPTX) reports into PDFs directly. This streamlines administrative tasks by eliminating dependencies on external file converters.", bullet_style))
    
    story.append(Paragraph("3. <b>Matrix System Progress Review:</b> Held a progress review session with the Head of Corporate Services (HCS) to present active Matrix console dashboards and receive valuable administrative guidance and operational feedback.", bullet_style))
    
    story.append(Paragraph("4. <b>Website Healthcare Portfolio Showcase:</b> Participated in a planning session with the Managing Director (MD) to align on the user experience and schema integration for showcasing all 12 healthcare solar electrification projects on the company website, with development scheduled to begin shortly.", bullet_style))
    
    doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
    print("Yesterday's daily report compiled successfully.")

if __name__ == '__main__':
    build_pdf()
