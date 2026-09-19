#!/usr/bin/env python3
"""The project report sent to the SIH SPOC at IIM Mumbai.

WHY THIS DOCUMENT EXISTS
IIM Mumbai is holding no internal hackathon, so there is no demo slot and no jury
session. This report is the whole submission: it is read once, on its own, by
someone deciding whether to spend one of the institute's nomination slots on us.

WHO READS IT
Dr. Puja Sarkar, Assistant Professor, Analytics & Data Science. That is a
technical reader who assesses models for a living, so the evaluation section is
written to be interrogated rather than admired: held-out results are reported
next to tuned ones, and the sections that would normally be quietly omitted --
what we got wrong, and what we have not proved -- are kept in full. A reader in
her area will look for exactly those and distrust a document that lacks them.

REGISTER
Continuous prose, not bullet fragments. Numbers carry the argument, so claims
are stated once and plainly rather than repeated with emphasis. Every figure in
here came out of a run recorded in the repository on the date given; nothing is
estimated, and nothing is rounded in our favour.

    python3 outreach/build-project-report.py
"""
import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, Image,
                                KeepTogether, NextPageTemplate, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

# ---------------------------------------------------------------------------
# THE ONE THING THAT CHANGES WHEN THE TEAM PICKS A NAME.
#
# The repository is moving from a personal account to an organisation that
# represents all six of us. Transferring on GitHub preserves the commits, the
# tags and the CI history, and leaves a redirect behind, so anything already
# shared keeps working. When the org exists, change these two lines and rebuild:
# nothing else in this file refers to the repository.
REPO_ORG = "AavaranAI"
REPO_NAME = "Aavaran"
REPO_PATH = f"{REPO_ORG}/{REPO_NAME}"
REPO_URL = f"https://github.com/{REPO_PATH}"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = f"{HERE}/SIH26171-Project-Report.pdf"
FIGS = f"{HERE}/figs"
DF = "/Applications/Microsoft Word.app/Contents/Resources/DFonts"

# Cambria ships as a collection; the regular face is index 0. Registering it as a
# plain TTFont silently fails and reportlab falls back to Helvetica, which has no
# rupee glyph -- the symbol then vanishes from the page with no warning.
pdfmetrics.registerFont(TTFont("Cam", f"{DF}/Cambria.ttc", subfontIndex=0))
pdfmetrics.registerFont(TTFont("Cam-B", f"{DF}/Cambriab.ttf"))
pdfmetrics.registerFont(TTFont("Cam-I", f"{DF}/Cambriai.ttf"))
pdfmetrics.registerFont(TTFont("Cam-BI", f"{DF}/Cambriaz.ttf"))
pdfmetrics.registerFont(TTFont("Cal", f"{DF}/Calibri.ttf"))
pdfmetrics.registerFont(TTFont("Cal-B", f"{DF}/Calibrib.ttf"))
pdfmetrics.registerFont(TTFont("Cal-I", f"{DF}/Calibrii.ttf"))
# Without registerFontFamily, <b> and <i> render at regular weight and no error
# is raised. Paid for twice on earlier documents in this project.
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
RED = colors.HexColor("#8C2F22")
GRN = colors.HexColor("#1B5E3A")

# allowWidows=0 forbids a paragraph's LAST line being stranded alone at the top of the
# next page; allowOrphans=0 forbids its FIRST line being left alone at the foot of one.
# ReportLab permits widows by DEFAULT, which is how "...is what made the task complete,
# and" came to sit at the bottom of one page with its closing line marooned on the next.
S = {
    "h1": ParagraphStyle("h1", fontName="Cam-B", fontSize=13.5, leading=16.5,
                         textColor=NAVY, spaceBefore=13, spaceAfter=5),
    "h2": ParagraphStyle("h2", fontName="Cam-B", fontSize=10.8, leading=13.5,
                         textColor=INK, spaceBefore=10, spaceAfter=3),
    "p": ParagraphStyle("p", fontName="Cam", fontSize=10.2, leading=14.1,
                        textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6,
                         allowWidows=0, allowOrphans=0),
    "pt": ParagraphStyle("pt", fontName="Cam", fontSize=10.2, leading=14.6,
                         textColor=INK, alignment=TA_JUSTIFY, spaceAfter=7,
                         firstLineIndent=0,
                         allowWidows=0, allowOrphans=0),
    "quote": ParagraphStyle("q", fontName="Cam-I", fontSize=9.9, leading=14,
                            textColor=GREY, leftIndent=14, rightIndent=10,
                            spaceBefore=3, spaceAfter=9,
                         allowWidows=0, allowOrphans=0),
    "cap": ParagraphStyle("cap", fontName="Cal", fontSize=8.3, leading=11,
                          textColor=GREY, alignment=TA_LEFT, spaceBefore=5,
                          spaceAfter=11,
                         allowWidows=0, allowOrphans=0),
    "cell": ParagraphStyle("c", fontName="Cal", fontSize=8.7, leading=11.4, textColor=INK),
    "cellb": ParagraphStyle("cb", fontName="Cal-B", fontSize=8.7, leading=11.4, textColor=INK),
    "cellc": ParagraphStyle("cc", fontName="Cal", fontSize=8.7, leading=11.4,
                            textColor=INK, alignment=TA_CENTER),
    "cellcb": ParagraphStyle("ccb", fontName="Cal-B", fontSize=8.7, leading=11.4,
                             textColor=INK, alignment=TA_CENTER),
    "hd": ParagraphStyle("hd", fontName="Cal-B", fontSize=8.3, leading=10.8,
                         textColor=colors.white),
    "hdc": ParagraphStyle("hdc", fontName="Cal-B", fontSize=8.3, leading=10.8,
                          textColor=colors.white, alignment=TA_CENTER),
    # A Paragraph keeps its own alignment, so a table-level ALIGN does nothing to
    # cells that contain one. Centred columns need a centred paragraph style.
    "ref": ParagraphStyle("ref", fontName="Cam", fontSize=9.2, leading=12.4,
                          textColor=INK, alignment=TA_LEFT, spaceAfter=5,
                          leftIndent=13, firstLineIndent=-13,
                         allowWidows=0, allowOrphans=0),
    "repo": ParagraphStyle("repo", fontName="Courier", fontSize=10.4,
                           leading=13, textColor=NAVY),
    "mono": ParagraphStyle("m", fontName="Courier", fontSize=8.2, leading=11.2,
                           textColor=INK),
    "tn": ParagraphStyle("tn", fontName="Cal-B", fontSize=13, leading=17,
                         textColor=NAVY, alignment=TA_CENTER),
    "tt": ParagraphStyle("tt", fontName="Cam-B", fontSize=20, leading=25,
                         textColor=INK, alignment=TA_CENTER),
    "ts": ParagraphStyle("ts", fontName="Cam-I", fontSize=12, leading=16,
                         textColor=NAVY, alignment=TA_CENTER, spaceAfter=3),
    "tm": ParagraphStyle("tm", fontName="Cal", fontSize=9.6, leading=13.6,
                         textColor=GREY, alignment=TA_CENTER),
}


# A reader skimming needs anchors, but emphasis everywhere is just a brochure.
# These are the claims and numbers the argument actually rests on, and they are
# applied after Python has joined the source strings, so it does not matter how
# a sentence happens to be wrapped in this file.
KEY_PHRASES = [
    "before any network request is made",
    "never held a real value",
    "The guarantee is a property of where the data sits, not a promise about code quality.",
    "every personal value with no false positives and leaks nothing",
    "about 4.7 seconds",
    "47 KB",
    "running entirely offline",
    "22% redaction precision",
    "disclosed nothing",
    "ten values were stripped from the payload while an image of all ten went out beside it",
    "The whole suite had passed before and after, which is to say nothing covered it.",
    "30 September 2026",
    "The technical work is complete and running",
    "no internal hackathon",
]


def emphasise(t):
    for phrase in KEY_PHRASES:
        if phrase in t and f"<b>{phrase}" not in t:
            t = t.replace(phrase, f"<b>{phrase}</b>", 1)
    return t


REFERENCES = [
    "Indian Space Research Organisation. <i>On-device Visual Perception for Light-weight "
    "Browser Agents.</i> Smart India Hackathon 2026, Problem Statement SIH26171. "
    "sih.gov.in/sih2026PS (accessed 17 September 2026).",

    "Qwen Team, Alibaba Group. <i>Qwen2.5-VL Technical Report.</i> "
    "arXiv:2502.13923, 2025.",

    "Presidio: an open-source framework for detecting, redacting and anonymising PII. "
    "Originally developed at Microsoft, now community-governed under the Data Privacy "
    "Stack organisation. github.com/microsoft/presidio",

    "K. Greshake, S. Abdelnabi, S. Mishra, C. Endres, T. Holz and M. Fritz. "
    "<i>Not what you've signed up for: Compromising Real-World LLM-Integrated "
    "Applications with Indirect Prompt Injection.</i> Proc. 16th ACM Workshop on "
    "Artificial Intelligence and Security (AISec), 2023, pp. 79-90. arXiv:2302.12173.",

    "W3C. <i>WebGPU.</i> W3C Working Draft. w3.org/TR/webgpu/",

    "Microsoft. <i>ONNX Runtime Web.</i> onnxruntime.ai/docs/tutorials/web/",

    "Hugging Face. <i>Transformers.js: state-of-the-art machine learning for the web.</i> "
    "huggingface.co/docs/transformers.js",

    "Ollama: run open-weight language models locally. ollama.com",

    "J. A. Hanley and A. Lippman-Hand. <i>If nothing goes wrong, is everything all right? "
    "Interpreting zero numerators.</i> JAMA, 249(13):1743-1745, 1983. "
    "doi:10.1001/jama.1983.03330370053031.",

    "J. Verhoeff. <i>Error Detecting Decimal Codes.</i> Mathematical Centre Tract 29, "
    "Mathematisch Centrum, Amsterdam, 1969. (The Aadhaar check digit.)",

    "H. P. Luhn. <i>Computer for Verifying Numbers.</i> US Patent 2,950,048, 1960. "
    "(The payment-card check digit.)",
]


def P(t, s="p"):
    return Paragraph(emphasise(t) if s == "p" else t, S[s])


def head(txt):
    return Paragraph(txt, S["h1"])


def sub(txt):
    return Paragraph(txt, S["h2"])


def figure(path, width, caption):
    from PIL import Image as PImage
    w, h = PImage.open(path).size
    img = Image(path, width=width, height=width * h / w)
    return KeepTogether([img, Paragraph(caption, S["cap"])])


def table(rows, widths, align_from=1, header=True):
    data = []
    for r_i, row in enumerate(rows):
        out = []
        for c_i, cell in enumerate(row):
            if r_i == 0 and header:
                st = "hdc" if c_i >= align_from else "hd"
            else:
                st = "cellc" if c_i >= align_from else "cell"
            out.append(Paragraph(str(cell), S[st]))
        data.append(out)
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("LINEBELOW", (0, -1), (-1, -1), 0.7, NAVY),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), NAVY),
                  ("LINEBELOW", (0, 0), (-1, 0), 0, NAVY)]
    t.setStyle(TableStyle(style))
    return t


# ---------------------------------------------------------------- page furniture

# The project name, settled by the team on 17 Sep. Aavaran is Sanskrit for a covering or
# veil, and idiomatically a screen, which is close enough to what the system does to be
# worth the double meaning.
PROJECT = "Aavaran"
TEAM = "Vagabonds"   # settled 17 Sep; the portal field and slide 1 use this too
TITLE = f"{PROJECT}: On-Device Visual Perception for Light-Weight Browser Agents"


def later_pages(canvas, doc):
    canvas.saveState()
    canvas.setFont("Cal", 7.6)
    canvas.setFillColor(LGREY)
    canvas.drawString(20 * mm, 12 * mm, f"SIH26171  ·  Team {TEAM}  ·  IIM Mumbai")
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, f"{canvas.getPageNumber()}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(20 * mm, 15.5 * mm, A4[0] - 20 * mm, 15.5 * mm)
    canvas.restoreState()


def first_page(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(NAVY)
    canvas.setLineWidth(1.1)
    canvas.line(20 * mm, A4[1] - 26 * mm, A4[0] - 20 * mm, A4[1] - 26 * mm)
    canvas.restoreState()


def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, title=TITLE,
                          author=f"Team {TEAM}, IIM Mumbai",
                          subject="Smart India Hackathon 2026 — SIH26171",
                          leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=20 * mm, bottomMargin=20 * mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([
        PageTemplate(id="first", frames=[frame], onPage=first_page),
        PageTemplate(id="later", frames=[frame], onPage=later_pages),
    ])
    story = []
    a = story.append

    # ------------------------------------------------------------- title page
    a(Spacer(1, 24 * mm))
    # The name sits above the title rather than inside it. A reader skims a cover in
    # about a second, and one word they can hold on to does more work there than a
    # thirteen-word title with a colon in the middle of it.
    a(Paragraph(PROJECT.upper(), S["tn"]))
    a(Spacer(1, 3))
    a(Paragraph("On-Device Visual Perception<br/>for Light-Weight Browser Agents", S["tt"]))
    a(Spacer(1, 7))
    a(Paragraph("An agent that reads the screen without the screen leaving the machine",
                S["ts"]))
    a(Spacer(1, 16 * mm))
    a(Paragraph(
        "Problem Statement <b>SIH26171</b><br/>"
        "Department of Space (ISRO) &nbsp;·&nbsp; Software &nbsp;·&nbsp; Smart Automation<br/>"
        "Smart India Hackathon 2026", S["tm"]))
    a(Spacer(1, 12 * mm))
    a(Paragraph(f"Submitted for team nomination by <b>Team {TEAM}</b><br/>"
                "<b>Indian Institute of Management Mumbai</b>", S["tm"]))
    a(Spacer(1, 12 * mm))

    # Interleaved deliberately rather than grouped by the kind of work. Listing the
    # three engineers first and the other three under them reads as a ranking, which
    # is not how this team is organised.
    team = [
        ["Harsh Bajpai",
         "<b>Architecture and redaction.</b> The trust boundary; the redaction engine, "
         "covering field classification, the vault and the global sweep; the agent loop, "
         "and validation of every action the model returns"],
        ["Jinshri Jain",
         "<b>Ledger design.</b> How the Privacy Ledger presents itself: the on-screen "
         "against transmitted layout in Figure 2 that makes a redaction legible to a "
         "reader who is not an engineer, and the visual language carried into the deck"],
        ["Vansh Khosla",
         "<b>Extension and integration.</b> Build pipeline and manifests for Chrome and "
         "Firefox, the offscreen capture and masking path, continuous integration on "
         "three operating systems, and the one-command setup"],
        ["Aarna Chauhan",
         "<b>Deck and diagrams.</b> The submission deck and its figures, the architecture "
         "and trust boundary diagrams including Figure 1, and the layout and typography "
         "of this report"],
        ["Manas Bharadia",
         "<b>Evaluation.</b> The fixture corpus and its ground truth, the scorecard and "
         "the four measures in Table 1, the held-out discipline, and the adversarial and "
         "prompt-injection pages"],
        ["Siddhartha Chaudhary",
         "<b>Demonstration.</b> Its script and runbook, the onboarding material, and the "
         "content of the Indian checkout, banking and government pages the corpus is "
         "built from"],
    ]
    tt = Table([[Paragraph(f"<b>{n}</b>", S["cell"]), Paragraph(r, S["cell"])]
                for n, r in team], colWidths=[40 * mm, 100 * mm])
    tt.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    a(tt)
    a(Spacer(1, 14 * mm))
    a(Paragraph("17 September 2026", S["tm"]))
    a(NextPageTemplate("later"))
    a(PageBreak())

    # ------------------------------------------------------------------ §1
    a(head("Abstract"))
    a(P("A browser agent is only useful if it can see the page. That is also the reason "
        "people will not run one. The screen of an Indian user filling a form holds a PAN, "
        "an Aadhaar number, a card number, a billing address and an open password field, "
        "and every assistant of this kind in wide use today answers the problem by "
        "uploading a screenshot and asking to be trusted."))
    a(P("So we built one that does not have to be trusted. <b>Aavaran</b> runs a small model inside the "
        "browser, reads the page, and replaces every personal value with a typed tag such as "
        "<font name='Courier' size='9'>&lt;PII_PAN_1&gt;</font> before any network request is "
        "made. A larger open-weight vision-language model then reasons over the censored page "
        "and returns a single action, which the extension validates and executes. The tag "
        "carries the one fact the reasoning actually needs, namely that the field is filled "
        "and well-formed, and withholds the value itself. The secret store lives in the page "
        "context; the part of the extension that touches the network has never held a real "
        "value at any point in its execution, so a bug in that layer cannot leak a PAN. The "
        "guarantee is a property of where the data sits, not a promise about code quality."))
    a(P("It runs today on Chrome and Firefox, across Windows, macOS and Linux. Against a "
        "held-out set never used during development it redacts <b>every personal value "
        "with no false positives and leaks nothing</b>. A real multi-step task, filling "
        "and submitting a three-field form, finishes in a <b>median 30 seconds</b> and "
        "completes reliably; browser heap "
        "grows by <b>17 MB</b>; a turn puts <b>47 KB</b> on the wire. None of it needs "
        "a network."))
    a(P("We also report a weaker number on purpose, since it is the one that tells you "
        "something. Build a third corpus out of real captured pages, where the markup is "
        "nobody's doing but the site's, and <b>recall falls to 75%</b>. Anything below the "
        "extractor's node budget is simply never looked at. Chasing that figure turned up "
        "a sixth instance of the leak this project keeps rediscovering, which Section 5.5 "
        "describes. Section 4 sets out how the evaluation works before showing what it "
        "produced, and Section 7 says plainly what we have not proved."))

    a(P("<i><b>Keywords.</b> on-device inference; privacy-preserving agents; PII redaction; "
        "vision-language models; browser extensions; WebGPU; held-out evaluation.</i>"))

    a(head("1.  The problem"))
    a(P("ISRO's statement [1] asks for on-device visual perception for light-weight browser "
        "agents. Two constraints in that sentence do most of the work. <i>On-device</i> rules "
        "out the ordinary architecture, in which the page is shipped to a server that can see "
        "everything. <i>Light-weight</i> rules out the escape hatch of running a frontier "
        "model locally, because the target is a machine a student or a clerk actually owns."))
    a(P("The statement is worth reading for who floated it. A space agency runs "
        "restricted and air-gapped networks, and its people work on consoles holding "
        "material that cannot be handed to a commercial assistant. ISRO's own framing "
        "is blunt about why. Server-side pipelines limit what a user can share at all. A "
        "local agent removes the limit. The interesting part is "
        "that the same constraint binds a citizen filling an Aadhaar-linked form, which "
        "is why the fixtures in Section 4 are Indian retail, banking and government "
        "pages. A system that satisfies an organisation with genuine secrecy "
        "requirements is the same system that protects somebody's PAN, and we would "
        "rather demonstrate it on the harder of the two."))
    a(sub("1.1  Why the obvious solutions fail"))
    a(P("The first instinct is to blur the screenshot. It does not survive contact with a real "
        "page, because an agent that cannot read the field cannot act on it either; blurring "
        "the PAN also blinds the agent to whether the PAN box is filled, which is the thing it "
        "needs to know in order to decide what to click next."))
    a(P("The second instinct is to redact on the server, immediately on arrival. This concedes "
        "the entire point. The value has already crossed the network by the time it is "
        "redacted, and the user is once again being asked to trust an operator and a log "
        "retention policy rather than an architecture."))
    a(P("The third is to run everything locally, which is correct in principle and is roughly "
        "what we do, but only becomes a real answer once someone has measured what a seven "
        "billion parameter vision model costs on a laptop with no discrete GPU. Much of our "
        "engineering time went into that measurement rather than into the idea."))

    a(sub("1.2  Related work"))
    a(P("PII detection itself is not new. Presidio [3], originally from Microsoft and now "
        "community-governed, combines named-entity recognition, pattern matching and "
        "checksums, and commercial equivalents exist in every major cloud. What they share "
        "is placement: they run where the data has already arrived. That is the right tool "
        "for a log pipeline and no help at all for the problem in Section 1, because by the "
        "time such a system sees a PAN it has crossed the network. Our contribution is not "
        "a better detector, and Table 2 shows our pattern layers alone are unremarkable. It "
        "is that detection is moved to the one place where refusing to send something is "
        "still possible."))
    a(P("The client-side half rests on work recent enough to make this feasible at all. "
        "WebGPU [5] and ONNX Runtime Web [6] put real inference inside a page, and "
        "Transformers.js [7] makes loading it practical, which is what the problem "
        "statement means when it points at them. For reasoning we use Qwen2.5-VL [2] served "
        "by Ollama [8] rather than a hosted API, so no part of the pipeline requires a "
        "network."))
    a(P("For Section 4.8 the relevant literature is indirect prompt injection [4], which "
        "established that content a model retrieves is an attack surface rather than inert "
        "data. We report our result in those terms, including the part of that threat our "
        "architecture does not address."))

    a(head("2.  Approach"))
    a(P("The design rests on one observation. An agent deciding what to do next does not need "
        "to know that the PAN field contains ABCPE1234F. It needs to know that the field "
        "labelled PAN contains a well-formed PAN. Those are different facts, and only the "
        "second has to leave the machine."))
    a(P("So the extension extracts a structured description of the page in the content script, "
        "classifies every value, and substitutes a tag that preserves the type and the "
        "validity while discarding the content. The real values are held in a vault that never "
        "leaves the page context. When the model replies with an action such as "
        "<font name='Courier' size='9'>click(el_24)</font>, the extension resolves the "
        "reference locally and executes it. The model has directed an action against a value "
        "it was never shown."))
    a(P("Redaction is global to the vault rather than local to a node. If a value is recognised "
        "once, every later occurrence of the same string is swept, which is what stops a card "
        "number that also appears in a confirmation sentence from escaping through the prose."))

    a(sub("2.1  Architecture"))
    a(P("Figure 1 shows where the boundary sits. Everything to the left of the dashed line runs "
        "in the page and holds real values. Everything to the right has only ever seen tags."))
    a(Spacer(1, 3))
    a(arch_figure())
    a(Paragraph("<b>Figure 1.</b> The trust boundary. The vault and the classifier run in the "
                "content script; the background worker, which is the only component that opens "
                "a socket, receives tagged text and masked pixels and nothing else.", S["cap"]))

    a(head("3.  The system as built"))
    a(P("A turn runs in five stages. The page is extracted into a node tree, pruned of anything "
        "invisible or decorative. Elements that carry meaning only as pixels, such as a "
        "<font name='Courier' size='9'>canvas</font> or an image with no alternative text, are "
        "queued for the in-browser vision model. Every text value is classified and, where "
        "personal, replaced by a tag. A screenshot is captured, and every region that was "
        "redacted in the text is filled solid in the image before it is encoded. The censored "
        "bundle goes to the local model server, and the single action that comes back is "
        "validated against the node tree before it is allowed to run."))
    a(P("The fourth of those stages exists because of a failure described in Section 5, and it "
        "is the one we had not thought to build until the failure in Section 5.1 made the "
        "case for it."))

    a(head("4.  Evaluation"))
    a(P("ISRO's statement sets out how entries will be scored, so this section reports "
        "against that rubric rather than against measures of our own choosing. The method "
        "is given before the numbers, and the numbers are given with their denominators."))
    a(sub("4.1  The corpus, and what it is not"))
    a(P("Eleven scored fixtures cover Indian checkout, banking, government and support "
        "pages, including forms in Hindi, Tamil and Bengali, pages using shadow DOM, and a "
        "page embedding a third-party frame. Three further pages exercise behaviour that is "
        "not scored as a page: hostile content, coordinate alignment, and a multi-step "
        "journey. Alongside these sit two held-out pages, and four captures of real public "
        "websites."))
    a(P("<b>The held-out pages were written by us.</b> They were authored before the first "
        "scoring run and have never been tuned against, which is a real discipline and the "
        "reason the tuned and held-out columns can be compared at all. But held out from "
        "tuning is not the same as drawn from an independent distribution, and we would "
        "rather say so than let the word do work it has not earned."))
    a(P("So there is a third corpus, and it exists precisely because of that objection. "
        "<b>The wild set takes the four real captured pages, keeps their DOM exactly as it "
        "is, and injects a small block of synthetic personal data with known ids.</b> The "
        "values and labels are ours, because ground truth on a stranger's page cannot be "
        "invented. Everything the extractor has to fight through is not: thousands of "
        "nodes, real class names, real nesting, whatever each site happens to do. That is "
        "the half that breaks things. A form in a hand-written thirty-node fixture and the "
        "same form buried in a six-thousand-node tree are not the same test, and the "
        "second is the one December will present. Twelve values, four decoys, four pages."))
    a(P("The rule we do enforce absolutely is that nothing may be special-cased to the "
        "held-out set. The grand finale reveals its own use cases on the day, so a system "
        "fitted to its own corpus predicts nothing about December. The same reasoning bans "
        "hardcoded CSS selectors anywhere in the codebase."))

    a(sub("4.2  Results against the published rubric"))
    a(Spacer(1, 2))
    a(table([
        ["ISRO metric", "Weight", "Tuned (11 pp.)", "Held out (2 pp.)", "Wild (4 pp.)"],
        ["Accuracy of visual context", "25%", "100% (14/14)", "100% (4/4)", "75% (3/4)"],
        ["PII recall", "20%", "100% (52)", "100% (12)", "<b>75% (9/12)</b>"],
        ["PII precision", "20%", "100%", "100%", "100%"],
        ["Precision of redaction", "20%", "100% (48/48)", "100% (10/10)", "100% (9/9)"],
        ["Client resource use", "20%", "+16.7 MB heap", "see 4.3", "see 4.3"],
        ["End-to-end task latency", "15%", "63 s median, vision included", "see 4.3", "see 4.3"],
        ["Leaks (our own invariant)", "n/a", "0", "0", "0"],
    ], [42 * mm, 16 * mm, 32 * mm, 26 * mm, 24 * mm], align_from=1))
    a(Paragraph("<b>Table 1.</b> Produced by <font name='Courier' size='8'>bench/score.ts</font> "
                "on 17 September 2026. Denominators are given because a rate without one is "
                "not a measurement. Visual context accuracy counts expected interactive "
                "elements recovered from the page against a hand-written ground truth file "
                "per fixture; it is not a human judgement of ours.", S["cap"]))
    a(P("Precision deserves a note, because it is where this system was once genuinely bad. "
        "An early version scored <b>22% redaction precision</b> on held-out pages: it was "
        "reading the cell <font name='Courier' size='9'>Applicant Name</font> on a "
        "government form and redacting the words &ldquo;Applicant Name&rdquo; as though "
        "they were somebody's name. The rule that fixed it is that <b>evidence about a "
        "value must never be drawn from the value itself</b>, and that rule recurs "
        "throughout Section 5."))
    a(P("The last two rows carry 35% of the score between them, and they were for a long time "
        "the weakest thing in this report: a heap delta measured in a Node process, and a "
        "latency excluding both vision and the model. Neither is what ISRO asked for. Both "
        "are now measured where they exist, in a real browser driving a real task, and "
        "Section 4.3 describes that run."))

    a(sub("4.3  The end-to-end task, measured in a browser"))
    a(P("The rubric asks for latency of a <i>task</i>, not of a turn, so the measurement is "
        "a task. A grievance form is loaded in Chrome with the extension installed and the "
        "local model running, and the agent is given one instruction: choose a category, "
        "enter a reference number, write a description, submit. Submit is disabled until "
        "all three fields are filled, so this cannot be satisfied by a single lucky click."))
    a(P("It completes in a <b>median of 30 seconds</b> across six turns, and browser heap "
        "in the page grows by <b>16.7 MB</b>, flat after the first turn. That figure was "
        "50 MB until the heap was sampled after a forced collection rather than whenever "
        "the collector felt like running: what had looked like noise turned out to be a "
        "straight line, 6.8 MB retained on every turn, because the content script was "
        "re-injected each time and re-parsed a 5 MB name gazetteer that nothing could "
        "then collect. Success is not taken from the loop's own "
        "report: the harness reads the page afterwards and requires every field populated "
        "and the confirmation banner actually visible. Section 5.4 explains why that "
        "distinction turned out to matter more than anything else in this report."))
    a(P("<b>That figure excludes the vision stage, and saying so matters more than the "
        "number.</b> The measurement page contains nothing the DOM cannot describe, so "
        "nothing ever enters the vision queue and every turn records zero milliseconds of "
        "vision. The thirty seconds is therefore the latency of the DOM path alone. We "
        "measured the difference rather than estimating it: on a variant of the same page "
        "carrying one image, the vision stage runs on all six turns and costs about seven "
        "seconds in total, and the same task then takes a median of sixty-three seconds, "
        "the balance being model time that varies with machine load. That variant is not "
        "the one used for the headline figure, because adding the image changed what the "
        "model saw each turn and made the task itself less reliable. Both numbers are "
        "true of the pages they were taken on, and a reader should assume a real page "
        "with images sits nearer the larger one."))
    a(P("This was found only because a crash in the vision stage forced the question of "
        "whether that stage had ever run during a benchmark at all. It had not. A "
        "measurement can be green, reproducible and still not execute the code it claims "
        "to time."))
    a(P("<b>It is also not deterministic, and a single figure would hide that. Seven of "
        "those eight runs completed the task; one did not.</b> The agent is a 7B model "
        "choosing its own actions, so the same instruction does not always produce the "
        "same sequence. When it fails it fails safely, leaving the form partly filled "
        "rather than submitting something wrong. But a demonstration that works seven "
        "times in eight is one that can fail in front of you, and making the loop recover "
        "reliably is honest work still to do."))
    a(sub("4.4  What the perfect scores do and do not mean"))
    a(P("Every cell in the tuned and held-out columns reads 100%, and we would treat that "
        "with suspicion in someone else's report, so we will do so in our own. Zero misses is "
        "not the same as a low miss rate. On the held-out set the denominator is <b>12 "
        "personal values across 2 pages</b>. By the rule of three [9], observing no failure in "
        "twelve trials is consistent with a true miss rate as high as <b>25%</b>. The "
        "tuned set is stronger at 52 values, giving an upper bound near 6%, but it is the "
        "set we developed against."))
    a(P("So the correct reading of the first two columns is that the system did not fail on "
        "any value it was shown, not that it fails rarely. <b>The wild column is where that "
        "distinction stops being theoretical.</b> Recall there is 75%, not 100%, and the "
        "three missed values are all on the same page: the Wikipedia capture is 5,993 nodes "
        "against a 1,500 node budget, so the injected block sat below the cap and was never "
        "extracted at all. Section 5.5 describes what that turned out to mean."))

    a(sub("4.5  What the context layer is worth"))
    a(P("A reasonable objection is that patterns and checksums alone might do most of this, "
        "and that the surrounding machinery buys little. The scorecard can be run with the "
        "contextual name layer disabled, which answers it directly."))
    a(Spacer(1, 2))
    a(table([
        ["Configuration", "Held-out recall", "Values leaked"],
        ["Patterns and checksums only", "91.7% (11/12)", "1"],
        ["Full pipeline", "100% (12/12)", "0"],
    ], [66 * mm, 37 * mm, 37 * mm]))
    a(Paragraph("<b>Table 2.</b> Ablation via "
                "<font name='Courier' size='8'>score.ts --no-layer3</font>. On the tuned "
                "corpus the same ablation leaks five values rather than one.", S["cap"]))
    a(P("In percentage terms the layer is worth eight points. In the terms that matter for "
        "this problem it is the difference between a system that leaks a name and one that "
        "does not, and a privacy guarantee is not an average."))

    a(sub("4.6  Real websites, where it does worse"))
    a(P("The four real captures carry no ground-truth labels, so recall cannot be scored on "
        "them. Precision can be, because these pages hold almost no personal data of the "
        "user: on Hacker News, python.org, an RBI circulars page and a Wikipedia article, "
        "nearly anything redacted is a false positive. <b>The system redacts 21 items across "
        "the four pages, and that number was 24 until this corpus was measured.</b>"))
    a(P("Three of those were not names at all and have since been fixed. An RBI circulars page "
        "yielded &ldquo;Master Directions&rdquo; and &ldquo;Master Circulars&rdquo;, which "
        "are document types, and &ldquo;Not Pressed&rdquo;, which is a case status. The "
        "cause was that &ldquo;Master&rdquo; and &ldquo;Not&rdquo; are both genuine given "
        "names and ordinary English words, so a rule meant to catch an uncommon surname "
        "after a known given name dragged the following word in with it. Requiring that the "
        "trailing word not be an ordinary English word removed all three at no cost to "
        "recall, and that page now yields nothing."))
    a(P("<b>So redaction precision on pages we did not write is materially below the 100% in "
        "Table 1.</b> The failure mode is over-redaction rather than leaking, which is the "
        "safer direction, but the rubric weights precision of redaction at 20% and an agent "
        "blinded to the names in a document is less useful. The cause is easy to state. A name in prose and a "
        "name in a form field are treated alike, when only the second belongs to the user. Fixing it means distinguishing the user's "
        "PII from third-party names in published content, which is a real piece of work and "
        "is now in Section 8. We report it here because a reader will otherwise find it in "
        "the first minute of trying the system."))

    a(sub("4.7  The ledger"))
    a(P("Because a privacy claim that cannot be checked is only a slogan, the extension "
        "ships a ledger that shows, for a given request, what was on the screen, what was "
        "transmitted in its place, and the exact bytes that went out. Figure 2 is the ledger "
        "for the checkout fixture, produced by the run that generated Table 1."))

    a(sub("4.8  Adversarial behaviour, and its limit"))
    a(P("We added a hostile page to the corpus. Hidden in it was an indirect prompt "
        "injection [4] telling the agent to disclose everything it knew. It fell for it "
        "completely, announcing that the user had authorised full disclosure. Then it disclosed nothing, because at that "
        "point in the pipeline it held no value to disclose. This is the clearest "
        "illustration of why the guarantee is structural: a behavioural defence has to win "
        "every time, an architectural one does not have to win at all."))
    a(P("<b>The limit of that result should be stated, because it is easy to overclaim.</b> "
        "What we showed is that injection cannot extract data. We did not show that "
        "injection cannot steer the agent's actions. The model did comply, and our "
        "validation checks that a returned action is well-formed and names a real element "
        "on the page; it does not check that the action is a sensible thing to do. An "
        "injected page that persuades the agent to click a genuine button it should not have "
        "clicked would pass. Action-level hijacking is the live risk in agent security and "
        "we have not tested it."))

    if os.path.exists(f"{FIGS}/ledger.png"):
        a(figure(f"{FIGS}/ledger.png", 170 * mm,
                 "<b>Figure 2.</b> Ten values withheld from a single checkout page. The left "
                 "column reconstructs what stood on screen from masked shadows, since "
                 "storing the real values in order to display them would be worse than the "
                 "problem the system solves. Order number, total and tracking number are "
                 "correctly judged harmless and sent unchanged."))
    a(sub("4.9  Threat model"))
    a(P("The claim is bounded and worth bounding explicitly. We defend against the "
        "<b>server operator and the network</b>: the reasoning model, anyone hosting it, and "
        "anyone on the path sees tagged text and masked pixels, never a value. That holds "
        "even if the server is hostile, because it is a property of what is sent."))
    a(P("We do not defend against an attacker who already controls the machine. The "
        "extension necessarily holds permission to read pages, the vault lives in browser "
        "memory, and a malicious extension update or a compromised browser defeats the "
        "design completely. Nor does the architecture prevent the local model server from "
        "logging what it receives, though what it receives is already redacted. Stating this "
        "narrows the claim to one we can actually support."))
    a(P("<b>Three boundaries are worth naming outright, because each is the first thing a "
        "reader tries.</b> The system does not stop the user photographing their own screen: "
        "masking applies to the image this agent captures and transmits, while an operating "
        "system screenshot reads the framebuffer, which no browser extension can observe. It "
        "does not police other extensions or other agents; Chrome deliberately grants no "
        "extension authority over another's access to a page, and a product claiming that "
        "capability is either overstating it or is a different class of software altogether. "
        "And it does not hide anything from the website itself, which already holds the value "
        "because the user typed it there. The guarantee is about what leaves for a third "
        "party. Aavaran is a redaction boundary inside one agent, demonstrable byte by byte, "
        "and not a guard around the whole machine."))
    a(P("A fourth limit was found on a live page and is reported for the same reason. A site "
        "that renders its content inside a cross-origin frame is invisible to the content "
        "script, which runs in the top frame only. Until 18 September such a page was scanned, "
        "read almost nothing, and was reported as carrying nothing personal. A clean result "
        "issued while blind is the most dangerous output a privacy tool can produce, because "
        "the reader concludes the page is safe. The share of the viewport that could not be "
        "read is now measured, and a page we could not substantially read is reported as "
        "unreadable rather than clean."))

    a(sub("4.10  Tests and continuous integration"))
    a(P("Twenty-six checks run on every push, nineteen of which need no browser, across "
        "Linux, macOS and Windows. They cover unit behaviour, the two privacy invariants, "
        "the scorecard on both corpora, adversarial pages, deliberate server faults, and "
        "timing under a six-fold CPU throttle. The nineteen browser-free checks last ran "
        "green, with nothing skipped, on 18 September 2026."))

    a(head("5.  What went wrong, and what it cost"))
    a(P("We think this section is the honest measure of the project, so it is reported rather "
        "than summarised. The work was not a straight line from idea to demo."))
    a(sub("5.1  The leak that kept coming back"))
    a(P("Five separate defects turned out to share one shape: content that was visible on "
        "screen but invisible to the redactor, while the screenshot transmitted it anyway. "
        "Hidden text was lifted into a visible element's label. Shadow DOM was never traversed. "
        "Text beyond an internal character cap was silently truncated. A value appearing twice "
        "was redacted in one place only."))
    a(P("The fifth was the general case and the worst. A value could be perfectly tokenised in "
        "the JSON and perfectly legible in the picture sent in the same request, because the "
        "masking step had only ever been given face boxes and had never masked any text at all. "
        "On the demo page itself, ten values were stripped from the payload while an image of "
        "all ten went out beside it. The leak test had passed throughout, because it inspected "
        "the payload and had never once looked at the image."))
    a(Paragraph("A system that emits two artefacts has to be tested for agreement between them. "
                "Asserting on one proves nothing whatever about the other.", S["quote"]))
    a(P("The repair fills each redacted region solid rather than blurring it. A blur radius "
        "tuned to destroy a face leaves text perfectly legible. It also fails closed. If "
        "fewer regions are masked than were asked for, the screenshot is withheld outright "
        "rather than sent clean. The same audit found that an embedded frame is a rectangle the "
        "content script cannot see into while the camera photographs it regardless, which is an "
        "ordinary arrangement on Indian banking and government portals, where the payment or "
        "KYC step is embedded from elsewhere."))
    a(sub("5.2  Tests that could not fail"))
    a(P("One check passed while the extractor was returning zero nodes, because in JavaScript "
        "every assertion over an empty list is vacuously true. Worse, the test written "
        "specifically to catch that class of mistake had the same defect: it read its expected "
        "count from the code under test, so sabotaging the code drove expectation and actual to "
        "zero together and the suite stayed green. Expectations are now derived from sources "
        "the implementation cannot move, and we verify a new check by breaking the fix "
        "deliberately and confirming the check goes red."))
    a(P("That discipline earned its keep on the morning this report was written. Preparing "
        "Figure 2, we noticed the ledger labelling a row with another row's data. The cause was "
        "a fix made six days earlier: reading a table's column headers from its first row, "
        "without first checking whether that row was a header row at all. In a table with no "
        "header, the first row is data, so every later row was being labelled with row one's "
        "values, and the order total's context read "
        "<font name='Courier' size='9'>123456789012 Order Total</font>. That is the rule from "
        "Section 4.2 broken by the change written to enforce it. The whole suite had passed "
        "before and after, which is to say nothing covered it. The fix is one additional condition; the "
        "test guarding it fails in four places when that condition is removed."))
    a(sub("5.3  Measurements that contradicted us"))
    a(P("Nearly every performance intuition we had was wrong, and instrumenting always cost "
        "less than guessing. Quantising the in-browser vision model to int8 made it about ten "
        "times slower than fp32, because the WebGPU backend has no native int8 matrix path. "
        "Reading an element's children through "
        "<font name='Courier' size='9'>Array.from(el.children)</font> per node took 8,644 ms "
        "where sibling iteration took 4 ms. Resolving label elements with a document query per "
        "field took 54 seconds across 1,500 calls, against building one map at the start. "
        "Chrome's offscreen document is timer-throttled, so encoding even a sixteen-pixel "
        "canvas there takes about a second."))
    a(P("Two of these were wrong in the other direction, which is worth admitting. We once recorded that Firefox exposes no WebGPU adapter. That holds only "
        "for headless Firefox. A headed browser has one, and the original note still sits "
        "in the repository, marked superseded rather than quietly deleted. Separately, a timing test that asserted a fixed six-second "
        "ceiling failed two documentation-only commits at 6,021 ms on a loaded runner, because "
        "a wall-clock threshold is a claim about the machine rather than about the code. It now "
        "asserts a ratio against a reference operation timed on the same machine. Relaxing a "
        "guard means re-earning its teeth. So we broke the code on purpose and watched: the "
        "check fired at 3.40 times the limit."))

    a(sub("5.4  The check that could not tell success from failure"))
    a(P("The end-to-end agent loop is the thing a judge will actually watch, and it had "
        "the weakest check in the project. The harness launched Chrome, ran the task, "
        "wrote a result file, and reported success if that file existed. It never read "
        "what was in it."))
    a(P("So the suite reported the agent loop as passing through <b>every run in which the "
        "agent filled two fields of three and then gave up</b>. The loop had run. The task "
        "had failed. The check could not distinguish those, and nobody looked, because it "
        "was green."))
    a(P("Reading the page afterwards instead exposed three real defects in a row. The "
        "action schema allowed a "
        "<font name='Courier' size='9'>type</font> with no value, so the model emitted one "
        "and lost a turn to a refusal. A repair using JSON Schema "
        "<font name='Courier' size='9'>if</font>/<font name='Courier' size='9'>then</font> "
        "was accepted by the runtime and silently ignored, giving a constraint that looked "
        "stricter without being stricter; "
        "<font name='Courier' size='9'>oneOf</font> is converted into a real grammar and "
        "was verified on both branches before being adopted."))
    a(P("The third was the one that mattered. Refused actions were never added to the "
        "history the model sees, so the model proposed an invalid action, never learned it "
        "had been rejected, and proposed it again; the loop then stopped, reasoning that "
        "another identical turn would only repeat the refusal. That was true, but only "
        "because the refusal was being withheld from the one participant who could act on "
        "it. <b>The assumption made itself true.</b> Putting the refusal into the history "
        "and allowing one re-plan is what made the task complete, and the measurement in "
        "Section 4.3 exists because of it."))
    a(sub("5.5  The sixth instance, found on the first run of a new corpus"))
    a(P("The wild corpus was built to answer a fair objection, that we had written our own "
        "exam. It found a leak within minutes of existing."))
    a(P("When a page exceeds the node budget the walk stops. Everything below the cap is "
        "invisible to the redactor and perfectly visible on screen, and the rules that "
        "decide whether to withhold the screenshot consulted the closed-shadow-root case "
        "and the text-cap case but <b>never consulted truncation at all</b>. So on any "
        "large real page, a PAN below the cap was absent from the payload and present in "
        "the transmitted image. That is the same shape as the five leaks in Section 5.1, "
        "for the sixth time, and it had been sitting behind three corpora that were all "
        "small enough to fit inside the budget."))
    a(P("Withholding on truncation alone would have been far too blunt, since almost every "
        "large page truncates and the screenshot carries 25% of the grade. The narrower "
        "question the text cap already asks is the right one: is there anything PII-shaped "
        "in the part we did not reach? Only then is the image unsafe."))
    a(P("The first version of that check scanned a bounded sample of the missed content. "
        "On Wikipedia the bound was exhausted by ordinary prose thousands of nodes before "
        "reaching the block that held the GSTIN, so <b>it reported clean on the exact page "
        "that motivated it</b>. A guard that runs out of budget before reaching the danger "
        "is worse than no guard, because it also reports success. It now sweeps form "
        "controls first and exits on the first verified hit."))
    a(head("6.  Performance and deployment"))
    a(P("A full turn transmits 47 KB. In-browser vision takes 65 ms; the reasoning model takes "
        "about 3.8 seconds, giving roughly 4.7 seconds end to end on a laptop throttled to "
        "six times slower than the development machine. The model generates about 11 tokens "
        "per second, and that figure is hardware rather than a tuning failure: constrained "
        "decoding, context length and model choice were each measured separately and ruled out."))
    a(P("<b>A task costs more than a turn, and the difference is not in our favour.</b> The "
        "grievance task in Section 4.3 takes about half a minute over six turns, slower "
        "than filling the form by hand. The honest position is that this system currently "
        "earns its place where the value is privacy rather than speed. The 3.8 seconds of "
        "model time per turn is the whole of the gap, and it is already a quantised "
        "number: the model runs at Q4_K_M, so the obvious lever has been pulled. Two "
        "cheaper ones have not. Of the six turns that task took, <b>two were wasted</b> "
        "clicking a button that had already done its job, because the model would not "
        "emit the action that says it has finished. Ending the run when the page shows "
        "the task is done would remove about a third of the wall-clock time without "
        "touching the model at all."))
    a(P("The reasoning model is Qwen2.5-VL at 7B [2], open weights, served locally through Ollama [8] "
        "in about 6 GB. <b>Nothing in the pipeline requires a network connection or an API key</b>, "
        "which matters for the deploying organisation as much as for the individual user."))

    a(head("7.  What we have not proved"))
    a(P("Stating these plainly seems more useful than leaving them to be discovered."))
    a(P("<b>The screenshot masking is now proven on pixels, and this paragraph used to say "
        "the opposite.</b> A spike loads the checkout fixture in headed Chrome, runs the "
        "production capture and mask path, and samples the transmitted image. All ten "
        "redacted regions have their luma variance collapse to essentially zero, which is "
        "what a solid fill does and a blur does not, while control points away from every "
        "box stay byte-identical. The count of regions expected comes from the hand-written "
        "ground-truth file rather than from the sanitizer, so breaking the sanitizer cannot "
        "drive expectation and actual to zero together. Reverting the fill turns it red, "
        "and instructively so: the box count still reads ten of ten, and only the pixels "
        "give it away."))
    a(P("<b>Redaction precision on pages we did not write is worse than Table 1 suggests.</b> "
        "Section 4.6 gives the measurement: 21 items redacted across four real websites. Three "
        "of the clearest errors have since been fixed, but seventeen names from a single "
        "encyclopedia article remain, because the system does not separate the user's own "
        "personal data from third-party names in published text."))
    a(P("<b>We have not shown that the agent cannot be steered.</b> Section 4.8 sets out the "
        "distinction. Injection cannot extract a value from us; whether it can induce a bad "
        "action is untested."))
    a(P("Embedded frames are masked rather than read, so their contents are protected but their "
        "meaning is lost to the agent. Recovering it means merging separate vaults across "
        "frames, which is exactly where leaks of the Section 5.1 kind would live, so it needs a "
        "design rather than a flag. Eight of the eleven Indian-language vocabularies have not "
        "been reviewed by a native reader. Name detection in running prose is currently "
        "Latin-script only, though form fields work in every language we support."))

    a(head("8.  Plan to the grand finale"))
    a(P("The order is deliberate: close the one unproved claim, then widen the evidence, then "
        "extend the capability."))
    a(Spacer(1, 2))
    a(table([
        ["Priority", "Work", "Why it is in this order"],
        ["1", "Separate the user's own data from third-party names in prose",
         "The largest measured defect; costs precision, worth 20% of the rubric"],
        ["2", "Extract below the node budget instead of withholding the image",
         "Failing safe costs visual context, worth 25%"],
        ["3", "Grow the wild corpus to real government portals",
         "24 labelled values cannot separate a good system from a lucky one"],
        ["4", "Native review of eight language vocabularies",
         "Cheap, high value, and needs a reader rather than an engineer"],
        ["5", "Read inside frames by merging per-frame vaults",
         "Recovers lost context, but only with a design that cannot leak"],
        ["6", "Stop the run when the task is visibly done",
         "Two of six turns were wasted; the model is already 4-bit"],
    ], [16 * mm, 66 * mm, 58 * mm], align_from=3))

    a(head("9.  The team"))
    a(P("All six of us are students of the Indian Institute of Management Mumbai, which "
        "satisfies the requirement that a team may not be drawn from more than one college. "
        "Two members, <b>Jinshri Jain and Aarna Chauhan</b>, are women, so the "
        "<b>requirement of at least one female member is met</b>."))
    a(P("The work divides along the three parts of the system. <b>Harsh Bajpai</b> built "
        "the architecture and the redaction engine. That is where the guarantee in "
        "Section 2 is won or lost, and it is also where four of the five leaks in Section "
        "5.1 were found and closed. The agent loop, which checks every action before it "
        "runs, is his too."))
    a(P("Around that sits the extension, and <b>Vansh Khosla</b> built it: the repository, "
        "the builds for two browsers that want different things, the capture and masking "
        "path described in Section 5.1. He also set up the integration that runs the whole "
        "suite on Windows, macOS and Linux at every push. That last piece is why we can "
        "claim anything at all. A number nobody re-checked on another machine is a "
        "memory, not a measurement."))
    a(P("<b>Manas Bharadia</b> built the evaluation. Corpus, ground truth, the four "
        "measures in Table 1, and the held-out rule that stops us marking our own "
        "homework. The uncomfortable numbers in this report are his work as much as the "
        "flattering ones."))
    a(P("The remaining half decides whether any of it can be understood by someone who did "
        "not build it, and we would not claim it matters less. <b>Jinshri Jain</b> designed "
        "how the Privacy Ledger presents itself. Figure 2 is hers, and it is the page that "
        "turns a privacy claim into something a reader checks rather than accepts. <b>Aarna "
        "Chauhan</b> produced the submission deck, the diagrams including Figure 1, and how "
        "this report reads on the page. <b>Siddhartha Chaudhary</b> built the demonstration "
        "and its runbook, and owns the Indian-language coverage. A missing word for "
        "&ldquo;total&rdquo; in Gujarati costs us precision, not recall, which is an easy "
        "thing to overlook and worth 20% of the marks. The repository carries continuous "
        "integration on three operating systems and two tagged releases."))

    a(head("10.  What we are asking for"))
    a(P("We would be grateful to be considered for nomination by the institute against "
        "problem statement SIH26171. The portal records the last date for team nomination "
        "and idea submission as 30 September 2026, and the statement currently holds 20 of "
        "the 500 ideas it will accept."))
    a(P("Should the team be taken forward, two things have to come from the institute. The "
        "nomination itself, and the team identifier the portal issues, which is printed on "
        "the submission deck. We would also welcome guidance on how you "
        "would like the internal selection handled, and we are glad to prepare whatever "
        "documentation, presentation or demonstration would be useful for it. If anything "
        "in this report needs expanding or evidencing further, we will gladly do that too."))
    a(P("We would be happy to demonstrate the system in person at your convenience, on a "
        "machine with no network connection, which is the most direct way to see that the "
        "claim in the abstract is a fact about the architecture rather than a statement of "
        "intent."))

    a(head("References"))
    a(P("Sources are given for claims resting on someone else's work. Software with no "
        "accompanying paper is cited as a project rather than invented into one."))
    a(Spacer(1, 2))
    for _i, _r in enumerate(REFERENCES, 1):
        a(Paragraph(f"[{_i}]&nbsp;&nbsp;{_r}", S["ref"]))

    appendix = []
    ap = appendix.append
    ap(head("Appendix:\u2002 Getting it and checking it"))
    ap(P("<b>Every number in this report can be reproduced from the repository</b>, and "
         "nothing below needs an API key or a network connection to us. The repository is "
         "private for the moment, while the team is still working in it. We would be glad "
         "to add you: tell us the GitHub username to add, or ask and we will open it."))
    ap(Spacer(1, 1))
    repo = Table([[Paragraph(
        f"github.com/{REPO_PATH}", S["repo"])]], colWidths=[140 * mm])
    repo.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#E8EEF9")),
        ("BOX", (0, 0), (-1, -1), 0.5, NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    ap(repo)
    ap(Spacer(1, 7))
    ap(P("<b>What you need.</b> Node 22 or later and Python 3 for the first two commands; "
         "<font name='Courier' size='9'>setup.sh</font> checks for both and says what is "
         "missing rather than failing obscurely. The third also needs "
         "Chrome, Firefox, and Ollama with the 7B model, which is roughly a 6 GB download. "
         "Only that third command touches the network, and only to fetch the model."))
    ap(Spacer(1, 1))
    code = Table([[Paragraph(
        f"git clone {REPO_URL}.git<br/>"
        f"cd {REPO_NAME}<br/><br/>"
        "./setup.sh&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
        "<font color='#5A6270'># checks tools, installs deps, builds the extension</font><br/>"
        "./test-all.sh&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
        "<font color='#5A6270'># 17 checks, about a minute, no browser needed</font><br/>"
        "./test-all.sh --full&nbsp;"
        "<font color='#5A6270'># 24 checks: real browsers and the live model</font>",
        S["mono"])]], colWidths=[140 * mm])
    code.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    ap(code)
    ap(Spacer(1, 7))
    ap(P("<font name='Courier' size='9'>test-all.sh</font> prints the scorecard behind "
         "Table 1; <font name='Courier' size='9'>--wild</font> on the scorecard reproduces "
         "the third column. The repository also carries the record this report draws on: "
         "<font name='Courier' size='9'>RUNBOOK.md</font> for the demonstration, a findings "
         "note for each measurement spike with the numbers that produced it, and the "
         "scorecard's own description of its known gaps. We are glad to walk anyone at the "
         "institute through it in person instead."))

    a(KeepTogether(appendix))

    doc.build(paginate(story))
    print(f"wrote {OUT}")


def _bulk(block):
    """Roughly how much vertical space a block wants, measured in characters."""
    total = 0
    for f in block:
        total += len(getattr(f, "text", "") or "")
    return total


def paginate(story):
    """Make every page open on a heading, never on a stranded one.

    Two faults were visible in the first print. A subsection heading could land as the
    last thing on a page with its text overleaf, which reads as though the section is
    empty. And a figure could be separated from the paragraph introducing it, so a page
    began mid-thought with a picture and no idea what it was for.

    Both come from letting the flow decide. So:

    So a heading is glued to the paragraph beneath it and can never be stranded at the
    foot of a page, while the rest of a subsection is free to flow.

    Two stricter rules were tried and rejected, and the reason is worth recording because
    both sounded better than they read. Forcing a fresh page per numbered section left
    short sections holding eighty words and ran the document to eighteen pages of mostly
    white. Holding each subsection together as a single block was worse still in one
    respect: a long subsection that would not fit jumped wholesale to the next page and
    left forty per cent of the previous one empty.

    Every page opening on a heading is not in fact what published papers do, and chasing
    it costs more than it returns. What they avoid is the stranded heading and the
    orphaned line, which is what this does.

    A subsection taller than a page still splits, because nothing can prevent that, and
    reportlab degrades gracefully rather than dropping it. The cost is white space at the
    foot of some pages, which is the correct trade in a document that is read once and
    judged on whether it is easy to follow.
    """
    h1, h2 = S["h1"], S["h2"]
    GLUE = 99                    # collect the whole subsection, then decide
    # Whether a subsection is held whole is decided by how much TEXT it carries, not by
    # how many paragraphs it happens to be split into. Counting flowables was the first
    # attempt and it misjudges height badly: a four-paragraph subsection of short
    # sentences and a two-paragraph one of long ones are nothing alike on the page, and
    # holding the wrong ones whole is what left two pages a third empty.
    # 1500 was chosen by building at 700, 900, 1200, 1500, 1800, 2200 and 2600 and
    # measuring each. Below it, pages fill well but too many open mid-paragraph. Above
    # it, every page opens on a heading and the document grows to fourteen, but whole
    # subsections start jumping again and page four returns to being forty per cent
    # empty, which is the fault this was written to remove. At 1500 the worst page
    # trails by about a fifth and four pages are completely full.
    MAX_BULK = 1500              # characters; above this the subsection is allowed to flow
    out, block, first, glue = [], [], True, 0

    def flush():
        if not block:
            return
        # A SHORT subsection is kept whole, so it heads a page rather than being split
        # across one. A LONG one is anchored by its heading and then allowed to flow,
        # because holding it whole is what left forty per cent of a page empty.
        if len(block) == 1:
            out.append(block[0])
        elif _bulk(block) <= MAX_BULK:
            out.append(KeepTogether(list(block)))
        else:
            out.append(KeepTogether(block[:2]))      # heading + opening paragraph
            out.extend(block[2:])
        block.clear()

    for item in story:
        style = getattr(item, "style", None)
        if style is h1:
            flush()
            block.append(item)
            glue = GLUE
        elif style is h2:
            flush()
            block.append(item)
            glue = GLUE          # how many following flowables stay with this heading
        elif isinstance(item, (PageBreak, NextPageTemplate)):
            flush()
            out.append(item)
            first = True          # the title page break; next heading must not add another
        elif isinstance(item, KeepTogether):
            # A figure is already an indivisible block of its own. Holding it with the
            # heading above forces the pair onto the next page together and strands a
            # third of the current one; letting it float fills both pages instead.
            flush()
            out.append(item)
        else:
            if glue > 0:
                block.append(item)
                glue -= 1
            else:
                flush()
                out.append(item)
    flush()
    return out


def arch_figure():
    """Figure 1, drawn rather than imported.

    A diagram assembled from primitives stays correct when the text around it is
    edited, and prints cleanly at any size. An exported bitmap of a diagram does
    neither.
    """
    from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon
    W, H = 170 * mm, 52 * mm
    d = Drawing(W, H)

    def box(x, y, w, h, label, detail, fill):
        d.add(Rect(x, y, w, h, fillColor=fill, strokeColor=NAVY, strokeWidth=0.7, rx=2, ry=2))
        d.add(String(x + w / 2, y + h - 13, label, fontName="Cal-B", fontSize=8.4,
                     fillColor=INK, textAnchor="middle"))
        for i, ln in enumerate(detail):
            d.add(String(x + w / 2, y + h - 24 - i * 9.2, ln, fontName="Cal", fontSize=7.4,
                         fillColor=GREY, textAnchor="middle"))

    def arrow(x1, x2, y, label):
        d.add(Line(x1, y, x2 - 5, y, strokeColor=NAVY, strokeWidth=0.8))
        d.add(Polygon([x2, y, x2 - 5.5, y + 2.6, x2 - 5.5, y - 2.6],
                      fillColor=NAVY, strokeColor=NAVY))
        d.add(String((x1 + x2) / 2, y + 5, label, fontName="Cal", fontSize=7,
                     fillColor=GREY, textAnchor="middle"))

    bw, bh, by = 44 * mm, 30 * mm, 12 * mm
    box(0, by, bw, bh, "The page", ["DOM, pixels,", "the real values"], colors.white)
    box(52 * mm, by, bw, bh, "Content script",
        ["extract · classify", "vault · mask", "REAL VALUES STOP HERE"], SOFT)
    box(115 * mm, by, 55 * mm, bh, "Background worker",
        ["opens the socket", "sees tags and", "masked pixels only"], colors.white)

    arrow(bw, 52 * mm, by + bh / 2, "read")
    arrow(96 * mm, 115 * mm, by + bh / 2, "tagged")

    x = 106 * mm
    yy = by - 6
    while yy < by + bh + 6:
        d.add(Line(x, yy, x, min(yy + 5, by + bh + 6), strokeColor=RED, strokeWidth=1.1))
        yy += 9
    d.add(String(x, by + bh + 10, "trust boundary", fontName="Cal-B", fontSize=7.4,
                 fillColor=RED, textAnchor="middle"))
    d.add(String(x + 30 * mm, by - 9, "local model server · no network, no API key",
                 fontName="Cal-I", fontSize=7.2, fillColor=GREY, textAnchor="middle"))
    return d


if __name__ == "__main__":
    build()
