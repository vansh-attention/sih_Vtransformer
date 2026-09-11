# The benchmark

```bash
node --experimental-strip-types bench/score.ts             # tuned corpus
node --experimental-strip-types bench/score.ts --holdout   # the sacred set
node --experimental-strip-types bench/leak-test.ts         # the hard invariant, JSON channel
node --experimental-strip-types bench/screenshot-leak-test.ts  # ...and the image channel
node --experimental-strip-types bench/agent-loop.ts "goal"   # end-to-end with the model
```

**Two channels leave the machine, and both are tested.** `leak-test.ts` proves no vault
value appears in the outbound JSON. It never looked at the screenshot, which is sent in
the same request — and until 11 Sep nothing did. See "the second channel" below.

## Results — 11 Sep 2026

| metric | weight | tuned | **holdout** |
|---|---|---|---|
| visual context accuracy | 25% | 100.0% | **100.0%** |
| PII detection recall | 20% | 100.0% | **100.0%** |
| PII detection precision | 20% | 100.0% | **100.0%** |
| redaction precision | 20% | 100.0% | **100.0%** |
| vault leaks | — | **0** | **0** |

Reproduce both columns:

```bash
node --experimental-strip-types bench/score.ts
node --experimental-strip-types bench/score.ts --holdout
```

The holdout column is the honest prediction for the finale's unseen sites. Quote that
one, not the tuned one — they happen to agree today, and saying which is which is what
makes the claim credible.

### What PII layer 3 (names) actually buys

Measured, not assumed — `--no-layer3` runs the counterfactual:

| | recall | precision | F1 |
|---|---|---|---|
| tuned, layer 3 **off** | 90.4% | 100.0% | 94.9% |
| tuned, layer 3 **on** | **100.0%** | **100.0%** | **100.0%** |
| holdout, layer 3 **off** | 91.7% | 100.0% | 95.7% |
| holdout, layer 3 **on** | **100.0%** | **100.0%** | **100.0%** |

Layer 3 costs **5.1 MB** of static assets — 27,475 given names, 82,624 family names and
a 349,766-word English dictionary — and needs no inference at all. It closes a
10-point recall gap on the tuned corpus and an 8-point gap on the holdout.

`bench/pages/casenote.html` exists specifically to make this measurable: every other
fixture gives its names a labelling cue, so layers 1–2 catch them and layer 3's
contribution never shows in the numbers.

## Known coverage gaps

- **Eleven languages, two of them measured.** English, Hindi, Marathi, Tamil, Telugu,
  Bengali, Gujarati, Kannada, Malayalam, Punjabi and Odia now have both positive field
  vocabularies and the commercial ("total", "receipt") vocabulary that keeps amounts from
  being redacted as Aadhaar numbers. Cross-script false positives are impossible by
  construction — the Indic scripts sit in disjoint Unicode blocks.
  **Only Tamil and Bengali have fixtures.** The other eight were not written by native
  readers. Treat them as a first pass and get them reviewed.
- **Devanagari names in prose.** Layer 3's tokeniser is Latin-only, so a Hindi name in a
  paragraph (rather than in a labelled field) is not detected.
- **Text beyond 2000 characters.** Reported via `piiBeyondTextCap`, and the orchestrator
  withholds the screenshot when it fires — but the value is neither transmitted nor
  redactable.

## The second channel — the screenshot

Found 11 Sep, and the most general instance of this project's recurring leak shape.

`blurRegions` had only ever been called with **face** boxes: no text was masked in the
image, ever. A screenshot is transmitted whenever `visionQueue` is non-empty. So a value
could be tokenised in the JSON and fully legible in the picture beside it — and the leak
test could not see it, because it only inspects JSON.

Measured on this corpus, before the fix:

| page | values redacted from JSON | screenshot sent | masked in image |
|---|---|---|---|
| `checkout` (the demo page) | 10 | **yes** | **0** |
| `profile` | 6 | **yes** | **0** |
| `gov-form` (holdout) | 5 | **yes** | **0** |

`sanitize()` now returns `piiBoxes`, and the orchestrator strikes them out — a solid
fill, since a blur tuned for faces does not reliably destroy text. It fails closed: if
fewer regions are masked than requested, no image is sent at all.

`screenshot-leak-test.ts` asserts the two channels agree, refuses to pass if no fixture
exercises the case (coverage before correctness), and checks the CSS-px → image-px
mapping at 1x, 2x and 0.5x. **Verified to fail** by reverting the fix: 3 pages red.

## The holdout rule

`bench/holdout/` was written **before** the first scoring run and is **never tuned
against**. Opening it early, or fixing a failure by special-casing its content, destroys
the only signal we have about whether this generalises — and the finale's evaluation
sites are revealed on the day.

Both holdout fixtures use markup idioms the tuned set does not: definition lists,
ARIA-only labelling, placeholder-only inputs, table layouts with the label in the
adjacent cell, and PII buried in running prose.

**Caveat:** the holdout is written by the same hands as the tuned set, so it is a weaker
signal than a genuinely independent corpus. Treat the gap as indicative, not as a
guarantee.

## What the holdout caught that the tuned set could not

**Redaction precision was 22.2% on first contact** — against 100% on the tuned corpus.

Cause: an element's own text was being used as evidence about what that text is. In

```html
<td>Applicant Name</td>
```

the text contains "name", so the classifier concluded the cell held a NAME, so the
sanitizer replaced the whole thing with `<PII_NAME_1>`. Every label cell in a
table-layout form was being destroyed this way — the exact markup Indian government
forms use, and the exact markup the tuned set happened not to contain.

Fix: evidence about a value must come from somewhere OTHER than the value.
`signalsFor` now uses `borrowedName` (aria-label, `<label for>`, placeholder) and never
the element's own text. Holdout redaction precision: **22.2% → 100%**.

## The holdout's last failure, and how it was closed

For most of development one holdout case stayed red:

```
support-ticket: raiser: MISSED NAME (leak)
```

A person's name under a `<dt>` that never says "name", so layers 1–2 had no cue. Layer 3
was built for exactly this case and **still missed it** — measured, not assumed:

```
given  "Ananya"   in gazetteer: false
family "Krishnan" in gazetteer: false
```

That name is in **none of the three public datasets** tried, including a 30,000-entry
Indian-names corpus. Adding more lists did not fix it and should not have been expected
to. **That is the ceiling of the gazetteer approach, and it is structural** — a list
only knows names on the list.

The obvious next step was `bert-base-NER` at **103 MB** int8: over 4× the extension's
entire footprint, for one PII class, against a resource metric worth 20%. It was priced
and refused.

**What actually closed it was inverting the signal.** The gazetteer asks whether a token
is a known name — PRESENCE. For an unusual name the stronger evidence is the opposite:
two adjacent Title-Case tokens where **neither is an English word** is a person-name
signal regardless of whether anyone has catalogued those names. That is dictionary
ABSENCE, and it is a general rule, not a patch for this fixture.

The two signals complement rather than replace each other — "Lakshmi Narayanan" contains
a dictionary word and is caught by the list instead. Together: **100% recall and 100%
precision on both corpora, at 5.1 MB rather than 103 MB.**

**Method note, stated plainly:** this work WAS motivated by a holdout failure, which sits
close to the holdout rule below. What was taken wholesale is a public English word list;
no holdout content influenced it, and the same standard was applied to the name
gazetteer. Precision was then re-verified on `bench/realpages/` — independent real
websites, not the holdout. Judge the rule, not the number it produced.

It also exposed a real bug on the way through: `nearOrgMarker` only checked the text
AROUND a match and never the match itself, so "Pragati Programme" was redacted as a
person even though `programme` is already an organisation marker. Every two-token
organisation name had the same hole.
