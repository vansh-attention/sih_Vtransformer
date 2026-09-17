#!/usr/bin/env python3
"""One-page question sheet for Harsh to put to IIM Mumbai faculty / Programme Office.

Deliberately NOT the full briefing (see build-briefing-pdf.py). This is questions only,
written in Harsh's own voice — first person, the things he is asking, not my analysis of
the situation. The only context kept is the three lines without which the questions
cannot be answered or forwarded.

REWRITTEN 17 Sep 2026. The 11 Sep version asked the Institute to appoint and register a
SPOC, and stated that no IIM in India was registered. Both are now wrong: IIM Mumbai IS
registered — row 89 of sih.gov.in/know-your-spoc, AISHE U-1283, SPOC Dr. Puja Sarkar —
and the deadline the old sheet flagged as "possibly 15 September" is confirmed on the
portal as 30 September. That version also said he had written to AICTE, which he had
not. Everything downstream of those premises has been replaced; what is left is the
nomination, the internal hackathon and the letterhead, which are the parts still open.

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
    "Our team of six is ready and our idea is built. <b>What does the Institute need from us to "
    "nominate it</b> before the portal closes on 30 September? If there is an internal cut-off "
    "earlier than that date, I would like to work to it rather than to the national one.",

    "The guidelines make an <b>internal hackathon mandatory</b> — only teams selected in one may "
    "be nominated. Is the Institute running one? If not, would a <b>minimal round</b> serve: a "
    "panel of two or three faculty, an hour, our demonstration and any other team that wants to "
    "present. I understand very few teams are likely to apply this year.",

    "That round has to be <b>written up by the SPOC</b> — up to fifteen pages with photographs, "
    "the jury panel and the judging process. <b>I am offering to prepare that document</b> so it "
    "costs the SPOC an approval rather than an evening. Is that acceptable?",

    "Who would <b>sign and seal the nomination letter</b> on Institute letterhead — the Director, "
    "or a Dean? It has to name all six team members and carry the Institute seal.",

    "There are two official forms — a <b>College Consent Letter</b> and a <b>College "
    "Authorization Letter</b>. I have both blank templates. Who should fill them, and to whom do "
    "I return them? <b>They must not be reformatted</b> — the template says a changed format is "
    "grounds for disqualification, so I have not touched them.",

    "Is there <b>anything the Institute needs from us in writing</b> — the team list, roll "
    "numbers, the problem statement, a one-page summary of the project? I can have any of it "
    "the same day.",

    "Is there <b>anyone else I should be speaking to</b> about this instead of you?",
]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Calibri", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 11 * mm,
                      "Harsh Bajpai · Smart India Hackathon 2026 · Aavaran, "
                      "Team Vagabonds · 17 September 2026")
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
                  "&nbsp;·&nbsp; 17 September 2026", S["sub"]),
    ]

    # The minimum context without which the questions cannot be answered.
    ctx = Table([[[
        Paragraph("<b>IIM Mumbai is registered for SIH 2026.</b> The Institute appears at row 89 of "
                  "the official list on sih.gov.in/know-your-spoc, AISHE code <b>U-1283</b>, with "
                  "<b>Dr. Puja Sarkar</b> as Single Point of Contact. I have written to her "
                  "separately. So the route exists — my questions are about what comes next.",
                  S["ctx"]),
        Paragraph("<b><font color='#A3241C'>The portal closes on 30 September 2026.</font></b> That "
                  "is confirmed on sih.gov.in itself, on every problem-statement page. An earlier "
                  "guidelines PDF saying 15th September has been superseded.", S["ctx"]),
        Paragraph("As a university-level AISHE code the Institute may nominate up to <b>100 "
                  "teams</b>; I am asking about one, of six students, with a built and tested "
                  "entry for ISRO’s problem statement <b>SIH26171</b>.", S["ctx"]),
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
        "The project is ready — <b>Aavaran</b>, a working browser extension built for ISRO’s problem "
        "statement SIH26171, running on Chrome and Firefox with tested, reproducible results, and "
        "installable on a laptop in about a minute if anyone would like to see it. I am not asking "
        "the Institute to build anything, only to nominate us.", S["ctx"]))

    doc.build(f)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
