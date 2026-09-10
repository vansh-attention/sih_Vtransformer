# User-perspective audit — 10 Sep 2026

Every part of the product, exercised as a user rather than a developer, rated, and the
weak ones fixed. Ratings are about **what a person experiences**, not whether the code
is correct.

| # | Part | Before | After | What was wrong |
|---|---|---|---|---|
| 1 | Install (`setup.sh`) | 9 | 9 | One command; already caught a real fresh-clone bug |
| 2 | Panel first impression | 7 | 8 | Clean, but nothing said what it would act on |
| 3 | **Which page it acts on** | **2** | **9** | **Nothing on screen said which tab. This agent clicks buttons.** |
| 4 | Goal input | 5 | 8 | Pre-filled with "Submit the payment form" — wrong on most pages, and unclear whether it was an example or live |
| 5 | **Stop control** | **0** | **8** | **There was none. The only way to halt a running agent was to close the tab.** |
| 6 | Progress feedback | 6 | 8 | A static line during a 3-second model call reads as a freeze |
| 7 | Privacy Ledger | 9 | 9 | The strongest part. Masks, counts, raw bytes |
| 8 | **Screenshot-withheld notice** | **3** | **9** | **The protection fired silently. The user saw "vision 0ms" and no reason.** |
| 9 | Error messages | 8 | 8 | "Server not running" prints the exact command to fix it |
| 10 | Settings | 6 | 6 | Collapsed by default; a user on another port must find it |
| 11 | PII detection | 9 | 9 | 100% on 11 fixtures, 100% precision on holdout |
| 12 | Face blur | 9 | 9 | Verified on pixels: 89% detail destroyed, nothing outside the box |
| 13 | Validator | 9 | 9 | 18 attack cases refused, incl. a real exfiltration path |
| 14 | Failure handling | 9 | 9 | Typed stop reasons, 8/8 drills |
| 15 | Firefox parity | 8 | 8 | Loads and runs; sidebar rather than side panel |
| 16 | Performance | 8 | 8 | 3.7 s/turn here, 4.7 s on a throttled machine |
| 17 | Docs | 9 | 9 | Onboarding, runbook, findings per spike |

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
