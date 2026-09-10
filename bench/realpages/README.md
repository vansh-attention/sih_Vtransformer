# Real-page drill

```bash
node --experimental-strip-types bench/realpages-drill.ts
```

Four real websites, saved as HTML: Wikipedia (long article), python.org, Hacker News,
rbi.org.in (Indian government).

**Why this exists:** every other page we test — *including the holdout* — is a fixture we
wrote. The finale gives us unseen real sites, so a corpus of our own tidy HTML is the
weakest evidence in the project.

There is no ground truth here; nobody can hand-label a real page's PII at this scale.
What this asserts is that the pipeline **survives**: bounded time, bounded memory, no
crash, no vault value in the payload, and something actionable still in the tree.

## What it found immediately

Wikipedia reported **56 values "withheld"** on an encyclopedia article containing no
personal data at all. Three distinct bugs, none visible on any fixture:

**1. Entire paragraphs replaced by a single token.** *"As of May 2023, more than 99.9% of
India's adult population…"* became `<PII_NAME_1>`. The "field is labelled sensitive, so
replace the whole value" rule was firing on prose. A label vouches for the value of a
FIELD; a paragraph has no label vouching for it. That rule is now restricted to actual
form controls and short values.

**2. Single common words redacted as names** — `"For"`, `"Not"`, `"Bill"`, `"Justice"`.
All are genuine given names *and* ordinary English words. A lone gazetteer hit now scores
below the redaction threshold: one Title-Case token is not evidence of a person.

**3. Institutions treated as people** — `"Lok Sabha"`, `"Pragati Programme"`. Added to
the organisation markers, alongside the corporate suffixes already there.

**56 → 9 on Wikipedia**, with no change to either scored corpus.

## What still gets flagged, and why it is left

Wikipedia still redacts about nine items, most of them real person names in the article
text — `"Amit Shah"`, `"Ajit Doval"`. **The detector is not wrong**: those are person
names. Whether a public figure's name in an encyclopedia should be redacted is a product
judgement, not a detection failure, and there is no cheap signal that separates "public
figure in an article" from "the user's name in a form".

We leave it redacting. On the pages this product actually targets — forms, dashboards,
portals — a name is far more likely to be the user's than a public figure's, and the cost
of the mistake is asymmetric: over-redacting an encyclopedia costs some context, while
under-redacting a form leaks a real person.

One genuine false positive remains: python.org carries a 15-digit number that passes the
Luhn check and is redacted as a card. That is the checksum working exactly as designed
and colliding anyway. Recorded rather than special-cased.

## Refreshing the pages

They are saved HTML, so they will drift from the live sites. That is fine — they are a
robustness drill, not a correctness oracle. To refresh, re-fetch with `curl -sL` into
this directory.
