#!/usr/bin/env python3
"""Render the SPOC email as a PDF for the team to read and approve.

This does NOT retype the email. It reads `email-to-spoc.md` and renders it, so
the draft that goes round the team is the same text that gets sent. Copying the
body into a second file would guarantee the two drift, which is the failure this
project has already paid for with documents quoting superseded numbers.

The audience is five teammates approving a draft, not the professor. So the
email body is set apart in a panel, the blanks still to be filled are marked in
red where they sit, and the reasoning is kept at the back where someone who just
wants to read the email can skip it.

    python3 outreach/build-email-pdf.py
"""
import os
import re

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
SRC = f"{HERE}/email-to-spoc.md"
OUT = f"{HERE}/Email-Draft-for-Team-Review.pdf"
DF = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"

pdfmetrics.registerFont(TTFont("Cam", f"{DF}/Cambria.ttc", subfontIndex=0))
pdfmetrics.registerFont(TTFont("Cam-B", f"{DF}/Cambriab.ttf"))
pdfmetrics.registerFont(TTFont("Cam-I", f"{DF}/Cambriai.ttf"))
pdfmetrics.registerFont(TTFont("Cam-BI", f"{DF}/Cambriaz.ttf"))
pdfmetrics.registerFont(TTFont("Cal", f"{DF}/Calibri.ttf"))
pdfmetrics.registerFont(TTFont("Cal-B", f"{DF}/Calibrib.ttf"))
pdfmetrics.registerFont(TTFont("Cal-I", f"{DF}/Calibrii.ttf"))
# Mandatory, or <b> and <i> render at regular weight with no warning at all.
pdfmetrics.registerFontFamily("Cam", normal="Cam", bold="Cam-B", italic="Cam-I",
                              boldItalic="Cam-BI")
pdfmetrics.registerFontFamily("Cal", normal="Cal", bold="Cal-B", italic="Cal-I",
                              boldItalic="Cal-B")

INK = colors.HexColor("#15181F")
NAVY = colors.HexColor("#1B3357")
GREY = colors.HexColor("#5A6270")
LGREY = colors.HexColor("#8A919E")
RULE = colors.HexColor("#C6CCD6")
PANEL = colors.HexColor("#F6F8FC")
RED = colors.HexColor("#A4341F")

S = {
    "title": ParagraphStyle("t", fontName="Cam-B", fontSize=16, leading=19.5,
                            textColor=INK, spaceAfter=2),
    "sub": ParagraphStyle("s", fontName="Cam-I", fontSize=10.4, leading=14,
                          textColor=NAVY, spaceAfter=10),
    "h": ParagraphStyle("h", fontName="Cam-B", fontSize=11.5, leading=14,
                        textColor=NAVY, spaceBefore=13, spaceAfter=5),
    "meta": ParagraphStyle("m", fontName="Cal", fontSize=9, leading=13,
                           textColor=GREY),
    "subject": ParagraphStyle("sj", fontName="Cal-B", fontSize=10.6, leading=14,
                              textColor=INK, spaceAfter=8),
    "body": ParagraphStyle("b", fontName="Cam", fontSize=10.4, leading=15,
                           textColor=INK, alignment=TA_LEFT, spaceAfter=8),
    "num": ParagraphStyle("n", fontName="Cam", fontSize=10.4, leading=15,
                          textColor=INK, leftIndent=15, bulletIndent=3, spaceAfter=5),
    "note": ParagraphStyle("nt", fontName="Cal", fontSize=9.2, leading=13,
                           textColor=GREY, leftIndent=11, rightIndent=6,
                           spaceBefore=2, spaceAfter=8),
    "bul": ParagraphStyle("bl", fontName="Cal", fontSize=9.4, leading=13.4,
                          textColor=INK, leftIndent=13, bulletIndent=3, spaceAfter=6),
    "foot": ParagraphStyle("f", fontName="Cal-I", fontSize=8.6, leading=12,
                           textColor=GREY, spaceBefore=4),
}


def md(t):
    """The small subset of markdown this file actually uses."""
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"`(.+?)`", r'<font name="Courier" size="9">\1</font>', t)
    # The fields still to be filled should be visible at a glance.
    t = re.sub(r"\[([^\]]+)\]",
               rf'<font color="#{RED.hexval()[2:]}"><b>[\1]</b></font>', t)
    return t


def parse(path):
    """Split the source into the header block, the email, and the notes."""
    raw = open(path, encoding="utf-8").read()
    parts = raw.split("\n---\n")
    header, email, notes = parts[0], parts[1], parts[2] if len(parts) > 2 else ""
    return header.strip(), email.strip(), notes.strip()


def blocks(chunk, body_style="body", num_style="num", bul_style="bul"):
    """Turn a markdown chunk into flowables, paragraph by paragraph."""
    out = []
    buf = []

    pending = {"item": None}   # a list item still collecting its wrapped lines

    def flush():
        if pending["item"] is not None:
            txt, bullet, style = pending["item"]
            out.append(Paragraph(md(txt), S[style], bulletText=bullet))
            pending["item"] = None
        if buf:
            # Two trailing spaces is a markdown hard break; keep those lines apart.
            out.append(Paragraph(md(" ".join(buf)).replace("\n ", "<br/>").replace("\n", "<br/>"), S[body_style]))
            buf.clear()

    for line in chunk.split("\n"):
        s = line.rstrip() if not line.endswith("  ") else line
        if not s.strip():
            flush()
            continue
        # A line indented under a list item is a continuation of it, not a new
        # paragraph. Without this the wrapped half of question 1 fell out of its
        # own indent and read as stray text.
        if line.startswith(("   ", "\t")) and pending["item"] is not None:
            t, b, st = pending["item"]
            pending["item"] = (t + " " + s.strip(), b, st)
            continue
        if s.startswith("## "):
            flush()
            out.append(Paragraph(md(s[3:]), S["h"]))
        elif s.startswith("> "):
            flush()
            out.append(Paragraph(md(s[2:]), S["note"]))
        elif re.match(r"^\d+\.\s", s):
            flush()
            n, txt = s.split(".", 1)
            pending["item"] = (txt.strip(), f"{n}.", num_style)
        elif s.startswith("- "):
            flush()
            pending["item"] = (s[2:].strip(), "\u2022", bul_style)
        elif s.startswith("**Subject:**"):
            flush()
            out.append(Paragraph(md(s), S["subject"]))
        else:
            buf.append(s.strip() + ("\n" if line.endswith("  ") else ""))
    flush()
    return out


def page(canvas, doc):
    canvas.saveState()
    canvas.setFont("Cal", 7.6)
    canvas.setFillColor(LGREY)
    canvas.drawString(20 * mm, 12 * mm, "Draft for team approval  ·  not yet sent")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, str(canvas.getPageNumber()))
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(20 * mm, 15.5 * mm, A4[0] - 20 * mm, 15.5 * mm)
    canvas.restoreState()


def build():
    header, email, notes = parse(SRC)
    doc = BaseDocTemplate(OUT, pagesize=A4, title="Draft email to the SIH SPOC",
                          subject="For team review before sending",
                          leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=18 * mm, bottomMargin=20 * mm)
    doc.addPageTemplates([PageTemplate(id="p",
                                       frames=[Frame(doc.leftMargin, doc.bottomMargin,
                                                     doc.width, doc.height, id="f")],
                                       onPage=page)])
    story = []
    a = story.append

    a(Paragraph("Draft email to the institute SPOC", S["title"]))
    a(Paragraph("Please read and approve, or mark anything you want changed", S["sub"]))

    # Header metadata, lifted from the source rather than restated.
    meta_rows = []
    for line in header.split("\n"):
        if line.startswith("**") and ":**" in line:
            k, v = line.split(":**", 1)
            meta_rows.append([Paragraph(md(k.strip("* ") + ":"), S["meta"]),
                              Paragraph(md(v.strip()), S["meta"])])
    if meta_rows:
        t = Table(meta_rows, colWidths=[20 * mm, 150 * mm])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 1.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ]))
        a(t)
    a(Spacer(1, 7))
    a(Paragraph("Only the Cc addresses are outstanding. The email body is final.",
                S["meta"]))
    a(Spacer(1, 10))

    # The email itself, set in a panel so it is unmistakably the thing being approved.
    # One row per paragraph, not one cell holding everything. A single-cell table
    # cannot split, so the whole email jumped to page two and left page one blank.
    # Row by row it flows, and reportlab repaints the panel on each fragment.
    inner = blocks(email)
    panel = Table([[f] for f in inner], colWidths=[doc.width])
    panel.splitByRow = 1
    panel.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("LINEBEFORE", (0, 0), (0, -1), 2.2, NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (0, 0), 12),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 12),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 13),
    ]))
    a(panel)

    if notes:
        for f in blocks(notes):
            a(f)

    a(Spacer(1, 4))
    a(Paragraph("Rendered from outreach/email-to-spoc.md. Edit that file and rebuild; "
                "do not edit this PDF, or the sent email and the approved one stop "
                "matching.", S["foot"]))

    doc.build(story)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    build()
