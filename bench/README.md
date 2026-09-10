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

## The one open failure — deliberately not fixed

```
support-ticket: raiser: MISSED NAME (leak)
```

`<dt>Raised by</dt><dd>Ananya Krishnan</dd>` — a person's name under a label that never
says "name".

This is a **real limitation, not a bug**. Layer 1 needs a naming cue and layer 2 needs a
pattern; a bare human name with neither requires **PII layer 3 (NER)**, which is
scheduled and not yet built.

It stays red on purpose. Adding "raised by" to the keyword list would fix the number
and fix nothing real — that is tuning against the holdout, and the finale will not use
our keywords. **This failure is the measured case for building layer 3.**
