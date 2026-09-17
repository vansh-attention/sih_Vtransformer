#!/usr/bin/env python3
"""Briefing PDF for IIM Mumbai faculty / Programme Office — SIH 2026.

Every factual claim here was verified against sih.gov.in itself (the public SPOC
registry and the official College-SPOC guidelines PDF), not against blogs. Where
the official sources contradict each other, the PDF says so rather than picking
the convenient reading — this document goes in front of faculty, and one invented
detail would discredit the rest.

REWRITTEN 17 Sep 2026, and the rewrite reverses the document's premise. The
11 Sep version was built on two claims that were true when written and are now
false:

  * "IIM Mumbai has no SPOC registered, and no IIM in India is registered."
    It is registered — row 89 of sih.gov.in/know-your-spoc, AISHE U-1283, SPOC
    Dr. Puja Sarkar. The row did not exist on 11 Sep, so somebody at the
    Institute acted in between.
  * "The safe assumption is 15 September, and I have written to AICTE to
    confirm." The portal settles it at 30 September on every problem-statement
    page; the 15th-Sept guidelines PDF is superseded. And no mail was ever sent
    to AICTE, so that sentence had to go regardless of the date.

The ask is therefore no longer "please register" but "please nominate us", and
the questions, the odds section and the sources all follow from that. Do not
restore the old framing from git history without re-checking the registry.

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
                      "Harsh Bajpai · Aavaran, Team Vagabonds · SIH 2026 briefing "
                      "· 17 September 2026 · all facts verified against sih.gov.in")
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
    f.append(P("Smart India Hackathon 2026 — the Institute is registered, and one team is ready",
               "title"))
    f.append(P("Briefing for faculty / the Programme Office &nbsp;·&nbsp; prepared by Harsh Bajpai "
               "&nbsp;·&nbsp; 17 September 2026<br/>"
               "Every fact below was checked directly on <b>sih.gov.in</b> on 17 September 2026 "
               "— the public SPOC registry, the live problem-statement pages and the official "
               "College-SPOC guidelines PDF.", "sub"))

    # ---------------- the ask ----------------
    f.append(box([
        P("THE ASK, IN ONE LINE", "boxh"),
        P("IIM Mumbai <b>is registered</b> for SIH 2026, with a faculty SPOC in place. What stands "
          "between our team and a submission is a <b>nomination</b> — which requires an internal "
          "selection round and a signed letter on Institute letterhead, both before "
          "<b>30 September</b>. I am asking for those two things, and offering to do every part of "
          "the preparation that a student is allowed to do. <b>A clear no is still useful. Silence "
          "is the only bad outcome.</b>"),
    ]))
    f.append(Spacer(1, 7))

    # ---------------- deadline ----------------
    f.append(box([
        P("TIME IS THE BINDING CONSTRAINT — UNDER TWO WEEKS", "warnh"),
        P("The portal closes for team nomination and idea submission on "
          "<b>30 September 2026</b>. That date is on <b>every problem-statement page on "
          "sih.gov.in</b>, and submissions are demonstrably open today."),
        P("One earlier guidelines PDF says 15th September. <b>It is superseded</b> — the current "
          "guidelines letter says 30th September twice, and the live portal agrees. I raise it "
          "only because the older file is still findable and would cause a needless panic.",
          "body"),
    ], bg=WARNBG, edge=colors.HexColor("#E0B9A6")))
    f.append(Spacer(1, 7))

    # ---------------- verified facts ----------------
    f.append(P("What I verified (so nobody has to take my word for it)", "h"))
    f.append(B("<b>IIM Mumbai is registered.</b> The public registry at "
               "<font name='Calibri-Bold'>sih.gov.in/know-your-spoc</font> lists <b>3,002 "
               "institutes</b>, and the Institute is <b>row 89</b> — AISHE code <b>U-1283</b>, "
               "classified an Institute of National Importance, with <b>Dr. Puja Sarkar</b> as "
               "Single Point of Contact. I read it in the page source, not in a summary."))
    f.append(B("<b>This registration is recent</b> — the row was absent when I checked on "
               "11 September. So this briefing may be reaching someone who already knows all of it."))
    f.append(B("<b>Our problem statement is open.</b> <b>SIH26171</b>, set by ISRO / Department of "
               "Space, stands at roughly <b>20 of the 500</b> submissions at which a statement "
               "freezes nationally — so room is not the risk, but the last day is not the day to "
               "submit either."))
    f.append(B("<b>Management institutes are clearly eligible.</b> Welingkar (PGDM), Narsee Monjee "
               "and dozens of other management schools are registered, as is every IIT. There is no "
               "category question to resolve."))
    f.append(Spacer(1, 3))

    # ---------------- what it takes ----------------
    f.append(P("What remains, now that the Institute is registered", "h"))
    f.append(B("<b>A faculty SPOC</b> — <b>already in place.</b> This step is done, and it was the "
               "one a student cannot perform."))
    f.append(B("<b>An internal hackathon is mandatory.</b> Only teams selected in it may be "
               "nominated. My understanding is that no round is currently planned, and that very "
               "few teams are likely to apply — so a panel of two or three faculty and an hour "
               "would satisfy it."))
    f.append(B("<b>The SPOC must upload an internal-hackathon report</b> of up to 15 pages: event "
               "overview, participating team and student counts, event photographs, jury panel and "
               "judges’ details, judging process, news coverage, social-media promotion, and the "
               "nominated teams. <b>This is the heaviest item on the list.</b> I am offering to "
               "draft it in full, so that it reaches the SPOC as something to check and sign "
               "rather than something to write."))
    f.append(B("<b>A nomination letter per team on Institute letterhead</b>, naming the team and all 6 "
               "members plus up to 2 mentors, signed by the Director/Dean and bearing the Institute seal."))
    f.append(B("Caps: 50 teams per college, <b>100 per university</b>. <b>U-1283 is a university-level "
               "AISHE code</b>, so the ceiling is 100. I am asking about one team."))
    f.append(Spacer(1, 3))

    # ---------------- team rules ----------------
    f.append(P("The team rules, and how our team meets them", "h"))
    f.append(B("<b>Exactly 6 student members.</b> We are six: Harsh Bajpai, Jinshri Jain, Vansh "
               "Khosla, Aarna Chauhan, Manas Bharadia and Siddhartha Chaudhary."))
    f.append(B("<b>At least one female team member is mandatory.</b> We have two."))
    f.append(B("<b>All members must be from the same college. Inter-college teams are not "
               "allowed.</b> All six of us are students of this Institute, so the team is "
               "nominable here and nowhere else."))
    f.append(B("Up to 2 mentors (faculty or industry) are optional, and expected to have roughly 5 years’ "
               "relevant experience."))
    f.append(B("One team may submit against a maximum of 2 problem statements. Each problem statement "
               "freezes nationally once 500 ideas are received, so late submission carries a real risk of "
               "the statement closing."))
    f.append(Spacer(1, 3))

    # ---------------- questions ----------------
    f.append(P("Questions I need answered", "h"))
    f.append(P("Ordered so that a “no” to Q1 ends the matter quickly and costs the Institute nothing "
               "further.", "small"))
    f.append(qtable([
        ("1.", "Is the Institute willing to <b>nominate one team</b> for SIH 2026 before "
                "30 September? A no is a complete answer and I will stop here."),
        ("2.", "Is an <b>internal selection round</b> being planned? If not, would a minimal one "
                "serve — two or three faculty on a panel, an hour, our demonstration and any other "
                "team that wishes to present? Only teams selected in such a round may be nominated."),
        ("3.", "May I <b>draft the internal-hackathon report</b> for the SPOC’s review and "
                "signature? It is the longest document in the process, and it is work a student can "
                "do."),
        ("4.", "Who would <b>sign and seal the nomination letter</b> on letterhead — the Director, "
                "or a Dean? It names all six members and carries the Institute seal."),
        ("5.", "Who should complete the two official forms — the <b>College Consent Letter</b> and "
                "the <b>College Authorization Letter</b>? I hold both blank templates and have not "
                "altered them, because the template states that a changed format is grounds for "
                "disqualification."),
        ("6.", "Is there an <b>internal cut-off earlier than 30 September</b> that I should be "
                "working to instead of the national one?"),
    ]))
    f.append(Spacer(1, 3))

    # ---------------- what exists ----------------
    f.append(KeepTogether([
        P("What I am bringing — this is not a proposal, it is a working system", "h"),
        B("<b>Problem Statement SIH26171</b>, set by <b>ISRO / Department of Space</b> — "
          "“On-device Visual Perception for Light-weight Browser Agents” (Software, Smart "
          "Automation). Our entry is called <b>Aavaran</b>; the team is <b>Vagabonds</b>."),
        B("A browser extension plus a local server: an AI assistant that reads the screen and acts on it "
          "while <b>every PAN, Aadhaar number, card, password and face is removed on the user’s own "
          "machine before anything is transmitted</b>."),
        B("<b>It is built and running today</b>, in Chrome and Firefox, on two tagged releases, with "
          "automated tests passing on Linux, macOS and Windows."),
        B("Measured on test pages never used during development, and separately on <b>ten real "
          "pages captured from the live web</b> — the income-tax portal, RBI, SEBI, UIDAI, MyGov: "
          "<b>100% detection accuracy, 100% precision, zero data leaks</b> on both; about 4.7 "
          "seconds per step on a deliberately slowed laptop. Every figure is reproducible with one "
          "command — none is an estimate."),
        B("Field labels are handled in <b>eleven Indian languages</b>, not only English."),
        B("For an internal selection round, this is a finished demonstrable product rather than a slide "
          "deck of intentions."),
    ]))
    f.append(Spacer(1, 3))

    # ---------------- honest assessment ----------------
    f.append(KeepTogether([
        P("My honest assessment of the odds", "h"),
        P("I would rather set expectations correctly than oversell this.", "small"),
        B("<b>Thirteen days is short</b> for a selection round, a report and a signed nomination, "
          "and the Institute may reasonably decide it is too short. I recognise that, and the "
          "heaviest item — the report — is the one I am offering to write."),
        B("The realistic outcomes are: (a) the Institute nominates one team and we submit before "
          "30 September; (b) it decides the process cannot be compressed this year, and the same "
          "groundwork stands for SIH 2027 with twelve months of notice instead of thirteen days; "
          "or (c) no answer arrives, which is the only outcome that wastes everybody’s time."),
        B("<b>The Institute’s registration already has standing value</b> regardless of what happens "
          "to my team: SIH is an MoE/AICTE initiative, IIM Mumbai is now on the national list, and "
          "the nomination ceiling of 100 teams will still be there next year."),
    ]))
    f.append(Spacer(1, 4))

    # ---------------- references ----------------
    f.append(box([
        P("SOURCES AND CONTACTS — all checkable independently", "boxh"),
        P("<b>SPOC registry</b> (IIM Mumbai is row 89): sih.gov.in/know-your-spoc<br/>"
          "<b>Problem statements</b> (each page carries the 30 September date): "
          "sih.gov.in/sih2026PS<br/>"
          "<b>Official guidelines</b>: sih.gov.in/letters/2026/ — use the current "
          "<i>SIH 2026 Guidelines</i> letter; the file named "
          "<i>SIH2026-Guidelines-College-SPOC-updated.pdf</i> is the superseded one that says "
          "15th September<br/>"
          "<b>AICTE / MIC</b>: sih@aicte-india.org &nbsp;·&nbsp; hackathon@aicte-india.org<br/>"
          "<b>Problem statement</b>: SIH26171 — ISRO / Department of Space", "small"),
    ]))

    doc.build(f)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
