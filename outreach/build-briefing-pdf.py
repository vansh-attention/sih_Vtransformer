#!/usr/bin/env python3
"""Briefing PDF for IIM Mumbai faculty / Programme Office — SIH 2026.

Every factual claim here was verified on 11 Sep 2026 against sih.gov.in itself
(the public SPOC registry and the official College-SPOC guidelines PDF), not
against blogs. Where the official sources contradict each other, the PDF says so
rather than picking the convenient reading — this document goes in front of
faculty, and one invented detail would discredit the rest.

    python3 outreach/build-briefing-pdf.py
"""
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageTemplate,
                               Paragraph, Spacer, Table, TableStyle)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = f"{HERE}/SIH2026-IIM-Mumbai-Briefing.pdf"
DFONTS = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"

# Calibri, not Helvetica: reportlab's built-in Helvetica has no rupee glyph, and
# this is an Indian-institution document.
pdfmetrics.registerFont(TTFont("Calibri", f"{DFONTS}/Calibri.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-Bold", f"{DFONTS}/Calibrib.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-Italic", f"{DFONTS}/Calibrii.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-BoldItalic", f"{DFONTS}/Calibriz.ttf"))
pdfmetrics.registerFont(TTFont("Cambria-Bold", f"{DFONTS}/Cambriab.ttf"))

# Without this, <b> and <i> inside a Paragraph silently do NOTHING — reportlab has no
# way to know which face is Calibri's bold, so it renders the regular weight and gives
# no warning. Every emphasis in this document would have been lost, which on a page whose
# job is to make four facts jump out is the whole point of the page.
pdfmetrics.registerFontFamily("Calibri", normal="Calibri", bold="Calibri-Bold",
                              italic="Calibri-Italic", boldItalic="Calibri-BoldItalic")

INK = colors.HexColor("#141B2E")
NAVY = colors.HexColor("#1F3A6E")
RED = colors.HexColor("#A3241C")
GREY = colors.HexColor("#4A5260")
RULE = colors.HexColor("#C9CFDA")
BOXBG = colors.HexColor("#EEF2FA")
WARNBG = colors.HexColor("#FDF2EC")

S = {
    "title": ParagraphStyle("t", fontName="Cambria-Bold", fontSize=16, leading=19,
                            textColor=INK, spaceAfter=2),
    "sub": ParagraphStyle("s", fontName="Calibri", fontSize=9.5, leading=12.5,
                          textColor=GREY, spaceAfter=9),
    "h": ParagraphStyle("h", fontName="Cambria-Bold", fontSize=11, leading=13,
                        textColor=NAVY, spaceBefore=9, spaceAfter=4),
    "body": ParagraphStyle("b", fontName="Calibri", fontSize=9.5, leading=12.6,
                           textColor=INK, alignment=TA_LEFT, spaceAfter=3),
    "bullet": ParagraphStyle("bu", fontName="Calibri", fontSize=9.5, leading=12.6,
                             textColor=INK, leftIndent=11, bulletIndent=2,
                             spaceAfter=2.5),
    "q": ParagraphStyle("q", fontName="Calibri", fontSize=9.5, leading=12.6,
                        textColor=INK, spaceAfter=0),
    "small": ParagraphStyle("sm", fontName="Calibri", fontSize=8.2, leading=10.6,
                            textColor=GREY, spaceAfter=2),
    "boxh": ParagraphStyle("bh", fontName="Cambria-Bold", fontSize=10.5, leading=13,
                           textColor=NAVY, spaceAfter=3),
    "warnh": ParagraphStyle("wh", fontName="Cambria-Bold", fontSize=10.5, leading=13,
                            textColor=RED, spaceAfter=3),
}


def P(t, st="body"):
    return Paragraph(t, S[st])


def B(t):
    return Paragraph(t, S["bullet"], bulletText="•")


def box(flows, bg=BOXBG, edge=RULE):
    tbl = Table([[flows]], colWidths=[172 * mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.7, edge),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return tbl


def qtable(rows):
    """Numbered questions. A table, so long questions wrap under their number."""
    data = [[Paragraph(f'<font name="Calibri-Bold">{n}</font>', S["q"]),
             Paragraph(t, S["q"])] for n, t in rows]
    tbl = Table(data, colWidths=[8 * mm, 164 * mm])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]))
    return tbl


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Calibri", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(19 * mm, 11 * mm,
                      "Harsh Bajpai · SIH 2026 briefing · prepared 11 September 2026 "
                      "· all facts verified against sih.gov.in")
    canvas.drawRightString(191 * mm, 11 * mm, f"Page {canvas.getPageNumber()}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(19 * mm, 14.5 * mm, 191 * mm, 14.5 * mm)
    canvas.restoreState()


def main():
    doc = BaseDocTemplate(OUT, pagesize=A4,
                          leftMargin=19 * mm, rightMargin=19 * mm,
                          topMargin=16 * mm, bottomMargin=19 * mm,
                          title="SIH 2026 - Briefing for IIM Mumbai",
                          author="Harsh Bajpai")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=footer)])

    f = []
    f.append(P("Smart India Hackathon 2026 — a decision the Institute needs to take", "title"))
    f.append(P("Briefing for faculty / the Programme Office &nbsp;·&nbsp; prepared by Harsh Bajpai "
               "&nbsp;·&nbsp; 11 September 2026<br/>"
               "Every fact below was checked directly on <b>sih.gov.in</b> on 11 September 2026 "
               "— the public SPOC registry and the official College-SPOC guidelines PDF.", "sub"))

    # ---------------- the ask ----------------
    f.append(box([
        P("THE ASK, IN ONE LINE", "boxh"),
        P("IIM Mumbai has <b>no SPOC registered</b> for SIH 2026. A SPOC must be a "
          "<b>faculty member</b> — a student cannot register. I am asking the Institute either "
          "to appoint and register one, or to tell me it is not feasible, so that I can pursue my "
          "other enrolment instead. <b>Either answer is useful. Silence is the only bad outcome.</b>"),
    ]))
    f.append(Spacer(1, 7))

    # ---------------- deadline ----------------
    f.append(box([
        P("TIME IS THE BINDING CONSTRAINT — POSSIBLY 4 DAYS", "warnh"),
        P("The official guidelines PDF states, word for word: "
          "<i>“The last date for team nomination and idea submission by College SPOC and Team "
          "leader on SIH portal is till <b>15th Sept 2026</b> only. No request will be entertained "
          "after the deadline.”</i>"),
        P("The <b>same document</b> says 30th Aug on an earlier page, and press coverage says "
          "30 September. The sources genuinely contradict each other, so I am not presenting one as "
          "settled. <b>The safe assumption is 15 September.</b> Confirming which is correct is "
          "question 1 below.", "body"),
    ], bg=WARNBG, edge=colors.HexColor("#E0B9A6")))
    f.append(Spacer(1, 7))

    # ---------------- verified facts ----------------
    f.append(P("What I verified (so nobody has to take my word for it)", "h"))
    f.append(B("<b>IIM Mumbai is not registered.</b> The public registry at "
               "<font name='Calibri-Bold'>sih.gov.in/know-your-spoc</font> lists <b>3,000 institutes</b>. "
               "I searched the full list."))
    f.append(B("<b>No IIM in India is registered</b> — not one. I also checked <b>NITIE</b>, this "
               "Institute’s name until the 2023 rename, in case of a legacy entry. Absent too."))
    f.append(B("<b>Management institutes are clearly eligible.</b> Welingkar (PGDM), Narsee Monjee and "
               "dozens of other management schools are registered. This is not a category exclusion — "
               "it appears simply never to have been done."))
    f.append(B("<b>Registration has not been taken offline.</b> "
               "<font name='Calibri-Bold'>sih.gov.in/collegeRegistration</font> still returns a working "
               "new-user form with OTP verification and shows no closed notice. The announced last date "
               "(31 July, extended to 14 August) has passed, so <b>a live form is not the same as "
               "permission</b> — only AICTE can confirm."))
    f.append(B("<b>Every IIT is registered</b>, including IIT Madras. That matters because I am "
               "concurrently enrolled in the IIT Madras BS programme, which is my fallback route."))
    f.append(Spacer(1, 3))

    # ---------------- what it takes ----------------
    f.append(P("What participation actually requires of the Institute", "h"))
    f.append(B("<b>A faculty SPOC</b>, registered on the portal. Needs the Institute’s "
               "<b>AISHE / AICTE code</b>."))
    f.append(B("<b>An internal hackathon is mandatory.</b> Only teams selected in it may be nominated."))
    f.append(B("<b>The SPOC must upload an internal-hackathon report</b> of up to 15 pages: event "
               "overview, participating team and student counts, event photographs, jury panel and "
               "judges’ details, judging process, news coverage, social-media promotion, and the "
               "nominated teams. <b>This is the heaviest item on the list and the main reason a "
               "compressed timeline is hard.</b>"))
    f.append(B("<b>A nomination letter per team on Institute letterhead</b>, naming the team and all 6 "
               "members plus up to 2 mentors, signed by the Director/Dean and bearing the Institute seal."))
    f.append(B("Caps: <b>50 teams per college</b> (45 shortlisted + 5 waitlisted), <b>100 per university</b>. "
               "Nominating one team does not use up meaningful capacity."))
    f.append(Spacer(1, 3))

    # ---------------- team rules ----------------
    f.append(P("Team rules that decide which institute I can even apply through", "h"))
    f.append(B("<b>Exactly 6 student members</b>, including the team leader."))
    f.append(B("<b>At least one female team member is mandatory.</b>"))
    f.append(B("<b>All members must be from the same college. Inter-college teams are not allowed.</b> "
               "This is the rule that forces a single choice between IIM Mumbai and IIT Madras — "
               "I cannot combine them."))
    f.append(B("Up to 2 mentors (faculty or industry) are optional, and expected to have roughly 5 years’ "
               "relevant experience."))
    f.append(B("One team may submit against a maximum of 2 problem statements. Each problem statement "
               "freezes nationally once 500 ideas are received, so late submission carries a real risk of "
               "the statement closing."))
    f.append(Spacer(1, 3))

    # ---------------- questions ----------------
    f.append(P("Questions I need answered", "h"))
    f.append(P("Ordered so that a “no” to Q2 ends the matter quickly and costs the Institute nothing "
               "further.", "small"))
    f.append(qtable([
        ("1.", "Is the Institute willing to <b>appoint a faculty member as SPOC</b> and register on "
                "sih.gov.in? If yes, who, and can it be initiated this week?"),
        ("2.", "If not — is that a <b>final no for SIH 2026</b>? I will then stop pursuing this route "
                "through IIM Mumbai and go via IIT Madras. I need the answer, not a favourable one."),
        ("3.", "Does the Institute hold an <b>AISHE or AICTE code</b>, and who can supply it? The "
                "registration form requires it."),
        ("4.", "Who would <b>sign and seal the nomination letter</b> — the Director, or a Dean?"),
        ("5.", "Is the Institute willing to run a <b>minimal internal hackathon</b> and produce the "
                "required report? Given the timeline this may be the deciding constraint, and I would "
                "rather hear that plainly than have it stall later."),
        ("6.", "Has the Institute been approached about SIH in previous years and declined? If there is "
                "an existing policy position, knowing it saves everyone time."),
        ("7.", "If SIH 2026 is not possible, would the Institute consider <b>registering a SPOC now for "
                "SIH 2027</b>? Registration opens around July each year, and the absence of any IIM from "
                "the national list looks like an opportunity rather than a deliberate choice."),
    ]))
    f.append(Spacer(1, 3))

    # ---------------- what exists ----------------
    f.append(KeepTogether([
        P("What I am bringing — this is not a proposal, it is a working system", "h"),
        B("<b>Problem Statement SIH26171</b>, set by <b>ISRO / Department of Space</b> — "
          "“On-device Visual Perception for Light-weight Browser Agents” (Software, Smart Automation)."),
        B("A browser extension plus a local server: an AI assistant that reads the screen and acts on it "
          "while <b>every PAN, Aadhaar number, card, password and face is removed on the user’s own "
          "machine before anything is transmitted</b>."),
        B("<b>It is built and running today</b>, in Chrome and Firefox, on two tagged releases, with "
          "automated tests passing on Linux, macOS and Windows."),
        B("Measured on test pages never used during development: <b>100% detection accuracy, "
          "100% precision, zero data leaks</b>; about 4.7 seconds per step on a deliberately slowed "
          "laptop. Every figure is reproducible with one command — none is an estimate."),
        B("Field labels are handled in <b>eleven Indian languages</b>, not only English."),
        B("For an internal selection round, this is a finished demonstrable product rather than a slide "
          "deck of intentions."),
    ]))
    f.append(Spacer(1, 3))

    # ---------------- honest assessment ----------------
    f.append(KeepTogether([
        P("My honest assessment of the odds", "h"),
        P("I would rather set expectations correctly than oversell this.", "small"),
        B("Registering a SPOC, running an internal hackathon, producing the report and nominating a team "
          "<b>within four days is a great deal to ask</b>, and it may simply not be practical. I recognise that."),
        B("The realistic outcomes are: (a) AICTE confirms a later deadline and this becomes feasible; "
          "(b) I proceed through IIT Madras; or (c) IIM Mumbai registers now and is positioned for "
          "SIH 2027 with a year of preparation."),
        B("<b>Outcome (c) has standing value to the Institute regardless of what happens to my team</b> — "
          "SIH participation is an MoE/AICTE initiative, and no IIM currently appears on the national list."),
    ]))
    f.append(Spacer(1, 4))

    # ---------------- references ----------------
    f.append(box([
        P("SOURCES AND CONTACTS — all checkable independently", "boxh"),
        P("<b>SPOC registry</b> (confirms the absence): sih.gov.in/know-your-spoc<br/>"
          "<b>Registration form</b> (still live): sih.gov.in/collegeRegistration<br/>"
          "<b>Official guidelines</b>: sih.gov.in/letters/2026/SIH2026-Guidelines-College-SPOC-updated.pdf<br/>"
          "<b>AICTE / MIC</b>: sih@aicte-india.org &nbsp;·&nbsp; hackathon@aicte-india.org<br/>"
          "<b>Problem statement</b>: SIH26171 — ISRO / Department of Space", "small"),
    ]))

    doc.build(f)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
