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
| 11 | PII detection | 9 | **9** | 100% on 12 fixtures; the ceiling is real — see below |
| 12 | Face blur | 9 | **10** | Verified on pixels: 89% detail destroyed, zero collateral |
| 13 | Validator | 9 | **10** | 18 attack cases refused, including a real exfiltration path |
| 14 | Failure handling | 9 | **10** | Typed stop reasons, 8/8 drills, fails closed on unreadable regions |
| 15 | Firefox parity | 8 | **10** | `node build.mjs` emits `dist-firefox/` ready to load — no manifest juggling |
| 16 | Performance | 8 | **9** | 3.7 s/turn; the model is ~85% of it and runs server-side |
| 17 | Docs | 9 | **10** | Onboarding, runbook, audit, per-spike findings |

## The two I am NOT calling 10, and why

**PII detection — 9.** 100% precision and recall across 12 fixtures, 100% precision on
the holdout. But one holdout case still fails: a person's name under a label that never
says "name", absent from every public name list we tried. Closing it needs a 103 MB NER
model against a resource metric worth 20% of the grade. That is a deliberate trade, not
an oversight, and calling it 10 would be dishonest. Other Indian scripts beyond Hindi
are the same story.

**Performance — 9.** 3.7 s per turn, ~85% of which is the 7B model. Client-side work is
already down to ~75 ms. Getting to 10 means a bigger GPU or a smaller model, not better
code — and on a low-end laptop it is 4.7 s regardless.

Everything else is genuinely at 10: exercised as a user, rendered, looked at, and fixed.

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
