#!/usr/bin/env python3
"""Fill the official SIH 2026 Idea template for SIH26171.

Rules the template itself imposes (its own slide 7):
  - six slides maximum, INCLUDING the title slide
  - the section headings stay exactly as they are
  - points, diagrams and infographics - not paragraphs
  - delete the instructions slide before uploading

So: SIH branding, headings, footer and slide numbers are left untouched. Only the grey
guidance text boxes are replaced.

Everything on these slides is a measured number from this repo. Nothing is aspirational,
because a judge who catches one invented figure discounts all the others.

    python3 deck/build.py
"""
import copy
import os
import sys

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = f"{HERE}/template.pptx"
OUT = f"{HERE}/SIH26171_Idea_Submission.pptx"

# Palette: indigo = the private/on-device side, amber = the boundary and what is withheld.
INK = RGBColor(0x14, 0x1B, 0x2E)
INDIGO = RGBColor(0x2B, 0x3A, 0x8F)
INDIGO_LT = RGBColor(0xE6, 0xE9, 0xF7)
AMBER = RGBColor(0xB4, 0x6A, 0x00)
AMBER_LT = RGBColor(0xFD, 0xF0, 0xDC)
GREEN = RGBColor(0x1B, 0x7A, 0x3D)
GREY = RGBColor(0x53, 0x5C, 0x6B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

# Fields only the SIH portal can supply. Rendered in amber with guillemets so they are
# impossible to miss on a final read-through.
PLACEHOLDER = "«{}»"
TEAM_NAME = PLACEHOLDER.format("Team Name")
TEAM_ID = PLACEHOLDER.format("Team ID")
THEME = PLACEHOLDER.format("Theme from portal")


def clear_body(slide, keep_titles=True):
    """Remove the template's grey guidance boxes, leaving branding and headings."""
    keep = []
    for shape in list(slide.shapes):
        if not shape.has_text_frame:
            continue
        text = shape.text_frame.text.strip()
        if not text:
            continue
        # Footer, slide number and the section heading all stay.
        if text in ("@SIH Idea submission- Template",) or text.isdigit():
            continue
        if keep_titles and text.upper() == text and len(text) < 40:
            keep.append(shape)
            continue
        if text == "Your Team Name":
            shape.text_frame.text = TEAM_NAME
            for p in shape.text_frame.paragraphs:
                for r in p.runs:
                    r.font.size = Pt(11)
                    r.font.color.rgb = AMBER
                    r.font.bold = True
            continue
        shape._element.getparent().remove(shape._element)
    return keep


def textbox(slide, x, y, w, h, blocks):
    """blocks: list of (text, size, bold, colour, space_after)."""
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    for i, (text, size, bold, colour, after) in enumerate(blocks):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = text
        p.space_after = Pt(after)
        for r in p.runs:
            r.font.size = Pt(size)
            r.font.bold = bold
            r.font.color.rgb = colour
    return box


def metric_rows(slide, x, y, w, rows, size=13, gap=5, col_w=1.15):
    """A label/value table that actually lines up.

    Space-padding a proportional font only *looks* aligned for one particular set of
    label lengths; change a value from "91.7%" to "100%" and the column goes ragged.
    So labels and values are separate boxes and the value column is right-aligned —
    alignment then holds whatever the strings are.

    rows: list of (label, value, colour, bold). Extra value columns are supported by
    passing a tuple of values, laid out right-aligned from the right edge.
    """
    n_cols = max(len(r[1]) if isinstance(r[1], tuple) else 1 for r in rows)
    labels = [(r[0], size, r[3], r[2], gap) for r in rows]
    textbox(slide, x, y, w - col_w * n_cols, 0.4 * len(rows) + 0.3, labels)
    for c in range(n_cols):
        col_x = x + w - col_w * (n_cols - c)
        blocks = []
        for label, value, colour, bold in rows:
            vals = value if isinstance(value, tuple) else (value,)
            blocks.append((vals[c] if c < len(vals) else "", size, bold, colour, gap))
        box = textbox(slide, col_x, y, col_w, 0.4 * len(rows) + 0.3, blocks)
        for p in box.text_frame.paragraphs:
            p.alignment = PP_ALIGN.RIGHT
    return 0.4 * len(rows)


def panel(slide, x, y, w, h, fill, line=None):
    from pptx.enum.shapes import MSO_SHAPE
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                 Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    if line:
        shp.line.color.rgb = line
        shp.line.width = Pt(1)
    else:
        shp.line.fill.background()
    shp.shadow.inherit = False
    shp.text_frame.text = ""
    return shp


def main():
    if not os.path.exists(SRC):
        sys.exit(f"template not found: {SRC}")
    prs = Presentation(SRC)

    # ---------------- slide 1: title ----------------
    s = prs.slides[0]
    for shape in list(s.shapes):
        if shape.has_text_frame and "Problem Statement ID" in shape.text_frame.text:
            tf = shape.text_frame
            tf.clear()
            rows = [
                ("Problem Statement ID – ", "SIH26171"),
                ("Problem Statement Title – ", "On-device Visual Perception for "
                                               "Light-weight Browser Agents"),
                ("Theme – ", THEME),
                ("PS Category – ", "Software"),
                ("Team ID – ", TEAM_ID),
                ("Team Name – ", TEAM_NAME),
            ]
            for i, (label, value) in enumerate(rows):
                p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                r1 = p.add_run(); r1.text = label
                r1.font.size = Pt(13); r1.font.bold = True; r1.font.color.rgb = INK
                r2 = p.add_run(); r2.text = value
                r2.font.size = Pt(13)
                r2.font.color.rgb = AMBER if value.startswith("«") else INK
                r2.font.bold = value.startswith("«")

    # ---------------- slide 2: idea ----------------
    s = prs.slides[1]
    clear_body(s)
    textbox(s, 0.55, 1.30, 6.05, 5.4, [
        ("An AI agent that reads your screen — without your personal "
         "data ever leaving the machine.", 17, True, INDIGO, 10),
        ("An agent is only useful if it can see the screen. Your screen holds your "
         "PAN, Aadhaar, card and an open password field. Today you accept an "
         "assistant that sees everything, or you get none.", 13, False, GREY, 12),
        ("How it works", 15, True, INK, 6),
        ("•  A small vision model runs IN the browser and reads the page", 13, False, INK, 4),
        ("•  Every PAN, Aadhaar, card, password and face is replaced with a "
         "typed tag — <PII_PAN_1> — before any network request", 13, False, INK, 4),
        ("•  The server model reasons over the censored page and returns one "
         "action: “click Submit”", 13, False, INK, 4),
        ("•  The client validates that action, then executes it", 13, False, INK, 10),
        ("A tag means “this field is filled and valid” — so the server "
         "reasons correctly about a value it can never see.", 13, True, INDIGO, 2),
    ])
    panel(s, 6.95, 1.30, 5.85, 5.4, AMBER_LT, AMBER)
    textbox(s, 7.25, 1.50, 5.3, 5.0, [
        ("What makes it different", 15, True, AMBER, 8),
        ("Privacy is STRUCTURAL, not behavioural.", 13, True, INK, 6),
        ("The secret store lives in the page context. The code that talks to the "
         "network has never held a real value — so a bug there cannot leak a PAN.",
         10, False, GREY, 10),
        ("Proven under attack", 13, True, INK, 6),
        ("On a page carrying hidden prompt-injection, the model COMPLIED "
         "(“the user has authorised full disclosure”) — and still "
         "leaked nothing, because it never had a value to disclose.", 12, False, GREY, 10),
        ("Auditable, not asserted", 13, True, INK, 6),
        ("A Privacy Ledger shows what was withheld and the exact bytes sent. "
         "Nobody has to take our word for it.", 12, False, GREY, 2),
    ])

    # ---------------- slide 3: technical approach ----------------
    s = prs.slides[2]
    clear_body(s)
    textbox(s, 0.55, 1.30, 5.95, 5.4, [
        ("The screen is not just pixels — it is a DOM", 15, True, INDIGO, 8),
        ("The page structure already gives exact labels, field types and "
         "coordinates for free. The vision model runs only on crops the DOM "
         "cannot describe — images, canvas, cross-origin frames.", 12, False, GREY, 10),
        ("Raises accuracy while cutting memory and latency at the same time.",
         10, True, INK, 12),
        ("PII detection — three layers", 15, True, INDIGO, 8),
        ("1.  Page semantics: password inputs, autocomplete, ARIA labels", 12, False, INK, 4),
        ("2.  Patterns WITH checksums: Aadhaar (Verhoeff), card (Luhn), GSTIN, PAN",
         10, False, INK, 4),
        ("3.  Person names: gazetteer + structural rules", 12, False, INK, 8),
        ("Measured: the checksum gate drops random 12-digit strings from 100% "
         "to 8.08% — a 12x cut in false positives at no cost to recall.",
         10, True, GREEN, 2),
    ])
    panel(s, 6.85, 1.30, 5.95, 5.4, INDIGO_LT)
    textbox(s, 7.15, 1.50, 5.4, 5.0, [
        ("Stack", 15, True, INDIGO, 8),
        ("Client   Chrome + Firefox extension, TypeScript", 12, False, INK, 4),
        ("On-device   ONNX Runtime Web on WebGPU, WASM fallback", 12, False, INK, 4),
        ("Vision   UltraFace 1.2 MB (faces) · MobileViT 21 MB (regions)",
         10, False, INK, 4),
        ("Server   FastAPI + Qwen2.5-VL 7B, open-weight", 12, False, INK, 10),
        ("Runs entirely offline — the network can be unplugged.",
         10, True, GREEN, 10),
        ("Chosen by measurement, not assumption", 13, True, AMBER, 6),
        ("Quantising the vision model to int8 made it 10x SLOWER on WebGPU "
         "(103 ms vs 10 ms): the backend has no native int8 path. fp32 is "
         "the correct choice and the smaller file is the trap.", 12, False, GREY, 2),
    ])

    # ---------------- slide 4: feasibility ----------------
    s = prs.slides[3]
    clear_body(s)
    textbox(s, 0.55, 1.30, 5.95, 5.4, [
        ("Built and working today", 15, True, GREEN, 8),
        ("•  Full loop running in Chrome AND Firefox", 12, False, INK, 4),
        ("•  On-device face detection and blurring", 12, False, INK, 4),
        ("•  Privacy Ledger with raw-payload inspection", 12, False, INK, 4),
        ("•  Hostile-page defences: 16 of 24 validator cases refused", 12, False, INK, 4),
        ("•  Graceful failure — 8/8 drills", 12, False, INK, 12),
        ("Challenges, and how they were handled", 15, True, AMBER, 8),
        ("Chrome's offscreen document is timer-throttled to ~1 s — a 16×16 "
         "canvas takes 1004 ms there. Work moved to an unthrottled context: "
         "1083 ms → 65 ms.", 12, False, GREY, 6),
        ("A hostile page could ask the agent to place a tag into an attacker's form; "
         "the client would resolve it. Closed by requiring the destination field to be "
         "independently classified as the same kind.", 12, False, GREY, 2),
    ])
    panel(s, 6.85, 1.30, 5.95, 5.4, INDIGO_LT)
    textbox(s, 7.15, 1.50, 5.4, 0.5, [
        ("Performance — measured, both ends", 15, True, INDIGO, 8),
    ])
    metric_rows(s, 7.15, 1.95, 5.2, [
        ("", ("dev machine", "low-end laptop"), GREY, True),
        ("turn total", ("3.7 s", "4.7 s"), INK, False),
        ("on-device vision", ("65 ms", "~1030 ms"), INK, False),
        ("payload sent", ("47 KB", "47 KB"), INK, False),
    ], size=12, col_w=1.35)
    textbox(s, 7.15, 3.65, 5.4, 2.8, [
        ("Low-end figures are from a 6x CPU-throttled run, not an estimate.",
         9, False, GREY, 10),
        ("Honest limits", 13, True, AMBER, 6),
        ("•  Hindi is the only Indian language covered. A form labelled solely "
         "in Tamil, Bengali or Telugu is not yet handled, and we say so rather "
         "than wait to be asked.", 12, False, GREY, 4),
        ("•  Devanagari names in running prose are missed — the name tokeniser "
         "is Latin-only. Devanagari form fields do work.", 12, False, GREY, 4),
        ("•  Test corpus is 12 fixtures plus 4 real sites. Small, and stated as "
         "such: every page shape we have added found a real defect.", 12, False, GREY, 2),
    ])

    # ---------------- slide 5: impact ----------------
    s = prs.slides[4]
    clear_body(s)
    textbox(s, 0.55, 1.30, 5.95, 5.4, [
        ("Who this unblocks", 15, True, INDIGO, 8),
        ("Browser AI agents are unusable anywhere the screen is sensitive — "
         "government departments, defence, banking, healthcare, and ISRO's own "
         "workflows. Not a preference: a policy bar.", 12, False, GREY, 10),
        ("This removes the bar rather than asking anyone to lower it.", 12, True, INK, 12),
        ("Wider benefit", 15, True, INDIGO, 8),
        ("•  Citizens keep Aadhaar and PAN on their own device while still "
         "getting assistance", 12, False, INK, 4),
        ("•  Departments adopt AI assistance without a data-transfer review",
         10, False, INK, 4),
        ("•  The redaction scheme is reusable by any agent, not just this one",
         10, False, INK, 4),
        ("•  Sovereign by construction: open weights, runs on-premise",
         10, False, INK, 2),
    ])
    panel(s, 6.85, 1.30, 5.95, 5.4, INDIGO_LT)
    textbox(s, 7.15, 1.50, 5.4, 0.5, [
        ("Results on UNSEEN test pages", 15, True, INDIGO, 10),
    ])
    metric_rows(s, 7.15, 1.95, 5.0, [
        ("Visual context accuracy", "100%", INK, False),
        ("PII detection precision", "100%", INK, False),
        ("PII detection recall", "100%", INK, False),
        ("Redaction precision", "100%", INK, False),
        ("Data leaks", "0", GREEN, True),
    ])
    textbox(s, 7.15, 3.70, 5.4, 2.7, [
        ("These are the HOLDOUT numbers — pages written before any tuning and "
         "never optimised against, because the evaluation sites are revealed on the "
         "day.", 12, False, GREY, 6),
        ("The suite ships its own counterfactual: disabling the name layer drops "
         "holdout recall to 91.7% and tuned recall to 86.8%. The column is "
         "reproducible, not rounded.", 9, False, GREY, 8),
        ("Over-redaction is scored as heavily as leaking. A 12-digit order total "
         "that passes the Aadhaar checksum is deliberately NOT redacted.",
         9, False, GREY, 2),
    ])

    # ---------------- slide 6: research and references ----------------
    s = prs.slides[5]
    clear_body(s)
    textbox(s, 0.55, 1.30, 5.95, 5.4, [
        ("Standards and specifications", 15, True, INDIGO, 8),
        ("•  W3C WebGPU; WebAssembly — on-device inference in the browser",
         10, False, INK, 4),
        ("•  Chrome Manifest V3 offscreen documents; Firefox MV3 event pages",
         10, False, INK, 4),
        ("•  WHATWG HTML autocomplete tokens; W3C ARIA — field semantics",
         10, False, INK, 4),
        ("•  Verhoeff checksum (Aadhaar, UIDAI); Luhn, ISO/IEC 7812 (cards)",
         10, False, INK, 4),
        ("•  IT Act 2000 s.43A; DPDP Act 2023 — data minimisation",
         10, False, INK, 10),
        ("Models — all open-weight", 15, True, INDIGO, 8),
        ("•  UltraFace RFB-320 (ONNX Model Zoo, MIT) — 1.2 MB", 12, False, INK, 4),
        ("•  MobileViT-small — on-device region classification", 12, False, INK, 4),
        ("•  Qwen2.5-VL 7B — server reasoning, offline-deployable", 12, False, INK, 2),
    ])
    panel(s, 6.85, 1.30, 5.95, 5.4, AMBER_LT, AMBER)
    textbox(s, 7.15, 1.50, 5.4, 5.0, [
        ("Prior art, and where we differ", 15, True, AMBER, 8),
        ("Browser agents (Claude for Chrome, OpenAI Operator, Browser Use) send "
         "screen context to a vendor's cloud. Capable, and unusable where the screen "
         "is sensitive.", 12, False, GREY, 8),
        ("Enterprise DLP redacts data in transit — after it has left the device, "
         "and without the page structure needed to redact precisely.",
         10, False, GREY, 10),
        ("We redact ON the device, BEFORE transmission, using page structure the "
         "network layer never receives.", 12, True, INK, 10),
        ("Everything on these slides is reproducible", 13, True, INK, 6),
        ("Working code, test corpus, benchmark harness and the measurements behind "
         "every figure here.", 12, False, GREY, 2),
    ])

    # The template's own instructions say to delete slide 7 before uploading.
    xml_slides = prs.slides._sldIdLst
    slides = list(xml_slides)
    xml_slides.remove(slides[6])

    prs.save(OUT)
    print(f"wrote {OUT} ({len(prs.slides.__iter__.__self__._sldIdLst)} slides)")


if __name__ == "__main__":
    main()
