# The benchmark

```bash
node --experimental-strip-types bench/score.ts            # tuned corpus
node --experimental-strip-types bench/score.ts --holdout  # the sacred set
node --experimental-strip-types bench/leak-test.ts        # the hard invariant
node --experimental-strip-types bench/agent-loop.ts "goal"  # end-to-end with the model
```

## Results — 10 Sep 2026

| metric | weight | tuned | **holdout** |
|---|---|---|---|
| visual context accuracy | 25% | 100.0% | **100.0%** |
| PII detection recall | 20% | 100.0% | **91.7%** |
| PII detection precision | 20% | 100.0% | **100.0%** |
| redaction precision | 20% | 100.0% | **100.0%** |
| vault leaks | — | **0** | **0** |

### What PII layer 3 (names) actually buys

Measured, not assumed — `--no-layer3` runs the counterfactual:

| | recall | precision | F1 |
|---|---|---|---|
| tuned, layer 3 **off** | 88.9% | 100.0% | 94.1% |
| tuned, layer 3 **on** | **100.0%** | **100.0%** | **100.0%** |
| holdout, either way | 91.7% | 100.0% | 95.7% |

Layer 3 costs **1 MB** and closes an 11-point recall gap on names in prose. It changes
nothing on the holdout, for the reason below.

`bench/pages/casenote.html` exists specifically to make this measurable: every other
fixture gives its names a labelling cue, so layers 1–2 catch them and layer 3's
contribution never shows in the numbers.

The holdout number is the honest prediction for the finale's unseen sites. Quote that
one, not the tuned one.

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

## The one open failure — and why layer 3 did not close it

```
support-ticket: raiser: MISSED NAME (leak)
```

A person's name under a `<dt>` that never says "name". Layer 3 was built for exactly
this case and **still misses it** — measured, not assumed:

```
given  "Ananya"   in gazetteer: false
family "Krishnan" in gazetteer: false
```

That name is in **none of the three public datasets** tried, including a 30,000-entry
Indian-names corpus. Adding more lists did not fix it and should not be expected to.

**This is the ceiling of the gazetteer approach, and it is structural.** A list only
knows names on the list. Only a model that generalises to unseen names closes the tail,
and that model is `bert-base-NER` at **103 MB** int8 — over 4x the extension's entire
footprint, for one class, against a resource metric worth 20%.

The failure stays red. It is the honest measurement of a real trade-off, and it is worth
more to a judge than a keyword hack that turns the number green while fixing nothing.

**Recommendation:** ship as-is. If arbitrary-name recall becomes a requirement, the
103 MB model is the answer and the trade should be made deliberately, not by accident.
