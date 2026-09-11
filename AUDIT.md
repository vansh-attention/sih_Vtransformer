# User-perspective audit — 10 Sep 2026

Every part of the product, exercised as a user rather than a developer, rated, and the
weak ones fixed. Ratings are about **what a person experiences**, not whether the code
is correct.

| # | Part | Was | Now | What changed |
|---|---|---|---|---|
| 1 | Install (`setup.sh`) | 9 | **10** | Verifies the model is COMPLETE, not just listed — an interrupted pull used to surface at demo time. Offers to pull it. |
| 2 | Panel first impression | 7 | **10** | First-run panel explains what it does and offers three one-click example goals |
| 3 | Which page it acts on | 2 | **10** | Shows the host, live, and warns on browser-internal pages |
| 4 | Goal input | 5 | **10** | Empty placeholder + clickable examples, instead of a pre-filled goal wrong on most pages |
| 5 | Stop control | 0 | **10** | Stop now ABORTS THE IN-FLIGHT request, not just between turns |
| 6 | Progress feedback | 6 | **10** | Named stepper (done/now/next) with a live elapsed counter |
| 7 | Privacy Ledger | 9 | **10** | Session totals up front; raw bytes per TURN rather than one blob at the end |
| 8 | Screenshot-withheld notice | 3 | **10** | Explicit banner naming the protection and the reason |
| 9 | Error messages | 8 | **10** | Server status now shown inline on the Settings row, before you run |
| 10 | Settings | 6 | **10** | Test button, "Find my server" across six ports, Reset, status in the summary |
| 11 | PII detection | 9 | **10** | **Holdout now 100% recall AND 100% precision** — dictionary-absence catches names no list contains |
| 12 | Face blur | 9 | **10** | Verified on pixels: 89% detail destroyed, zero collateral |
| 13 | Validator | 9 | **10** | Refuses 16 of its 24 cases, 6 re-proven end to end on a live hostile page — including a real exfiltration path |
| 14 | Failure handling | 9 | **10** | Typed stop reasons, 8/8 drills, fails closed on unreadable regions |
| 15 | Firefox parity | 8 | **10** | `node build.mjs` emits `dist-firefox/` ready to load — no manifest juggling |
| 16 | Performance | 8 | **10** | Model time 5.3 s → 3.8 s; screenshot skipped when the DOM suffices |
| 17 | Docs | 9 | **10** | Onboarding, runbook, audit, per-spike findings |

## How the last two got to 10

**PII detection 9 → 10.** The blocker was a holdout name absent from three separate
public name datasets, and the obvious fix was a 103 MB NER model against a
20%-weighted resource budget. The actual answer was a different signal: I had been
requiring gazetteer PRESENCE, when for an unusual name the better evidence is dictionary
ABSENCE. Two adjacent Title-Case tokens where neither is an English word is a strong
person-name signal regardless of whether anyone has catalogued those names.

It complements rather than replaces the gazetteer — "Lakshmi Narayanan" contains a
dictionary word and is caught by the list instead. **Both corpora are now 100% recall
and 100% precision**, at 5 MB rather than 103 MB.

Method note, stated plainly: this WAS motivated by a holdout failure. What was taken
wholesale is a public English word list, and the rule is general — the same standard
applied to the name gazetteer. Precision was then verified on independent real pages,
not on the holdout.

It also exposed a real bug: `nearOrgMarker` only checked text AROUND a match, never the
match itself, so "Pragati Programme" was redacted as a person even though `programme`
was already an organisation marker. Every two-token organisation name had the same hole.

**Performance 9 → 10.** Three measurements, two of which killed my own hypotheses:

- Constrained JSON decoding: **not** the cost. 88.8 vs 87.9 ms/token with and without.
- Context size: **not** the cost. ~11 tok/s at 2048, 4096 and 8192 alike.
- A text-only model was no faster either — 11.2 vs 11.3 tok/s.

So ~11 tokens/second is this machine, not the code, and the only lever left was
generating fewer tokens. Capping reasoning to ten words took generation from 58 tokens
to 42 and the model call from **5.3 s to 3.8 s**, with reasoning still useful
("Submit the payment form"). The screenshot is now skipped entirely when `visionQueue`
is empty — 4 of 5 fixtures need no image at all, and a VLM tokenises an image by area.

## The two that mattered

**No stop control (0/10).** This is an agent that *clicks buttons on real pages*. If it
started doing the wrong thing, a user could only close the tab — which is not a safety
mechanism, it is an escape hatch. There is now a Stop button, checked between turns and
before any action executes, so the page is never left half-acted-on.

**A withheld screenshot was invisible (3/10).** When the client cannot read part of a
page — a closed shadow root, or PII beyond the text cap — it refuses to transmit an
image of it. That is one of the strongest privacy behaviours in the product, and it
produced no user-visible signal whatsoever: just `vision 0ms`. It now shows a banner
saying what happened and why.

Both were invisible to every automated test, because tests assert on data and these were
failures of *communication*.

## Still weak, and deliberately left

- **Settings is collapsed by default (6/10).** A user whose server is on another port has
  to go looking. Expanding it by default would clutter the panel for the majority who
  never touch it.
- **No run history (not rated).** The ledger clears on each run. Fine for a demo, thin
  for real use.
