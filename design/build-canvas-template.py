#!/usr/bin/env python3
"""
The blank Canva canvas for the side panel redesign.

Deliberately empty. Jinshri and Vansh are changing the colour scheme, the mood
and everything else, so this file carries no palette, no type scale and no
opinion — only the one thing they cannot get wrong by eye, which is the size.

A page is the panel at 2x: 800 x 1800 px = the real 400 x 900 CSS px. Working at
2x means their numbers halve cleanly into CSS, so the build reads measurements
off the design instead of guessing them.

    python3 design/build-canvas-template.py
"""
from pathlib import Path

from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn

OUT = Path(__file__).resolve().parent
PX = 9525                      # one px at 96dpi, in EMU
W, H = 800, 1800               # the panel at 2x
INSET = 36                     # the inset the panel uses today — a hint, not a rule
TOPBAR = 96

PAPER = RGBColor(0xFF, 0xFF, 0xFF)
GUIDE = RGBColor(0xD9, 0xD9, 0xD9)
LABEL = RGBColor(0xA6, 0xA6, 0xA6)
TEXT = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x6E, 0x6E, 0x6E)
UI = "Helvetica Neue"
MONO = "Menlo"

# Kept to one short line each: the second column is 328 px wide at 19 px, which
# wraps at about 34 characters, and a wrap here ran into the row beneath it.
STATES = [
    ("0-launch-screen", "before the panel appears"),
    ("1-idle-server-ready", "the first screen anyone sees"),
    ("2-server-offline", "agent can't run; scan still can"),
    ("3-scan-result", "the screen that proves it"),
    ("4-run-complete", "result, then the full record"),
    ("5-settings-open", "server address and controls"),
    ("6-scan-ambiguous-field", "hidden, kind not named"),
    ("7-server-unreachable-repo", "how to start the server"),
    ("8-scan-only-package", "what the emailed zip shows"),
    ("9-model-not-installed", "offers a 6 GB download"),
    ("10-page-unreadable", "we refuse to call it clean"),
    ("11-model-downloading", "a progress bar"),
    ("12-scan-only-but-server-up", "scan-only, server answered"),
]

prs = Presentation()
prs.slide_width, prs.slide_height = Emu(W * PX), Emu(H * PX)
BLANK = prs.slide_layouts[6]


def page():
    s = prs.slides.add_slide(BLANK)
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Emu(W * PX), Emu(H * PX))
    r.fill.solid(); r.fill.fore_color.rgb = PAPER
    r.line.fill.background(); r.shadow.inherit = False
    return s


def text(s, x, y, w, h, runs, size=26, color=TEXT, bold=False, font=UI,
         align=PP_ALIGN.LEFT, spacing=1.45):
    tb = s.shapes.add_textbox(Emu(x * PX), Emu(y * PX), Emu(w * PX), Emu(h * PX))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    for i, para in enumerate(runs if isinstance(runs, list) else [runs]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment, p.line_spacing = align, spacing
        for txt, o in (para if isinstance(para, list) else [(para, {})]):
            r = p.add_run(); r.text = txt
            f = r.font
            f.name = o.get("font", font)
            f.size = Pt(o.get("size", size) * 0.75)
            f.bold = o.get("bold", bold)
            f.color.rgb = o.get("color", color)
    return tb


def dashed(s, x, y, w, h):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Emu(x * PX), Emu(y * PX),
                            Emu(w * PX), Emu(h * PX))
    sh.fill.solid(); sh.fill.fore_color.rgb = GUIDE
    sh.line.fill.background(); sh.shadow.inherit = False
    # a hairline reads as a rule; a dash pattern reads as a guide to be deleted
    ln = sh.line._get_or_add_ln()
    d = ln.makeelement(qn('a:prstDash'), {'val': 'dash'})
    ln.append(d)
    return sh


# ── page 1 — the only instructions there are ────────────────────────────────
s = page()
text(s, INSET, 120, W - 2 * INSET, 60, "Aavaran — side panel", size=46, bold=True)
text(s, INSET, 180, W - 2 * INSET, 60,
     "Blank canvas. Design whatever you like on it.", size=28, color=MUTED)

y = 300
for label, value, note in [
    ("Page size", "800 × 1800 px", "already set on every page here"),
    ("Why that size", "the panel at 2×", "it is really 400 × 900, so halve everything"),
    ("One rule", "use even numbers", "odd numbers land on half a pixel in the browser"),
]:
    text(s, INSET, y, 220, 40, label, size=24, color=MUTED)
    text(s, INSET + 230, y, W - INSET - 230 - INSET, 40, value, size=28, bold=True)
    text(s, INSET + 230, y + 38, W - INSET - 230 - INSET, 40, note, size=22, color=MUTED)
    y += 110

y += 10
text(s, INSET, y, W - 2 * INSET, 150,
     "The grey dashed lines are guides, not constraints. They show where the "
     "current design puts its margins. Move them, ignore them or delete them — "
     "colour, type, spacing and mood are all yours.", size=25, color=MUTED)
y += 172
text(s, INSET, y, W - 2 * INSET, 90,
     "One screen per page. If a screen is longer than the page, carry on to a new "
     "page and put -cont after the name.", size=25, color=MUTED)
y += 110

text(s, INSET, y, W - 2 * INSET, 40, "The 13 screens, each on its own page", size=28, bold=True)
y += 60
for name, what in STATES:
    text(s, INSET, y, 380, 34, name, size=22, font=MONO, color=TEXT)
    text(s, INSET + 396, y + 2, W - INSET - 396 - INSET, 34, what, size=19, color=MUTED)
    y += 44

y += 40
text(s, INSET, y, W - 2 * INSET, 120,
     "Sending it back: PNG of each page at 1:1, no scaling, filename = page name. "
     "Keep the page names as they are — that is how each design gets matched to "
     "the screen it belongs to.", size=24, color=MUTED)

text(s, INSET, H - 80, W - 2 * INSET, 40,
     "If the import misbehaves, Canva → Custom size → 800 × 1800 px does the same job.",
     size=21, color=LABEL)

# ── one blank page per screen ───────────────────────────────────────────────
for name, what in STATES:
    s = page()
    dashed(s, INSET, 0, 1, H)
    dashed(s, W - INSET, 0, 1, H)
    dashed(s, 0, TOPBAR, W, 1)
    text(s, INSET + 10, 16, 400, 30, f"{INSET} px", size=18, font=MONO, color=LABEL)
    text(s, INSET + 10, TOPBAR + 10, 400, 30, f"top bar ends at {TOPBAR}",
         size=18, font=MONO, color=LABEL)
    text(s, INSET, H - 96, W - 2 * INSET, 34, name, size=22, font=MONO, color=LABEL)
    text(s, INSET, H - 62, W - 2 * INSET, 34, what, size=20, color=LABEL)
    text(s, W - INSET - 200, H - 96, 200, 34, "800 × 1800", size=18, font=MONO,
         color=LABEL, align=PP_ALIGN.RIGHT)

# ── two spares ──────────────────────────────────────────────────────────────
for i in (1, 2):
    s = page()
    dashed(s, INSET, 0, 1, H)
    dashed(s, W - INSET, 0, 1, H)
    text(s, INSET, H - 96, W - 2 * INSET, 34, f"spare-{i}", size=22, font=MONO, color=LABEL)

path = OUT / "Aavaran-Canva-Template.pptx"
prs.save(str(path))
print(f"wrote {path}  ({len(STATES) + 3} pages, {W}x{H} px)")
