#!/usr/bin/env python3
"""One-page question sheet for Harsh to put to IIM Mumbai faculty / Programme Office.

Deliberately NOT the full briefing (see build-briefing-pdf.py). This is questions only,
written in Harsh's own voice — first person, the things he is asking, not my analysis of
the situation. The only context kept is the three lines without which the questions
cannot be answered or forwarded.

AISHE code U-1283 supplied by Harsh 11 Sep 2026. The `U-` prefix is a university-level
registration, which is why the nomination cap quoted here is 100 rather than 50.

    python3 outreach/build-questions-pdf.py
"""
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = f"{HERE}/SIH2026-Questions-for-Institute.pdf"
DFONTS = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"

pdfmetrics.registerFont(TTFont("Calibri", f"{DFONTS}/Calibri.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-Bold", f"{DFONTS}/Calibrib.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-Italic", f"{DFONTS}/Calibrii.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-BoldItalic", f"{DFONTS}/Calibriz.ttf"))
pdfmetrics.registerFont(TTFont("Cambria-Bold", f"{DFONTS}/Cambriab.ttf"))
# Without this <b> silently renders as regular weight. Cost one rebuild last time.
pdfmetrics.registerFontFamily("Calibri", normal="Calibri", bold="Calibri-Bold",
                              italic="Calibri-Italic", boldItalic="Calibri-BoldItalic")

INK = colors.HexColor("#141B2E")
NAVY = colors.HexColor("#1F3A6E")
RED = colors.HexColor("#A3241C")
GREY = colors.HexColor("#4A5260")
RULE = colors.HexColor("#C9CFDA")
BOXBG = colors.HexColor("#EEF2FA")

S = {
    "title": ParagraphStyle("t", fontName="Cambria-Bold", fontSize=15, leading=18,
                            textColor=INK, spaceAfter=2),
    "sub": ParagraphStyle("s", fontName="Calibri", fontSize=9.5, leading=12.5,
                          textColor=GREY, spaceAfter=8),
    "ctx": ParagraphStyle("c", fontName="Calibri", fontSize=9.5, leading=13,
                          textColor=INK, spaceAfter=3),
    "q": ParagraphStyle("q", fontName="Calibri", fontSize=10, leading=13.4,
                        textColor=INK, spaceAfter=0),
    "h": ParagraphStyle("h", fontName="Cambria-Bold", fontSize=11.5, leading=14,
                        textColor=NAVY, spaceBefore=10, spaceAfter=5),
    "small": ParagraphStyle("sm", fontName="Calibri", fontSize=8.4, leading=11,
                            textColor=GREY, spaceAfter=2),
}

QUESTIONS = [
    "Can the Institute <b>appoint a faculty member as SPOC</b> and register on sih.gov.in? "
    "I have the details ready — our AISHE code is <b>U-1283</b>, and the form needs only a "
    "faculty name, official email and phone number.",

    "If the answer is no, <b>is that final for SIH 2026?</b> I am also enrolled at IIT Madras, "
    "which is already registered, and I would go through them instead. I am not asking anyone "
    "to say yes — I just need to know which door to use.",

    "Who would <b>sign and seal the nomination letter</b> on Institute letterhead — the Director, "
    "or a Dean? It has to name all six team members and carry the Institute seal.",

    "Can the Institute run a <b>short internal hackathon</b>? Only teams selected in one may be "
    "nominated, and the SPOC has to upload a report with photographs and jury details. If this is "
    "the part that makes it impractical, I would rather be told now than have it stall later.",

    "Has the Institute <b>looked at SIH before and decided against it?</b> If there is already a "
    "position on this, I will stop asking.",

    "If this year is not possible, would the Institute <b>register a SPOC for SIH 2027?</b> "
    "Registration opens around July. No IIM in India is currently on the national list, and "
    "that seems worth changing regardless of what happens to my team.",

    "Is there <b>anyone else I should be speaking to</b> about this instead of you?",
]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Calibri", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 11 * mm,
                      "Harsh Bajpai · Smart India Hackathon 2026 · 11 September 2026")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 14.5 * mm, 190 * mm, 14.5 * mm)
    canvas.restoreState()


def main():
    doc = BaseDocTemplate(OUT, pagesize=A4,
                          leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=17 * mm, bottomMargin=19 * mm,
                          title="SIH 2026 - questions for the Institute",
                          author="Harsh Bajpai")
    doc.addPageTemplates([PageTemplate(id="m", frames=[
        Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")],
        onPage=footer)])

    f = [
        Paragraph("Smart India Hackathon 2026 — what I need to ask", S["title"]),
        Paragraph("Harsh Bajpai &nbsp;·&nbsp; for faculty / the Programme Office "
                  "&nbsp;·&nbsp; 11 September 2026", S["sub"]),
    ]

    # The minimum context without which the questions cannot be answered.
    ctx = Table([[[
        Paragraph("<b>IIM Mumbai has no SPOC registered for SIH 2026.</b> I checked the official "
                  "list on sih.gov.in — no IIM in India is registered. A SPOC has to be a faculty "
                  "member; a student cannot register.", S["ctx"]),
        Paragraph("<b><font color='#A3241C'>The deadline may be 15 September.</font></b> The official "
                  "guidelines say 15th Sept; the same document says 30th Aug elsewhere and the press "
                  "says 30 September. I have written to AICTE to confirm.", S["ctx"]),
        Paragraph("Our <b>AISHE code is U-1283</b>. As a university-level code we could nominate up "
                  "to <b>100 teams</b>; I am asking about one.", S["ctx"]),
    ]]], colWidths=[170 * mm])
    ctx.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BOXBG),
        ("BOX", (0, 0), (-1, -1), 0.7, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    f.append(ctx)

    f.append(Paragraph("My questions", S["h"]))
    rows = [[Paragraph(f'<font name="Calibri-Bold" color="#1F3A6E">{i}.</font>', S["q"]),
             Paragraph(q, S["q"])] for i, q in enumerate(QUESTIONS, 1)]
    tbl = Table(rows, colWidths=[8 * mm, 162 * mm])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    f.append(tbl)

    f.append(Spacer(1, 6))
    f.append(Paragraph(
        "The project is ready — a working browser extension built for ISRO’s problem statement "
        "SIH26171, running on Chrome and Firefox with tested, reproducible results. I am not asking "
        "the Institute to build anything, only to open the door.", S["ctx"]))

    doc.build(f)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
