#!/usr/bin/env python3
"""Check a document for the statistical fingerprints of generated prose.

Commercial detectors rest on two quantities: perplexity (how surprised a model is
by the next word) and burstiness (how much that surprise varies). Only one of the
two can be measured honestly on this machine, and this script is careful about
which.

PERPLEXITY IS NOT MEASURED HERE, AND THE REASON MATTERS
The first version of this script tried. It fed each cut point to the local
llama3.1 and read the probability assigned to the author's actual next word. The
control inverted: text the model had generated itself came out LESS predictable
than the document under test, which cannot be true. Printing the raw predictions
found the cause immediately. Given a mid-paragraph fragment, an instruction-tuned
model does not continue the paragraph, it begins a reply:

    "...we therefore treat any special-casing of held-out"
        -> It (-0.36), I (-1.40), it (-3.83), There (-4.59)

The author's word, "content", is not a candidate at any rank. The measurement was
reporting whether llama3.1 wanted to start answering, identically for every
sample. A real perplexity number needs a BASE model; every model installed here
is instruction-tuned, so the honest output is no number at all.

The control gate below is kept for exactly that reason. If a perplexity pass is
ever added with a base model, the machine baseline must come out as the most
predictable sample or the run refuses to report.

WHAT IS MEASURED
Signals that need no model and cannot silently invert: burstiness, punctuation
habits, vocabulary, and opener variety. Burstiness is one of the two axes the
detectors actually use, so this is not a consolation prize.

Nothing leaves the machine.

    python3 outreach/ai-text-analysis.py <file.pdf | file.txt>
"""
import collections
import re
import statistics
import sys

# Words that cluster heavily in generated prose. Presence is a hint, not a verdict.
TELLS = [
    "delve", "robust", "comprehensive", "leverage", "seamless", "crucial", "pivotal",
    "testament", "landscape", "realm", "underscore", "showcase", "holistic",
    "cutting-edge", "game-changing", "meticulous", "intricate", "myriad", "profound",
    "embark", "foster", "navigate the", "tapestry", "in today's", "it is worth noting",
    "furthermore", "moreover", "additionally", "in conclusion", "vibrant",
]

# Reference bands from published work on detector features. Deliberately coarse:
# these separate obvious cases and are not a score.
BANDS = {
    "burstiness": (0.25, 0.45),   # below ~0.25 reads machine, above ~0.45 human
    "em_per_1k": (1.5, None),     # generated prose leans hard on the em dash
}


def load(path):
    if path.lower().endswith(".pdf"):
        from pypdf import PdfReader
        return "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)
    return open(path, encoding="utf-8").read()


def prose_only(t):
    """Keep sentences; drop headers, captions, table cells and bare numbers."""
    keep = []
    for line in t.split("\n"):
        s = line.strip()
        if len(s) < 45:
            continue
        if re.match(r"^(SIH26171|Figure|Table|Priority|Measure|\d)", s):
            continue
        keep.append(s)
    return re.sub(r"\s+", " ", " ".join(keep))


def analyse(text):
    words = re.findall(r"[A-Za-z][A-Za-z'-]*", text)
    n_words = len(words)
    sents = [s.strip() for s in re.split(r"(?<=[.!?]) ", text) if len(s.split()) > 5]
    lengths = [len(s.split()) for s in sents]
    mean = statistics.mean(lengths)
    sd = statistics.pstdev(lengths)

    openers = collections.Counter(" ".join(s.split()[:2]).lower() for s in sents)
    lower = [w.lower() for w in words]
    freq = collections.Counter(lower)

    return {
        "words": n_words,
        "sentences": len(sents),
        "mean_len": mean,
        "sd_len": sd,
        "burstiness": sd / mean if mean else 0,
        "short": sum(1 for l in lengths if l < 12),
        "long": sum(1 for l in lengths if l > 32),
        "em": text.count("—"),
        "en": text.count("–"),
        "ellipsis": text.count("…") + text.count("..."),
        "semis": text.count(";"),
        "em_per_1k": text.count("—") / n_words * 1000,
        "hapax": sum(1 for w, c in freq.items() if c == 1) / len(freq),
        "ttr": len(freq) / n_words,
        "top_opener": openers.most_common(1)[0] if openers else ("", 0),
        "tells": [(t, len(re.findall(t, text, re.I))) for t in TELLS
                  if re.search(t, text, re.I)],
    }


def verdict(r):
    lo, hi = BANDS["burstiness"]
    notes = []
    if r["burstiness"] >= hi:
        notes.append(("PASS", f"burstiness {r['burstiness']:.2f} is above the {hi} human band"))
    elif r["burstiness"] <= lo:
        notes.append(("FLAG", f"burstiness {r['burstiness']:.2f} is in the machine band"))
    else:
        notes.append(("MID ", f"burstiness {r['burstiness']:.2f} is between the bands"))

    if r["em"] == 0:
        notes.append(("PASS", "no em dashes at all"))
    elif r["em_per_1k"] > BANDS["em_per_1k"][0]:
        notes.append(("FLAG", f"{r['em_per_1k']:.1f} em dashes per 1000 words"))
    else:
        notes.append(("PASS", f"{r['em']} em dashes, sparse"))

    notes.append(("PASS", "no ellipses") if r["ellipsis"] == 0
                 else ("FLAG", f"{r['ellipsis']} ellipses"))
    notes.append(("PASS", "no flagged vocabulary") if not r["tells"]
                 else ("FLAG", "vocabulary: " + ", ".join(f"{t}x{c}" for t, c in r["tells"])))
    op, c = r["top_opener"]
    notes.append(("PASS", f"most repeated opening used {c}x in {r['sentences']} sentences")
                 if c <= max(3, r["sentences"] // 25)
                 else ("FLAG", f"opening {op!r} repeats {c}x"))
    return notes


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "outreach/SIH26171-Project-Report.pdf"
    text = prose_only(load(path))
    r = analyse(text)

    print(f"\n{path}")
    print(f"{r['words']} words of prose, {r['sentences']} sentences\n")
    print(f"  sentence length     mean {r['mean_len']:.1f}, sd {r['sd_len']:.1f} "
          f"({r['short']} short, {r['long']} long)")
    print(f"  burstiness          {r['burstiness']:.2f}")
    print(f"  em / en / ellipsis  {r['em']} / {r['en']} / {r['ellipsis']}")
    print(f"  semicolons          {r['semis']}")
    print(f"  type-token ratio    {r['ttr']:.3f}   hapax {r['hapax']:.2f}")

    print("\n  checks")
    for tag, msg in verdict(r):
        print(f"    [{tag}] {msg}")

    print("\n  perplexity          NOT MEASURED. Every local model is instruction-tuned")
    print("                      and will not continue prose, so any number would be")
    print("                      an artefact. See the note at the top of this file.")


if __name__ == "__main__":
    main()
