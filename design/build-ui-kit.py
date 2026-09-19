#!/usr/bin/env python3
"""
Build the Canva handoff kit for the Aavaran side panel.

Jinshri and Vansh design in Canva; this produces the file they import and the
contract that lets their output be read back into CSS without guessing. Every
number here is measured out of `extension/src/panel/index.html`, not invented —
if the panel changes, re-run this rather than editing the deck by hand.

    python3 design/build-ui-kit.py

Writes design/Aavaran-UI-Kit.pptx (import this into Canva) and copies the
current panel screenshots into design/reference/.
"""
from pathlib import Path
import shutil
import subprocess
import sys

from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "design"
REF = OUT / "reference"

# The page is the panel at 2x: 400 x 900 CSS px. Canva keeps these dimensions on
# import, and every measurement halves cleanly back into CSS.
PX = 9525                      # 1 css px at 96dpi, in EMU
W, H = 800, 1800               # page, in design px (= 2x)
INSET = 36                     # 2x of the panel's one horizontal inset (18)

VOID   = RGBColor(0x0A, 0x0A, 0x0A)
PIT    = RGBColor(0x05, 0x05, 0x05)
ROW    = RGBColor(0x14, 0x14, 0x14)
CARD   = RGBColor(0x16, 0x16, 0x16)
CARD2  = RGBColor(0x1C, 0x1C, 0x1C)
EDGE   = RGBColor(0x23, 0x23, 0x23)
EDGE2  = RGBColor(0x33, 0x33, 0x33)
INK    = RGBColor(0xFF, 0xFF, 0xFF)
ASH    = RGBColor(0x9B, 0x9B, 0x9B)
ASH2   = RGBColor(0x6A, 0x6A, 0x6A)
AMBER  = RGBColor(0xFF, 0xB2, 0x24)
MINT   = RGBColor(0x4A, 0xDE, 0x80)
CORAL  = RGBColor(0xFF, 0x6B, 0x6B)

UI = "Helvetica Neue"          # stand-in: Geist is not installed on this Mac
MONO = "Menlo"

prs = Presentation()
prs.slide_width, prs.slide_height = Emu(W * PX), Emu(H * PX)
BLANK = prs.slide_layouts[6]


def page(bg=VOID):
    s = prs.slides.add_slide(BLANK)
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Emu(W * PX), Emu(H * PX))
    r.fill.solid(); r.fill.fore_color.rgb = bg
    r.line.fill.background(); r.shadow.inherit = False
    return s


def text(s, x, y, w, h, runs, size=27, color=INK, bold=False, font=UI,
         align=PP_ALIGN.LEFT, spacing=1.45, anchor=MSO_ANCHOR.TOP):
    """runs: a string, or a list of paragraphs; a paragraph is a string or a
    list of (text, {overrides}) pieces."""
    tb = s.shapes.add_textbox(Emu(x * PX), Emu(y * PX), Emu(w * PX), Emu(h * PX))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    paras = runs if isinstance(runs, list) else [runs]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = spacing
        pieces = para if isinstance(para, list) else [(para, {})]
        for txt, o in pieces:
            r = p.add_run(); r.text = txt
            f = r.font
            f.name = o.get("font", font)
            f.size = Pt(o.get("size", size) * 0.75)   # design px -> pt at 96dpi
            f.bold = o.get("bold", bold)
            f.italic = o.get("italic", False)
            f.color.rgb = o.get("color", color)
    return tb


def rect(s, x, y, w, h, fill=None, line=None, radius=None, lw=2):
    shape = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    sh = s.shapes.add_shape(shape, Emu(x * PX), Emu(y * PX), Emu(w * PX), Emu(h * PX))
    if radius:
        sh.adjustments[0] = min(radius / min(w, h), 0.5)
    if fill:
        sh.fill.solid(); sh.fill.fore_color.rgb = fill
    else:
        sh.fill.background()
    if line:
        sh.line.color.rgb = line; sh.line.width = Emu(lw * PX)
    else:
        sh.line.fill.background()
    sh.shadow.inherit = False
    return sh


def heading(s, kicker, title, sub=None):
    """Returns the y the body should start at. A two-line title used to be laid
    out as if it were one and printed straight through the subtitle — the
    positions below are derived from the line count, never assumed."""
    text(s, INSET, 70, W - 2 * INSET, 40, kicker, size=24, color=AMBER, bold=True)
    lines = title.split("\n")
    text(s, INSET, 112, W - 2 * INSET, 70 * len(lines), lines, size=54,
         bold=True, spacing=1.1)
    y = 112 + 66 * len(lines) + 10
    if sub:
        wrapped = (len(sub) // 46) + 1
        text(s, INSET, y, W - 2 * INSET, 40 * wrapped, sub, size=26, color=ASH)
        y += 38 * wrapped + 22
    return y


def bullets(s, y, items, size=26, gap=14, color=INK, marker="—"):
    for it in items:
        text(s, INSET, y, 26, 40, marker, size=size, color=ASH2)
        pieces = it if isinstance(it, list) else [(it, {})]
        tb = text(s, INSET + 30, y, W - 2 * INSET - 30, 40, [pieces], size=size, color=color)
        # Mono runs are ~a quarter wider per character, so a line of tokens wraps
        # sooner than the character count suggests. Counting them as equal put
        # the next bullet through the tail of this one.
        width = sum(len(t) * (0.62 if o.get("font") == MONO else 0.5) for t, o in pieces)
        lines = max(1, int(width * size / (W - 2 * INSET - 30)) + 1)
        y += lines * int(size * 1.45) + gap
    return y


# ─────────────────────────────────────────────────────────────────────────────
# 1 — cover
# ─────────────────────────────────────────────────────────────────────────────
s = page()
text(s, INSET, 300, W - 2 * INSET, 120, "AAV██AN", size=96, bold=True, spacing=1.0)
text(s, INSET, 430, W - 2 * INSET, 200,
     [[("Side panel UI kit", {"bold": True, "size": 44})],
      [("For Jinshri and Vansh, designing in Canva.", {"color": ASH, "size": 28})]],
     size=44, spacing=1.35)
rect(s, INSET, 600, W - 2 * INSET, 2, fill=EDGE)
y = 650
y = bullets(s, y, [
    [("The page you are on is the panel at ", {}), ("2×", {"bold": True}),
     (". Everything here is double the real value.", {})],
    [("Design ", {}), ("one state per page", {"bold": True}),
     (". The state list starts on page 9.", {})],
    [("Use only the palette on page 4 and the type scale on page 5.", {})],
    [("Nothing may be narrower than the panel: it is ", {}),
     ("user-resizable", {"bold": True}), (", 320–500 CSS px.", {})],
])
y += 40
rect(s, INSET, y, W - 2 * INSET, 250, fill=CARD, radius=32)
text(s, INSET + 30, y + 30, W - 2 * INSET - 60, 200,
     [[("The one rule", {"bold": True, "size": 30, "color": AMBER})],
      [("This is a privacy tool. Every pixel either shows what was withheld, "
        "or proves nothing was sent. If an element does neither, delete it.", {})]],
     size=26, spacing=1.45)
text(s, INSET, H - 90, W - 2 * INSET, 40,
     "Aavaran · Team Vagabonds · SIH26171 · built from the shipped panel, "
     "not from memory", size=21, color=ASH2)

# ─────────────────────────────────────────────────────────────────────────────
# 2 — the rules
# ─────────────────────────────────────────────────────────────────────────────
s = page()
y = heading(s, "READ THIS FIRST", "Three things make a UI\nlook AI-generated",
            "All three were in our panel. They are banned now. This is the whole "
            "reason we are redesigning.")
y += 20
for n, (t, d) in enumerate([
    ("Tiny wide-tracked UPPERCASE labels",
     "9px letters with wide spacing, like TRY ONE OF THESE. MetaMask has zero of "
     "them. Sentence case, 24–27 px here, no extra tracking."),
    ("A bordered card around every list item",
     "A list is full-bleed rows — no border, no divider, separated by space and "
     "a hover wash. A border means a genuinely distinct object."),
    ("A permanent hero",
     "The logo gets one launch screen, then hands over to a 96 px sticky bar. "
     "Height belongs to content."),
], 1):
    rect(s, INSET, y, W - 2 * INSET, 190, fill=CARD, radius=22)
    text(s, INSET + 26, y + 26, 40, 40, str(n), size=34, bold=True, color=CORAL)
    text(s, INSET + 70, y + 26, W - 2 * INSET - 96, 140,
         [[(t, {"bold": True, "size": 28})], [(d, {"color": ASH, "size": 24})]],
         spacing=1.4)
    y += 210
y += 10
text(s, INSET, y, W - 2 * INSET, 40, "Also banned", size=28, bold=True)
y += 50
bullets(s, y, [
    "Emoji anywhere in the interface.",
    "Centred marketing microcopy. This is a tool, not a landing page.",
    "Decoration that imitates information — an empty circle where an icon "
    "would go, a card announcing that nothing has happened yet.",
    "Gradients, glows and stock imagery.",
    "A light theme. The panel is dark only.",
    "More than two accent colours on screen at once.",
], size=24)

# ─────────────────────────────────────────────────────────────────────────────
# 3 — canvas and grid
# ─────────────────────────────────────────────────────────────────────────────
s = page()
y = heading(s, "CANVAS", "Sizes, in Canva px",
            "Canva → Custom size → enter px. Or import this file and the "
            "pages are already right.")
rows = [
    ("A panel state", "800 × 1800", "the default — use this"),
    ("A very tall state", "800 × 3200", "run-complete, the ledger"),
    ("Narrow check", "640 × 1800", "must still work at 320 CSS"),
    ("Wide check", "1000 × 1800", "must still work at 500 CSS"),
    ("Extension icon", "1024 × 1024", "ships at 128/48/32/16"),
]
for label, size, note in rows:
    rect(s, INSET, y, W - 2 * INSET, 2, fill=EDGE)
    text(s, INSET, y + 18, 300, 40, label, size=26)
    text(s, INSET + 300, y + 18, 200, 40, size, size=26, font=MONO, color=AMBER)
    text(s, INSET, y + 54, W - 2 * INSET, 40, note, size=22, color=ASH2)
    y += 98
rect(s, INSET, y, W - 2 * INSET, 2, fill=EDGE)
y += 50

text(s, INSET, y, W - 2 * INSET, 40, "The only fixed measurements", size=28, bold=True)
y += 56
y = bullets(s, y, [
    [("Side inset ", {}), ("36 px", {"font": MONO, "color": AMBER}),
     (" left and right. Never change it.", {})],
    [("So the content column is ", {}), ("728 px", {"font": MONO, "color": AMBER}),
     (" wide.", {})],
    [("Top bar is ", {}), ("96 px", {"font": MONO, "color": AMBER}),
     (" tall and sticks to the top.", {})],
    [("A full-bleed row may touch the edges, but its ", {}),
     ("text", {"italic": True}), (" still starts at 36.", {})],
    [("Spacing comes from this set only: ", {}),
     ("12 16 20 24 28 32 36 44 52", {"font": MONO, "color": AMBER}), (".", {})],
    [("Corner radius: ", {}), ("22", {"font": MONO, "color": AMBER}),
     (" small, ", {}), ("32", {"font": MONO, "color": AMBER}),
     (" cards, fully round for pills.", {})],
    [("Every number you type must be ", {}), ("even", {"bold": True}),
     (" — it gets halved for the browser.", {})],
], size=24)

y += 16
rect(s, INSET, y, W - 2 * INSET, 200, fill=PIT, radius=22, line=EDGE)
rect(s, INSET, y, 36, 200, fill=RGBColor(0x2A, 0x1C, 0x05))
rect(s, W - INSET - 36, y, 36, 200, fill=RGBColor(0x2A, 0x1C, 0x05))
text(s, INSET + 36, y + 16, 728, 40, "36", size=20, color=AMBER, font=MONO)
text(s, INSET + 36, y + 82, 728, 60, "content column — 728 px",
     size=26, color=ASH, align=PP_ALIGN.CENTER)
text(s, INSET, y + 216, W - 2 * INSET, 70,
     "The amber strips are the inset. Nothing but a full-bleed background "
     "enters them.", size=22, color=ASH2)

# ─────────────────────────────────────────────────────────────────────────────
# 4 — palette
# ─────────────────────────────────────────────────────────────────────────────
s = page()
y = heading(s, "COLOUR", "The whole palette",
            "There are no other colours. If you need one, write it down in "
            "NOTES.txt with what it means.")
swatches = [
    ("--void",   VOID,  "#0a0a0a", "the panel itself"),
    ("--pit",    PIT,   "#050505", "recessed: inputs, code blocks"),
    ("--row",    ROW,   "#141414", "row hover wash"),
    ("--card",   CARD,  "#161616", "a real object"),
    ("--card-2", CARD2, "#1c1c1c", "an object on a card"),
    ("--edge",   EDGE,  "#232323", "hairline"),
    ("--edge-2", EDGE2, "#333333", "a border meant to be seen"),
    ("--ink",    INK,   "#ffffff", "primary text, primary button"),
    ("--ash",    ASH,   "#9b9b9b", "secondary text — neutral, never blue"),
    ("--ash-2",  ASH2,  "#6a6a6a", "tertiary text"),
]
for name, rgb, hexs, use in swatches:
    rect(s, INSET, y, 72, 72, fill=rgb, radius=18, line=EDGE2)
    text(s, INSET + 92, y + 4, 220, 40, name, size=26, font=MONO, bold=True)
    text(s, INSET + 92, y + 40, 220, 30, hexs, size=22, font=MONO, color=ASH2)
    text(s, INSET + 330, y + 20, W - INSET - 330 - INSET, 40, use, size=23, color=ASH)
    y += 92

y += 20
text(s, INSET, y, W - 2 * INSET, 40, "The three accents carry meaning", size=28, bold=True)
y += 56
for name, rgb, hexs, meaning in [
    ("--amber", AMBER, "#ffb224", "something was WITHHELD. The product's output."),
    ("--mint",  MINT,  "#4ade80", "the proof held. Nothing left the machine."),
    ("--coral", CORAL, "#ff6b6b", "it failed."),
]:
    rect(s, INSET, y, 72, 72, fill=rgb, radius=18)
    text(s, INSET + 92, y + 4, 220, 40, name, size=26, font=MONO, bold=True, color=rgb)
    text(s, INSET + 92, y + 40, 220, 30, hexs, size=22, font=MONO, color=ASH2)
    text(s, INSET + 330, y + 12, W - INSET - 330 - INSET, 60, meaning, size=23, color=ASH)
    y += 92
y += 16
rect(s, INSET, y, W - 2 * INSET, 150, fill=RGBColor(0x2A, 0x1C, 0x05), radius=22)
text(s, INSET + 26, y + 26, W - 2 * INSET - 52, 110,
     [[("Never spend an accent on a control.", {"bold": True, "color": AMBER})],
      [("We made this mistake twice — a green button, then an amber one. Amber "
        "must keep meaning withheld. The primary button is white.", {"color": ASH})]],
     size=24, spacing=1.4)

# ─────────────────────────────────────────────────────────────────────────────
# 5 — type
# ─────────────────────────────────────────────────────────────────────────────
s = page()
y = heading(s, "TYPE", "The scale",
            "Left column is what you type in Canva. Right is what ships. "
            "Nothing below 22.")
specimens = [
    ("Aavaran", 80, True, UI, "80 / 40", "wordmark — Archivo Black only"),
    ("4 withheld", 64, True, UI, "64 / 32", "hero figure"),
    ("A section title", 42, True, UI, "42 / 21", "rare — result headings"),
    ("Aavaran", 28, True, UI, "28 / 14", "top bar name"),
    ("Body copy, the default", 27, False, UI, "27 / 13.5", "everything unmarked"),
    ("A list row", 26, False, UI, "26 / 13", "full-bleed rows"),
    ("Secondary line", 25, False, UI, "25 / 12.5", "supporting text"),
    ("Meta and counts", 24, False, UI, "24 / 12", "captions"),
    ("ready", 23, False, UI, "23 / 11.5", "status lamp"),
    ("<PII_PAN_1>", 24, False, MONO, "24 / 12", "tokens — Geist Mono"),
]
for txt, size, bold, font, label, use in specimens:
    text(s, INSET, y, 430, size + 30, txt, size=size, bold=bold, font=font, spacing=1.1)
    text(s, INSET + 450, y + 6, 120, 40, label, size=22, font=MONO, color=AMBER)
    text(s, INSET + 450, y + 36, 280, 40, use, size=20, color=ASH2)
    y += max(size + 34, 78)

y += 10
rect(s, INSET, y, W - 2 * INSET, 2, fill=EDGE)
y += 40
text(s, INSET, y, W - 2 * INSET, 40, "Fonts in Canva", size=28, bold=True)
y += 56
y = bullets(s, y, [
    [("We ship ", {}), ("Geist", {"bold": True}), (" (UI), ", {}),
     ("Geist Mono", {"bold": True}), (" (tokens) and ", {}),
     ("Archivo Black", {"bold": True}), (" (the wordmark only).", {})],
    [("Canva does not have Geist. Use ", {}), ("Inter", {"bold": True}),
     (" as a stand-in for both, and ", {}), ("Roboto Mono", {"bold": True}),
     (" for the token font.", {})],
    [("Archivo Black ", {"bold": True}), ("is", {"italic": True}),
     (" in Canva — use the real thing for the wordmark.", {})],
    "Layout transfers; letterforms do not. Do not judge the typeface from Canva.",
    "Tracking: leave it at 0. Only the wordmark is tightened, and we do that in code.",
], size=24)

# ─────────────────────────────────────────────────────────────────────────────
# 6 — components
# ─────────────────────────────────────────────────────────────────────────────
s = page()
y = heading(s, "COMPONENTS", "Copy these, don't\nreinvent them",
            "Real shapes at real size. Duplicate them onto your page.")

text(s, INSET, y, W - 2 * INSET, 30, "Primary button — white, one per screen",
     size=22, color=ASH2); y += 40
b = rect(s, INSET, y, 728, 96, fill=INK, radius=48)
text(s, INSET, y + 30, 728, 40, "Run on this tab", size=30, bold=True,
     color=RGBColor(0, 0, 0), align=PP_ALIGN.CENTER)
y += 130

text(s, INSET, y, W - 2 * INSET, 30, "Secondary — outline, same pill",
     size=22, color=ASH2); y += 40
rect(s, INSET, y, 728, 96, line=EDGE2, radius=48)
text(s, INSET, y + 30, 728, 40, "Scan this page", size=30, color=ASH,
     align=PP_ALIGN.CENTER)
y += 130

text(s, INSET, y, W - 2 * INSET, 30, "Input — recessed pill", size=22, color=ASH2)
y += 40
rect(s, INSET, y, 728, 96, fill=PIT, line=EDGE, radius=48)
text(s, INSET + 40, y + 30, 640, 40, "e.g. Fill in the form and submit it",
     size=28, color=ASH2)
y += 130

text(s, INSET, y, W - 2 * INSET, 30,
     "Full-bleed row — no border, no divider, hover wash only", size=22, color=ASH2)
y += 40
rect(s, 0, y, W, 96, fill=ROW)
text(s, INSET, y + 28, 600, 40, "Fill in this form and submit it", size=26)
text(s, W - INSET - 30, y + 28, 30, 40, "›", size=30, color=ASH2)
rect(s, 0, y + 96, W, 20, fill=VOID)
rect(s, 0, y + 116, W, 96, fill=VOID)
text(s, INSET, y + 144, 600, 40, "Find the contact details on this page", size=26)
text(s, W - INSET - 30, y + 144, 30, 40, "›", size=30, color=ASH2)
y += 250

text(s, INSET, y, W - 2 * INSET, 30, "Withheld tag — amber, always with a count",
     size=22, color=ASH2); y += 40
x = INSET
for label in ["1 PAN", "2 NAME", "1 PHONE"]:
    w = 60 + len(label) * 18
    rect(s, x, y, w, 64, fill=RGBColor(0x2A, 0x1C, 0x05), radius=32)
    text(s, x, y + 18, w, 40, label, size=24, color=AMBER, bold=True,
         align=PP_ALIGN.CENTER, font=MONO)
    x += w + 16
y += 100

text(s, INSET, y, W - 2 * INSET, 30, "Proof line — mint tick, claim in white",
     size=22, color=ASH2); y += 40
text(s, INSET, y, 40, 40, "✓", size=30, color=MINT, bold=True)
text(s, INSET + 46, y, 660, 80,
     [[("Nothing left this machine. ", {"bold": True}),
       ("DevTools → Network, press Scan again: no request appears.",
        {"color": ASH})]], size=25, spacing=1.4)

# ─────────────────────────────────────────────────────────────────────────────
# 7 — icon
# ─────────────────────────────────────────────────────────────────────────────
s = page()
y = heading(s, "ICON", "The extension icon",
            "One 1024 × 1024 artboard. Chrome renders it at 16 px in the toolbar, "
            "so it must survive being tiny.")
rect(s, INSET, y, 728, 728, fill=PIT, radius=32, line=EDGE)
rect(s, INSET + 91, y + 91, 546, 546, line=EDGE2, radius=32)
text(s, INSET, y + 330, 728, 60, "safe area — keep the mark inside",
     size=24, color=ASH2, align=PP_ALIGN.CENTER)
y += 780
y = bullets(s, y, [
    "One shape. At 16 px anything else is mud.",
    "It must read on both a light and a dark browser toolbar.",
    "No text, no letters smaller than half the canvas.",
    [("Deliver the ", {}), ("1024 px PNG", {"bold": True}),
     (" with a transparent background; the four sizes get generated.", {})],
    [("Current icon is in ", {}), ("extension/icons/", {"font": MONO, "color": AMBER}),
     (" — a shield with a redaction bar across it.", {})],
], size=24)

# ─────────────────────────────────────────────────────────────────────────────
# 8 — the handback contract
# ─────────────────────────────────────────────────────────────────────────────
s = page()
y = heading(s, "SENDING IT BACK", "How to hand it over",
            "This part is what lets the design get built without a round of "
            "guessing. Please follow it exactly.")
y = bullets(s, y, [
    [("Name each Canva page ", {}), ("exactly", {"bold": True}),
     (" the state name from the pages that follow, e.g. ", {}),
     ("3-scan-result", {"font": MONO, "color": AMBER}), (".", {})],
    [("Name each element with its code hook: ", {}),
     ("#run, #scan, #goal, .topbar, .entry, .tag", {"font": MONO, "color": AMBER}),
     (". The list is on every state page.", {})],
    [("Export ", {}), ("PNG, 1:1, no scaling", {"bold": True}),
     (". Filename = page name.", {})],
    "Also download the whole thing as one PDF — that is the version to share.",
    [("Share the Canva ", {}), ("edit link", {"bold": True}),
     (" too, so exact x/y/size can be read off the position panel.", {})],
], size=24)

y += 20
rect(s, INSET, y, W - 2 * INSET, 2, fill=EDGE); y += 40
text(s, INSET, y, W - 2 * INSET, 40, "And a NOTES.txt with", size=28, bold=True)
y += 56
y = bullets(s, y, [
    "One short paragraph per state: what changed and why.",
    "Any colour that is not in the palette — hex, and what it means.",
    "Any size that is not on the scale.",
    "Anything you wanted to do and could not do in Canva.",
], size=24)

y += 20
rect(s, INSET, y, W - 2 * INSET, 2, fill=EDGE); y += 40
text(s, INSET, y, W - 2 * INSET, 40, "Please do not change", size=28, bold=True,
     color=CORAL)
y += 56
y = bullets(s, y, [
    [("The wording.", {"bold": True}),
     (" Lines like “would be withheld” and “nothing was transmitted” "
      "are precise claims. Flag a bad one; don't rewrite it.", {})],
    [("The state list.", {"bold": True}),
     (" Every state exists because the panel reaches it.", {})],
    [("Motion.", {"bold": True}),
     (" Describe it in words; the springs are physics in code.", {})],
    [("Token names.", {"bold": True}), (" Use them; don't rename them.", {})],
], size=24, gap=18)

y += 10
rect(s, INSET, y, W - 2 * INSET, 200, fill=CARD, radius=32)
text(s, INSET + 26, y + 26, W - 2 * INSET - 52, 160,
     [[("Before you send", {"bold": True, "size": 28})],
      [("Shrink the page to 640 wide in your head: does anything break? "
        "Squint at it: is there more than two accent colours? Read every "
        "label: is any of it shouting in uppercase?", {"color": ASH})]],
     size=24, spacing=1.45)

# ─────────────────────────────────────────────────────────────────────────────
# 9+ — the states, from the real panel
# ─────────────────────────────────────────────────────────────────────────────
STATES = [
    ("0-launch-screen", "The launch screen", "Shows once, then fades at 1.05 s.",
     "#splash .mark"),
    ("1-idle-server-ready", "Idle, ready to run",
     "The first screen anyone sees. The most important page here.",
     "#goal #run #scan #target #settings"),
    ("2-server-offline", "Server offline",
     "Run and Scan swap roles — the working action becomes the white one.",
     "#lamp #serveradvice #scan"),
    ("3-scan-result", "Scan result",
     "The path a sceptic presses. Withheld values, the tags, the proof.",
     ".entry .fields .tag .proof"),
    ("4-run-complete", "Run complete",
     "Long page — answer, totals, then the turn-by-turn ledger.",
     ".answer .totals #ledger .turn"),
    ("5-settings-open", "Settings open", "A disclosure, not a screen.",
     "#settings #serverstatus #testsrv"),
    ("6-scan-ambiguous-field", "Ambiguous field",
     "A value we withheld but will not name a kind for.",
     ".tag .entry"),
    ("7-server-unreachable-repo", "Server unreachable",
     "Prints the exact commands, with copy buttons.",
     "#serveradvice .cmd"),
    ("8-scan-only-package", "Scan-only package",
     "What everyone who gets the zip sees. Run is off, Scan is promoted.",
     "#run #scan #serveradvice"),
    ("9-model-not-installed", "Model missing",
     "Offers the 6 GB download as a button.",
     "#serveradvice .install"),
    ("10-page-unreadable", "Page could not be read",
     "The most important honesty in the product: we refuse to say it is clean.",
     "#empty .note"),
    ("11-model-downloading", "Downloading the model",
     "Progress bar. Stalls are detected by bytes, never a deadline.",
     ".progress"),
    ("12-scan-only-but-server-up", "Scan-only, server up",
     "The package says scan-only but a server answers.",
     "#run #scan"),
]

for name, title, why, hooks in STATES:
    s = page()
    text(s, INSET, 40, W - 2 * INSET, 40, name, size=24, font=MONO, color=AMBER, bold=True)
    text(s, INSET, 80, W - 2 * INSET, 50, title, size=38, bold=True)
    text(s, INSET, 132, W - 2 * INSET, 60, why, size=24, color=ASH)
    text(s, INSET, 196, W - 2 * INSET, 40, hooks, size=21, font=MONO, color=ASH2)
    img = REF / f"{name}.png"
    if img.exists():
        from PIL import Image
        iw, ih = Image.open(img).size
        top, avail = 250, H - 250 - 40
        w_px, h_px = W, int(ih * W / iw)
        if h_px > avail:
            h_px, w_px = avail, int(iw * avail / ih)
        s.shapes.add_picture(str(img), Emu(int((W - w_px) / 2) * PX), Emu(top * PX),
                             Emu(w_px * PX), Emu(h_px * PX))
        if w_px < W:
            text(s, INSET, H - 34, W - 2 * INSET, 30,
                 f"shown at {round(100 * w_px / W)}% — full size in design/reference/",
                 size=19, color=ASH2, align=PP_ALIGN.CENTER)

# ─────────────────────────────────────────────────────────────────────────────
# blank canvases
# ─────────────────────────────────────────────────────────────────────────────
for i in range(3):
    s = page()
    rect(s, 0, 0, INSET, H, fill=RGBColor(0x12, 0x0D, 0x04))
    rect(s, W - INSET, 0, INSET, H, fill=RGBColor(0x12, 0x0D, 0x04))
    rect(s, 0, 96, W, 2, fill=EDGE2)
    text(s, INSET, 34, 400, 40, "top bar ends at 96", size=20, color=ASH2, font=MONO)
    text(s, INSET, H - 60, W - 2 * INSET, 40,
         "blank canvas — 800 × 1800, inset 36", size=20, color=ASH2,
         font=MONO, align=PP_ALIGN.CENTER)

OUT.mkdir(exist_ok=True)
path = OUT / "Aavaran-UI-Kit.pptx"
prs.save(str(path))
print(f"wrote {path}  ({len(prs.slides.__iter__.__self__._sldIdLst)} pages)")
