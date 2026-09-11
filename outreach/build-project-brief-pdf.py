#!/usr/bin/env python3
"""A two-page capability brief on the project, written for the Director.

Audience note that drives every choice below: the reader is a senior academic
administrator, not a systems engineer. That argues for precision rather than
jargon — an IIM Director is unimpressed by buzzwords and very much impressed by
a held-out test set. So the document leads with plain English, and the technical
detail sits at the back for the record.

Attribution: git shortlog on 11 Sep 2026 shows 57 of 58 commits authored by
Harsh Bajpai, so first-person authorship is supported by the record. The
repository is hosted under a teammate's account for a team entry, and the brief
says so rather than letting the reader assume otherwise.

Every number here was produced by `bench/score.ts` and `./test-all.sh` on
11 Sep 2026, not estimated.

    python3 outreach/build-project-brief-pdf.py
"""
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = f"{HERE}/Project-Brief-Privacy-Browser-Agent.pdf"
DFONTS = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"

pdfmetrics.registerFont(TTFont("Calibri", f"{DFONTS}/Calibri.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-Bold", f"{DFONTS}/Calibrib.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-Italic", f"{DFONTS}/Calibrii.ttf"))
pdfmetrics.registerFont(TTFont("Calibri-BoldItalic", f"{DFONTS}/Calibriz.ttf"))
pdfmetrics.registerFont(TTFont("Cambria-Bold", f"{DFONTS}/Cambriab.ttf"))
# Without this <b>/<i> silently render at regular weight. No warning is issued.
pdfmetrics.registerFontFamily("Calibri", normal="Calibri", bold="Calibri-Bold",
                              italic="Calibri-Italic", boldItalic="Calibri-BoldItalic")

INK = colors.HexColor("#141B2E")
NAVY = colors.HexColor("#1F3A6E")
GREEN = colors.HexColor("#15603A")
GREY = colors.HexColor("#4A5260")
RULE = colors.HexColor("#C9CFDA")
BOXBG = colors.HexColor("#EEF2FA")
HEADBG = colors.HexColor("#1F3A6E")

S = {
    "title": ParagraphStyle("t", fontName="Cambria-Bold", fontSize=16, leading=19,
                            textColor=INK, spaceAfter=1),
    "tag": ParagraphStyle("tg", fontName="Calibri-Italic", fontSize=10.5, leading=13.5,
                          textColor=NAVY, spaceAfter=4),
    "sub": ParagraphStyle("s", fontName="Calibri", fontSize=9, leading=11.8,
                          textColor=GREY, spaceAfter=9),
    "h": ParagraphStyle("h", fontName="Cambria-Bold", fontSize=11, leading=13.5,
                        textColor=NAVY, spaceBefore=10, spaceAfter=4),
    "body": ParagraphStyle("b", fontName="Calibri", fontSize=9.6, leading=12.9,
                           textColor=INK, alignment=TA_LEFT, spaceAfter=4),
    "bullet": ParagraphStyle("bu", fontName="Calibri", fontSize=9.6, leading=12.9,
                             textColor=INK, leftIndent=11, bulletIndent=2, spaceAfter=3),
    "cell": ParagraphStyle("c", fontName="Calibri", fontSize=9, leading=11.6,
                           textColor=INK),
    # A Paragraph carries its own alignment, so the table's ALIGN=CENTER is ignored for
    # cells holding one. The value columns need a centred style of their own.
    "cellc": ParagraphStyle("cc", fontName="Calibri", fontSize=9, leading=11.6,
                            textColor=INK, alignment=TA_CENTER),
    "cellb": ParagraphStyle("cb", fontName="Calibri-Bold", fontSize=9, leading=11.6,
                            textColor=colors.white),
    "small": ParagraphStyle("sm", fontName="Calibri", fontSize=8.2, leading=10.6,
                            textColor=GREY, spaceAfter=2),
    "boxh": ParagraphStyle("bh", fontName="Cambria-Bold", fontSize=10.5, leading=13,
                           textColor=NAVY, spaceAfter=3),
}


def P(t, st="body"):
    return Paragraph(t, S[st])


def B(t):
    return Paragraph(t, S["bullet"], bulletText="•")


def box(flows, bg=BOXBG):
    t = Table([[flows]], colWidths=[172 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.7, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Calibri", 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(19 * mm, 11 * mm,
                      "Harsh Bajpai · Project brief · 11 September 2026 · "
                      "all figures reproducible from the repository")
    canvas.drawRightString(191 * mm, 11 * mm, f"Page {canvas.getPageNumber()}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(19 * mm, 14.5 * mm, 191 * mm, 14.5 * mm)
    canvas.restoreState()


def main():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=19 * mm, rightMargin=19 * mm,
                          topMargin=16 * mm, bottomMargin=19 * mm,
                          title="Project brief - privacy-preserving browser agent",
                          author="Harsh Bajpai")
    doc.addPageTemplates([PageTemplate(id="m", frames=[
        Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")],
        onPage=footer)])
    f = []

    f.append(P("A browser assistant that can see your screen — "
               "without your personal data leaving your machine", "title"))
    f.append(P("Project brief · Harsh Bajpai · 11 September 2026", "tag"))
    f.append(P("Built for <b>Problem Statement SIH26171</b>, set by <b>ISRO / Department of Space</b> "
               "for Smart India Hackathon 2026 — “On-device Visual Perception for Light-weight "
               "Browser Agents” (Software · Smart Automation).", "sub"))

    # ---------------- problem ----------------
    f.append(P("The problem", "h"))
    f.append(P("An AI assistant is only useful if it can see what is on your screen. But your screen "
               "holds your PAN, your Aadhaar number, your bank details and an open password field. "
               "Today the choice is binary: accept an assistant that sends everything it sees to a "
               "company’s servers, or have no assistant at all."))
    f.append(P("For a government department, a bank or a defence establishment this is not a "
               "preference — it is a <b>policy bar</b>. The technology is barred from precisely the "
               "workflows where it would be most valuable."))

    # ---------------- what it is ----------------
    f.append(P("What I built", "h"))
    f.append(P("A browser extension for <b>Chrome and Firefox</b>, paired with a small server that runs "
               "on the same machine. Working software, not a prototype sketch:"))
    f.append(B("A compact vision model runs <b>inside the browser</b> and reads the page."))
    f.append(B("Every PAN, Aadhaar number, card number, password and human face is replaced with a "
               "typed placeholder — <font name='Calibri-Bold'>&lt;PII_PAN_1&gt;</font> — "
               "<b>before any network request is made</b>."))
    f.append(B("A larger open-weight language model reasons over the censored page and returns a single "
               "instruction, such as “click Submit”."))
    f.append(B("The browser validates that instruction against its own safety rules, then carries it out."))
    f.append(B("A <b>Privacy Ledger</b> shows the user exactly what was withheld and the exact bytes that "
               "were transmitted, so the claim can be inspected rather than believed."))
    f.append(P("The reasoning model is <b>open-weight and runs locally</b>. The system works with the "
               "network disconnected. No data is sent to any external provider at any point."))

    # ---------------- the key idea ----------------
    f.append(box([
        P("THE CENTRAL IDEA — WHY THIS IS A GUARANTEE RATHER THAN A PROMISE", "boxh"),
        P("The store of real values lives in one isolated component. The component that talks to the "
          "network <b>has never held a real value at any point in the program’s execution</b>."),
        P("So “no personal data leaves the machine” is a property of the <b>architecture</b>, not an "
          "assurance about the quality of my code. A defect in the networking layer <i>cannot</i> leak "
          "a PAN, because that layer has never been given one. This is the difference between a system "
          "that is trustworthy by construction and one that is trustworthy by inspection.", "body"),
    ]))

    # ---------------- results ----------------
    f.append(P("Measured results", "h"))
    f.append(P("Every figure below is produced by a single command from the repository. None is an "
               "estimate, and none is rounded in our favour.", "small"))

    hdrc = ParagraphStyle("hc", parent=S["cellb"], alignment=TA_CENTER)
    hdr = [Paragraph("Measure", S["cellb"]),
           Paragraph("Development set", hdrc),
           Paragraph("Unseen set (held out)", hdrc)]
    rows = [
        ["Ability to read the page correctly", "100%", "100%"],
        ["Sensitive-data detection — recall", "100%", "100%"],
        ["Sensitive-data detection — precision", "100%", "100%"],
        ["Context preserved (not over-redacted)", "100%", "100%"],
        ["Personal values leaked", "0", "0"],
    ]
    data = [hdr] + [[Paragraph(r[0], S["cell"]),
                     Paragraph(f"<b>{r[1]}</b>", S["cellc"]),
                     Paragraph(f"<b>{r[2]}</b>", S["cellc"])] for r in rows]
    t = Table(data, colWidths=[88 * mm, 40 * mm, 44 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADBG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F6F8FC")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    f.append(t)
    f.append(Spacer(1, 5))
    f.append(P("<b>Speed.</b> About <b>4.7 seconds</b> per step on a deliberately slowed low-end laptop "
               "(measured under six-times processor throttling, not estimated); roughly 3.7 seconds on a "
               "current machine. Around 47 KB is transmitted per step."))
    f.append(P("<b>Coverage.</b> Field labels are recognised in <b>eleven Indian languages</b>, not only "
               "English — including Hindi, Marathi, Tamil, Telugu, Bengali, Gujarati, Kannada, Malayalam, "
               "Punjabi and Odia."))

    # ---------------- methodology ----------------
    f.append(KeepTogether([
        P("How I know the numbers are honest", "h"),
        P("The column that matters is the second one. A set of test pages was written "
          "<b>before any tuning began</b> and has never been optimised against — the discipline a "
          "researcher would call a held-out set. It exists because the competition’s final evaluation "
          "uses websites revealed on the day, so performance on pages I have already seen predicts "
          "very little."),
        B("The two sets are scored separately and reported separately. I quote the unseen figure."),
        B("The system ships its own <b>counterfactual</b>: switching off one detection layer drops "
          "unseen-set recall to 91.7%. A perfect score is only meaningful if you can show what makes "
          "it move."),
        B("<b>Every safety test is verified to be capable of failing.</b> I deliberately break the "
          "protection and confirm the test turns red before trusting it green — a test that cannot "
          "fail is worse than no test, and this project has caught one such test in its own suite."),
        B("Automated tests run on <b>Linux, macOS and Windows</b> on every change. Sixteen checks, "
          "currently all passing."),
    ]))

    # ---------------- technical ----------------
    f.append(KeepTogether([
        P("Technical summary, for the record", "h"),
        B("<b>Detection</b> is a three-stage cascade: page structure and accessibility metadata; then "
          "pattern matching <b>with checksum validation</b> (Verhoeff for Aadhaar, Luhn for payment "
          "cards, mod-36 for GSTIN); then person names, via public name lists combined with a "
          "dictionary-absence test that catches names no list contains."),
        B("<b>Checksums matter commercially.</b> They convert a noisy pattern-matcher into a precise "
          "one — which is why a twelve-digit order total that happens to satisfy the Aadhaar checksum "
          "is deliberately <i>not</i> redacted. Over-redaction destroys the context the assistant needs, "
          "and is penalised as heavily as leaking."),
        B("<b>Faces</b> are detected and blurred on-device by a 1.2 MB model, verified on pixels to "
          "destroy 89% of facial detail with no damage to the surrounding image."),
        B("<b>Adversarial resistance.</b> Web pages that attempt to manipulate the assistant into "
          "disclosing data are refused structurally: the validator rejects 16 of 24 test instructions, "
          "including a genuine data-exfiltration route found and closed during development. The defence "
          "does not depend on the AI behaving well — it never possessed a real value to disclose."),
        B("Roughly 6,500 lines of TypeScript and Python. Two tagged releases."),
    ]))

    # ---------------- status ----------------
    f.append(P("Status and authorship", "h"))
    f.append(B("<b>Working today</b> in both Chrome and Firefox: the complete loop, on-device face "
               "blurring, the Privacy Ledger, adversarial-page defences and graceful failure handling."))
    f.append(B("Developed as the entry for a Smart India Hackathon team. The repository is hosted under "
               "a teammate’s account; the version history records <b>57 of 58 commits</b> as mine, and "
               "the design decisions, measurements and test methodology described here are my own work."))
    f.append(B("Documented throughout — the architectural decisions are recorded with the measurements "
               "that produced them, so the reasoning is auditable and not only the result."))

    f.append(Spacer(1, 5))
    f.append(box([
        P("WHY IT MATTERS BEYOND THE COMPETITION", "boxh"),
        P("Browser-based AI assistants are currently unusable anywhere the screen is sensitive — "
          "government departments, banking, healthcare, defence, and ISRO’s own workflows. This work "
          "removes that barrier rather than asking anyone to lower it, and the redaction approach is "
          "reusable by any assistant, not only this one.", "body"),
    ]))

    doc.build(f)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
