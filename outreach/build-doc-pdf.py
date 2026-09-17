#!/usr/bin/env python3
"""Render a markdown document to PDF with the same typography as the report.

Written for TEAM-EXPLAINER.md, which the team will open on a phone in WhatsApp rather
than on GitHub. Markdown is the source of truth and this only renders it, so the two
cannot drift.

Handles the subset those documents actually use: headings, paragraphs, tables, bullets,
numbered lists, block quotes, bold, italics and inline code. Anything else is passed
through as plain text rather than silently dropped.

    python3 outreach/build-doc-pdf.py outreach/TEAM-EXPLAINER.md
"""
import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

DF = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"
pdfmetrics.registerFont(TTFont("Cam", f"{DF}/Cambria.ttc", subfontIndex=0))
pdfmetrics.registerFont(TTFont("Cam-B", f"{DF}/Cambriab.ttf"))
pdfmetrics.registerFont(TTFont("Cam-I", f"{DF}/Cambriai.ttf"))
pdfmetrics.registerFont(TTFont("Cam-BI", f"{DF}/Cambriaz.ttf"))
pdfmetrics.registerFont(TTFont("Cal", f"{DF}/Calibri.ttf"))
pdfmetrics.registerFont(TTFont("Cal-B", f"{DF}/Calibrib.ttf"))
pdfmetrics.registerFont(TTFont("Cal-I", f"{DF}/Calibrii.ttf"))
# Without this, <b> and <i> render at regular weight and nothing warns you.
pdfmetrics.registerFontFamily("Cam", normal="Cam", bold="Cam-B", italic="Cam-I",
                              boldItalic="Cam-BI")
pdfmetrics.registerFontFamily("Cal", normal="Cal", bold="Cal-B", italic="Cal-I",
                              boldItalic="Cal-B")

INK = colors.HexColor("#15181F")
NAVY = colors.HexColor("#1B3357")
GREY = colors.HexColor("#5A6270")
LGREY = colors.HexColor("#8A919E")
RULE = colors.HexColor("#C6CCD6")
SOFT = colors.HexColor("#EDF1F7")

# allowWidows=0 keeps a paragraph's last line off the top of the next page on its own.
S = {
    "h1": ParagraphStyle("h1", fontName="Cam-B", fontSize=17, leading=21,
                         textColor=INK, spaceAfter=4, keepWithNext=1),
    # keepWithNext is reportlab's own mechanism and moves only the heading. Binding the
# heading to the next flowable by hand with KeepTogether was tried and rejected: it
# turned a 3-page document into a 7-page one by pushing whole blocks to a new page.
    "h2": ParagraphStyle("h2", fontName="Cam-B", fontSize=12.5, leading=15.5,
                         textColor=NAVY, spaceBefore=15, spaceAfter=5, keepWithNext=1),
    "h3": ParagraphStyle("h3", fontName="Cam-I", fontSize=11, leading=14,
                         textColor=GREY, spaceBefore=1, spaceAfter=6, keepWithNext=1),
    "p": ParagraphStyle("p", fontName="Cam", fontSize=10.8, leading=15.2,
                        textColor=INK, alignment=TA_LEFT, spaceAfter=7,
                        allowWidows=0, allowOrphans=0),
    "quote": ParagraphStyle("q", fontName="Cam-I", fontSize=10.6, leading=15,
                            textColor=NAVY, leftIndent=14, rightIndent=10,
                            spaceBefore=3, spaceAfter=9, allowWidows=0, allowOrphans=0),
    "bul": ParagraphStyle("bu", fontName="Cam", fontSize=10.8, leading=15.2,
                          textColor=INK, leftIndent=15, bulletIndent=3, spaceAfter=5,
                          allowWidows=0, allowOrphans=0),
    "bul2": ParagraphStyle("bu2", fontName="Cam", fontSize=10.5, leading=14.6,
                           textColor=INK, leftIndent=30, bulletIndent=18, spaceAfter=4,
                           allowWidows=0, allowOrphans=0),
    "code": ParagraphStyle("code", fontName="Courier", fontSize=8.9, leading=12.4,
                           textColor=INK, allowWidows=0, allowOrphans=0),
    "lead": ParagraphStyle("lead", fontName="Cam", fontSize=10.8, leading=15.2,
                           textColor=INK, spaceAfter=7, keepWithNext=1,
                           allowWidows=0, allowOrphans=0),
    "cell": ParagraphStyle("c", fontName="Cal", fontSize=9.4, leading=12.4, textColor=INK),
    "hd": ParagraphStyle("hd", fontName="Cal-B", fontSize=9.2, leading=12,
                         textColor=colors.white),
}


def inline(t):
    """The inline markdown these documents use, in the order it must be applied."""
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<i>\1</i>", t)
    t = re.sub(r"`(.+?)`", r'<font name="Courier" size="9.4">\1</font>', t)
    return t


def render(md):
    """Markdown to flowables. Tables are assembled row by row, everything else streams."""
    out, para, table = [], [], []

    # A short line that is entirely bold is a heading in everything but syntax. These
    # documents use it as one, and one of them ("What it is") was left stranded at the
    # foot of a page with its bullets overleaf.
    LEAD = re.compile(r"^\*\*[^*]+\*\*:?$")

    def flush_para():
        if para:
            text = " ".join(para)
            style = S["lead"] if LEAD.match(text.strip()) else S["p"]
            out.append(Paragraph(inline(text), style))
            para.clear()

    def flush_table():
        if not table:
            return
        head, *body = table
        # A separator row of dashes is markdown syntax, not content.
        body = [r for r in body if not all(set(c.strip()) <= set("-: ") for c in r)]
        data = [[Paragraph(inline(c), S["hd"]) for c in head]]
        data += [[Paragraph(inline(c), S["cell"]) for c in r] for r in body]
        width = 170 * mm
        cols = len(head)
        # First column carries the label and gets more room; the rest share what is left.
        widths = [width * 0.28] + [width * 0.72 / (cols - 1)] * (cols - 1) if cols > 1 else [width]
        t = Table(data, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
            ("LINEBELOW", (0, -1), (-1, -1), 0.7, NAVY),
        ]))
        out.append(t)
        out.append(Spacer(1, 9))
        table.clear()

    quote, item = [], [None]
    fence = [False, []]

    def flush_fence():
        """A fenced block, verbatim.

        Without this the renderer treated ``` as ordinary prose, so every command and
        every fill-in template collapsed into one wrapped paragraph with stray backticks
        in it. The commands in SETUP-AND-DEMO were unusable and nothing said so.

        Line breaks are preserved with <br/>, and the block is a one-cell table so it
        cannot split across a page in the middle of a command.
        """
        lines, fence[1] = fence[1], []
        while lines and not lines[0].strip():
            lines.pop(0)
        while lines and not lines[-1].strip():
            lines.pop()
        if not lines:
            return
        esc = [l.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
               .replace(" ", "&nbsp;") for l in lines]
        t = Table([[Paragraph("<br/>".join(esc), S["code"])]], colWidths=[170 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SOFT),
            ("LINEBEFORE", (0, 0), (0, -1), 2, NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING", (0, 0), (-1, -1), 9),
            ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ]))
        out.append(t)
        out.append(Spacer(1, 9))

    def flush_quote():
        if quote:
            out.append(Paragraph(inline(" ".join(quote)), S["quote"]))
            quote.clear()

    def flush_item():
        if item[0]:
            txt, bullet = item[0]
            out.append(Paragraph(inline(txt), S["bul"], bulletText=bullet))
            item[0] = None

    def flush_all():
        flush_item(); flush_quote(); flush_para()

    for raw in md.split("\n"):
        line = raw.rstrip()
        s = line.strip()

        # Fences are checked FIRST. A command containing a pipe would otherwise be read
        # as a table row, and an indented line as a bullet continuation.
        if s.startswith("```"):
            if fence[0]:
                flush_fence()
            else:
                flush_all(); flush_table()
            fence[0] = not fence[0]
            continue
        if fence[0]:
            fence[1].append(line)
            continue

        if s.startswith("|"):
            flush_all()
            table.append([c.strip() for c in s.strip("|").split("|")])
            continue
        flush_table()

        # A wrapped list item continues on an INDENTED line. Without this it fell out of
        # its own bullet and rendered as a separate unindented paragraph, which is what
        # broke every multi-line bullet in section 6.
        # An indented line beginning "- " is a NESTED bullet. This is checked BEFORE the
        # continuation rule and without requiring an open item, because flushing the
        # previous nested bullet clears that item and the next sibling would otherwise
        # fall through and render at top level.
        if line.startswith(("  ", "\t")) and s.startswith("- "):
            flush_all()
            out.append(Paragraph(inline(s[2:]), S["bul2"], bulletText="\u2013"))
            continue
        if line.startswith(("  ", "\t")) and item[0]:
            item[0] = (item[0][0] + " " + s, item[0][1])
            continue

        if not s:
            flush_all()
        elif s.startswith("# "):
            flush_all()
            out.append(Paragraph(inline(s[2:]), S["h1"]))
        elif s.startswith("### "):
            # Third-level headings existed in the source and rendered as literal "###".
            flush_all()
            out.append(Paragraph(inline(s[4:]), S["h3"]))
        elif s.startswith("## "):
            flush_all()
            out.append(Paragraph(inline(s[3:]), S["h2"]))
        elif s.startswith("---"):
            flush_all()
            out.append(Spacer(1, 4))
        elif s == ">":
            # A bare ">" is a blank line inside a quote. It ends the current quote
            # paragraph rather than printing a literal chevron.
            flush_quote()
        elif s.startswith("> "):
            flush_item(); flush_para()
            # Consecutive quote lines are ONE quotation, not one per line.
            quote.append(s[2:])
        elif s.startswith("- "):
            flush_all()
            item[0] = (s[2:], "\u2022")
        elif re.match(r"^\d+\.\s", s):
            flush_all()
            n, txt = s.split(".", 1)
            item[0] = (txt.strip(), f"{n}.")
        else:
            flush_item(); flush_quote()
            para.append(s)

    if fence[0]:
        flush_fence()   # an unclosed fence must still render, never vanish
    flush_all()
    flush_table()
    return out



def build(src):
    out_path = os.path.splitext(src)[0] + ".pdf"
    title = os.path.basename(src)

    def page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Cal", 7.6)
        canvas.setFillColor(LGREY)
        canvas.drawString(20 * mm, 12 * mm, "SIH26171  ·  for the team")
        canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, str(canvas.getPageNumber()))
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(20 * mm, 15.5 * mm, A4[0] - 20 * mm, 15.5 * mm)
        canvas.restoreState()

    doc = BaseDocTemplate(out_path, pagesize=A4, title=title,
                          leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=18 * mm, bottomMargin=20 * mm)
    doc.addPageTemplates([PageTemplate(
        id="p", frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height)],
        onPage=page)])
    doc.build(render(open(src, encoding="utf-8").read()))
    print(f"wrote {out_path}")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "outreach/TEAM-EXPLAINER.md")
