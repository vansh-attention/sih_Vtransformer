# SIH 2026 — SIH26171 — On-device Visual Perception for Light-weight Browser Agents

**READ THIS FIRST.**

| file | what it is |
|---|---|
| `test-all.sh` | **Run everything.** `--full` adds real browsers + the live model. |
| `ONBOARDING.md` | Send this to a teammate. Explains the project + `./setup.sh`. |
| `RUNBOOK.md` | The demo. Print it. **Pre-warm the model.** |
| `deck/` | The 6-slide SIH submission. `python3 deck/build.py` rebuilds it. |
| `bench/README.md` | The scorecard and the holdout rule. |
| `spikes/*/FINDINGS.md` | Why the architecture is what it is, with measurements. |

**Before uploading the deck, three fields must come from the SIH portal** — they are
rendered in amber with «guillemets» so they cannot be missed: Theme, Team ID, Team Name.
Re-export the PDF from PowerPoint after filling them, not from the copy in `deck/`.

ISRO / Department of Space · Software · Smart Automation
Idea submission deadline: **30 September 2026** · Grand finale: **December 2026**

## Where we are — 10 Sep 2026

Phase 1 (privacy spine) is **substantially built and green**. No AI involved yet, which
is the point: this is 40% of the rubric and needs none.

Run the suite: `node --experimental-strip-types <file>.test.ts` for each of the three.
All three pass as of 10 Sep.

| File | What it is | State |
|---|---|---|
| `extension/src/contracts.ts` | The three frozen wire schemas | done — **do not change without telling the team** |
| `extension/src/pii/checksums.ts` | Verhoeff / Luhn / GSTIN / structural validators | 14/14 pass |
| `extension/src/pii/patterns.ts` | Layer 2 scanner + overlap resolution | working |
| `extension/src/pii/dom.ts` | Layer 1 DOM semantics + `reconcile()` | 12/12 pass |
| `extension/src/content/extractor.ts` | DOM → `PageStructure`, stable IDs, node budget | 9/9 + 9 verdicts pass |
| `extension/src/redact/vault.ts` | Token↔value store, `toJSON()` tripwire | done |
| `extension/src/redact/sanitize.ts` | `PageStructure` → `SanitizedPayload` | done |
| `bench/pages/checkout.html` | Fixture 01, with deliberate decoys | done |
| `extension/src/ledger/ledger.ts` | Privacy Ledger store — masked previews only | done |
| `extension/src/ledger/render.ts` | Self-contained HTML panel, zero deps | done |
| `bench/leak-test.ts` | **THE INVARIANT TEST** | no leaks; all invariants hold |
| `bench/render-ledger.ts` | Writes `bench/out/ledger.html` | done |

## Spike A1 — DONE, and it changed the plan

Full write-up: `spikes/a-webgpu-vit/FINDINGS.md`. Reproduce with `./run.sh`.

**The model choice is settled: MobileViT-class, fp32, on WebGPU. ~21 MB, ~10 ms/crop.**

Three measured findings that are worth more than the number itself:

1. **Quantisation HURTS on WebGPU.** MobileViT fp32 = 10 ms; the same net at int8 =
   103 ms. Ten times slower at a quarter of the size — ORT's WebGPU backend has no
   native int8 matmul, so a quantised graph gets dequantised and does *more* work.
   Any team that reflexively ships the smallest int8 file lands on the slow config.
2. **Architecture beats parameter count.** ViT-base int8 (84 MB) = 259–325 ms.
   MobileViT fp32 (21.6 MB) = 10 ms. ~30x faster at a quarter of the size. ViT-base
   is OUT.
3. **WebGPU is not automatically right.** For ViT-base int8, WASM *beat* WebGPU
   (258.8 vs 324.6 ms). It only wins for the architecture and precision that suit it.

WASM fallback measures 45 ms — 4.5x slower, still usable. That is the Firefox story,
now quantified instead of hoped at.

⚠ Measured on Apple Silicon / metal-3, headless. **Re-measure on a weak laptop in M6
before any number goes on a slide.**

### Chrome
Installed but sitting on the **Desktop**, not in `/Applications`:
`/Users/harshbajpai/Desktop/Google Chrome.app`. Scripts reference it via `$CHROME`.

### Next spike — A2, the remaining architectural risk
Does ORT Web + WebGPU still work under **Manifest V3's CSP** (no `unsafe-eval`, no
remote code) inside an **offscreen document**? The service worker has neither DOM nor
WebGPU, so the offscreen document is the only place this can live. Unanswered.

Run everything:
```bash
for f in extension/src/pii/*.test.ts extension/src/content/*.test.ts bench/leak-test.ts; do
  node --experimental-strip-types "$f"
done
```

**Measured:** the Aadhaar checksum gate drops random 12-digit strings from 100% to
**8.08%** — a ~12x false-positive reduction at zero recall cost.

## Phase 2 — the loop is CLOSED, with one test honestly RED

`real page -> extract -> sanitize -> server -> validate -> actions` runs end to end.

**Local model, no cloud.** Ollama on this M5's Metal GPU serves an open-weight VLM, so
the whole system demonstrates with the network off — which is a much stronger answer to
the PS's offline-deployable requirement than a URL into somebody's cloud. Same code
targets vLLM for the finale; only `OLLAMA_URL`/`AGENT_MODEL` change.

```bash
cd server && .venv/bin/uvicorn main:app --port 8975      # reasoning server
node --experimental-strip-types bench/agent-loop.ts "Submit the payment form"
```

### The redaction scheme WORKS — measured, not asserted

A token means *"this field is filled in with a valid value of that type."* If the model
reads it as empty-or-broken it tries to re-fill it, **overwriting the user's real data
with a guess**. That is the central failure mode of this entire design, so
`bench/agent-loop.ts` asserts against it directly.

| model | re-fills a populated field? | warm latency |
|---|---|---|
| `llama3.1:latest` (text-only 8B) | ❌ **YES** — "Fill in your full name" on an already-filled field | 2.6 s |
| `qwen2.5vl:7b` | ✅ **NO** | **2.5 s** |

Qwen also passes the discriminating case. Asked *"check whether every required field is
filled in, and tell me what is missing"* — the exact prompt that baits a model into
"filling" the redacted PAN — it instead scrolled to look for more fields. It understood
that the tokens meant DONE.

**This is the PS's "server aware of the redaction scheme" requirement, demonstrated
end to end.** The model directed the agent correctly while structurally unable to see a
single real value.

The validator held throughout regardless: it refused llama3.1's bad action twice over
(no value, and "refusing to overwrite redacted value with literal text"). Defence in
depth is not decorative here — a weaker model on the day would still be safe.

### ⚠ Pre-warm the model before any demo

**Cold: 17.0 s. Warm: 2.5 s.** The first request pays for loading 6 GB into unified
memory. A judge timing a cold first request sees 17 seconds and stops watching.

Fire one throwaway request before the demo starts. This goes in the M6 runbook.

Latency budget today: extract 45 ms + sanitize 6 ms + **model 2.5 s**. The model is
~98% of end-to-end time, so latency work means model work — vLLM on a real GPU for the
finale — not client micro-optimisation.

## Vision layer — face redaction VERIFIED on pixels

Full write-up: `spikes/d-face-redaction/FINDINGS.md`.
Model: **UltraFace RFB-320**, 1.2 MB, MIT. Size was the deciding factor — client
resources are 20% of the grade.

```
face detected  : score 1.00, webgpu, 53.6 ms warm (437 ms cold)
detail inside  : variance 3195.88 -> 343.58  =  89.2% destroyed
outside the box: 5 control points, ALL delta 0
VERIFIED       : true
```

Both halves hold: the face is destroyed AND nothing else is touched. A blur that smears
the whole frame would pass a naive check while wrecking the visual context worth 25%.

Design decisions that came out of building it:
- **Grow the box 25% before blurring.** UltraFace boxes are tight on the features and
  leave hair, ears and jawline outside — all identifying. A tight blur de-identifies
  nothing while looking diligent.
- **Blur radius scales with face size** (`max(8, min(w,h)/4)`). A fixed radius leaves
  large faces recognisable.
- **Letterbox padding is mid-grey (127)**, which normalises to 0. Black padding reads as
  a strong edge and invents detections along the border.

### ⚠ A verification lesson worth keeping
The first version of this test asserted that pixels inside the face box must CHANGE by
>10, and it FAILED while the blur was working perfectly. One sample sat on flat skin
tone — blur averages neighbours, so over a uniform region the average IS the original.
The test measured pixel displacement when the property that matters is detail
destruction. Replaced with luma variance.

**A red test is not automatically a real defect.** It is worth one round of asking
whether the assertion encodes the property you actually care about.

## Phase 3 — THE SCORECARD

`bench/README.md` has the detail. One command prints all five rubric numbers.

| metric | weight | tuned | **holdout** |
|---|---|---|---|
| visual context accuracy | 25% | 100.0% | **100.0%** |
| PII detection recall | 20% | 100.0% | **91.7%** |
| PII detection precision | 20% | 100.0% | **100.0%** |
| redaction precision | 20% | 100.0% | **100.0%** |
| vault leaks | — | **0** | **0** |

**Quote the holdout column, never the tuned one.** It is the honest prediction for the
finale's unseen sites.

### The holdout paid for itself immediately
Redaction precision was **22.2%** on first contact, against 100% tuned. An element's own
text was being used as evidence about what that text is: `<td>Applicant Name</td>`
contains "name", so the cell was classified as a NAME and replaced with a token. Every
label cell in a table-layout form was being destroyed — the exact markup Indian
government forms use, and the exact markup the tuned set happened not to contain.

Evidence about a value must come from somewhere OTHER than the value. `signalsFor` now
uses only borrowed names. **22.2% → 100%.**

### One failure left RED on purpose
`<dt>Raised by</dt><dd>Ananya Krishnan</dd>` — a name under a label that never says
"name". Layer 1 needs a cue, layer 2 needs a pattern, and a bare human name has neither.
That needs **PII layer 3 (NER)**.

Adding "raised by" to the keyword list would fix the number and fix nothing real. That
is tuning against the holdout, and the finale will not use our keywords.

## The extension WORKS end to end — Spike E

`spikes/e-e2e/FINDINGS.md`. Real extension, real page, real loop, in a real browser.

```
observing -> redacting -> reasoning -> validating -> acting -> re-observing
TURN 1: clicked "Pay now", page navigated. 9 values withheld.
        extract 3ms | sanitize 7ms | vision 473ms | model 3032ms | TOTAL 3541ms
TURN 2: vision 69ms (warm) | model 3952ms
```

**Demo it:** click the toolbar icon → side panel → type a goal → Run.
Server must be up: `cd server && .venv/bin/uvicorn main:app --port 8975`.
**Pre-warm the model first** (17s cold, 2.5s warm).

Where the time goes: the model is ~85% of a turn. Vision is 69ms warm. Extract +
sanitize are under 10ms combined. Latency work means the model, not the client.

⚠ Payload is **156KB, almost all screenshot**. Downscale before the finale.

### The architecture claim, stated precisely
The **vault lives in the content script**. The background service worker — the only part
that touches the network — has never held a real value. "No PII leaves the machine" is a
property of the architecture, not a claim about one function's correctness. A bug in the
network layer *cannot* leak a PAN, because that layer has never seen one.

### Still to build
- **PII layer 3 (NER)** — the one red holdout test
- MobileViT on crops for non-face visual context (images, canvas, iframes)
- Downscale the screenshot before transmission
- Wire the loop into the extension itself (it currently runs through the bench harness)
- Screenshot into the payload (the prompt already supports it; nothing sends one yet)
- Phase 3: benchmark harness + the holdout run

### Five findings already paid for — do not regress them
1. **A positive PII keyword must beat negative context.** The label
   "PAN (for invoices above ₹2 lakh)" contains both "pan" and "invoices". Demoting on
   the negative word let a real PAN through. False negatives are the expensive kind.
2. **`<label>` elements must not enter the tree.** Their text is already the control's
   accessible name. Removing them cut the fixture from 36 nodes to 27 (~25%) and
   stopped every field being PII-scanned twice.
3. **Scan direct text only, never `el.textContent`.** The latter concatenates
   descendants, so a container re-reports every child's PII. The sanitizer must follow
   the same rule when it is written.
4. **A field hint may DEMOTE label text but never promote or replace it.** Applying the
   hint fully to labels blanked "Aadhaar Number" into a token and destroyed the context
   the server needs. Labels get demotion-only; values get the full hint.
5. **Redaction must be vault-global, not per-node.** If the same value appears twice and
   only one occurrence sits in a PII context, the per-node pass redacts one and leaks
   the other. `sweepVaultLeaks()` runs as a second pass after the vault is complete.
   Caught by the leak test's normalised check, which the per-node pass could not see.

## What the PS actually asks for

A browser extension where a **small vision model runs on the client**, reads the screen,
**strips every piece of PII before any network request**, and sends only the sanitized
context to a bigger open-weight VLM on a server. The server returns a UI action
(`click`, `scroll`, `type`) which the client executes locally.

The server must be **open-weight and offline-deployable** — no proprietary API.
Cloud-hosted copies of open models are allowed during SIH itself.

## The scoring rubric — memorise this, it drives every decision

| Weight | Metric |
|---|---|
| 25% | Accuracy of visual context from screen |
| 20% | Recall + precision of PII detection |
| 20% | Precision of redaction |
| 20% | Client-side resource utilization |
| 15% | End-to-end latency of the task |

**40% is privacy handling. 35% is efficiency. Only 25% is vision quality.**
This is an on-device engineering contest with a privacy-correctness bar — not an
"which model is smartest" contest. Do not reach for a bigger model to fix a problem.

## Two constraints that decide the result

1. **Evaluation use cases are revealed only at the finale.** Anything tuned to a
   specific site is worthless. **No hardcoded selectors, anywhere, ever.**
2. **Chrome AND Firefox** are both named in the PS. Firefox WebGPU lags Chrome, so
   the WASM fallback path is not optional — it *is* the Firefox story.

## The core architectural bet

The screen is not just pixels — it is a DOM.

- **DOM = structure layer.** Exact labels, field types, coordinates, enabled/disabled
  state. Free, instant, zero OCR error.
- **Vision model = visual layer.** Only where the DOM is blind: images, canvas, video,
  cross-origin iframes, embedded PDFs, and confirming what is *actually visible*.
- The ViT runs on **crops, not the whole page**.

This raises accuracy (25%) while cutting RAM (20%) and latency (15%) at the same time.
The vision model still does load-bearing work — the PS requires it and judges will
check — but it never redoes work the DOM already did for free.

## Redaction rule: replace the value, keep the shape

Never black out a region. Mint a **typed placeholder** — `<PII_PAN_1>`,
`<PII_AADHAAR_1>`, `<PII_NAME_1>`. The server is told the scheme, so it can reason
"the PAN field is populated and valid" without ever seeing the value.

The token→value vault lives in a client-side `Map` and is **never serialized into any
request**. There is an automated test for this (see `bench/`); it must never be skipped.

## Directory map

```
extension/src/content/    DOM extractor, action executor, page overlay
extension/src/offscreen/  ONNX inference host (has DOM + WebGPU; the service worker does not)
extension/src/background/ MV3 service worker: orchestration, the only network egress point
extension/src/pii/        the cascade: dom.ts, patterns.ts, checksums.ts, ner.ts
extension/src/redact/     placeholder minting + the vault
extension/src/ledger/     Privacy Ledger UI
server/                   FastAPI + vLLM, constrained JSON actions
bench/pages/              labelled pages with PII ground truth — tune against these
bench/holdout/            SACRED. Nobody looks until M5.
spikes/                   M0 risk spikes
```

See `PLAN.md` for milestones and gates.

## Rules of engagement

- Every milestone gate is a **measured number**, not a demo that "looked fine".
- `bench/holdout/` is sacred. Nobody opens it before M5. Looking at it destroys the
  only honest signal we have about whether this generalizes.
- No hardcoded selectors. CI greps for them.
- Ship the privacy spine before any AI. It is 40% of the marks and needs no model.
