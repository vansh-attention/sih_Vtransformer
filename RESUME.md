# SIH 2026 — SIH26171 — On-device Visual Perception for Light-weight Browser Agents

**READ THIS FIRST.**

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

### Still to build
- **Spike A2** — ORT Web + WebGPU under MV3 CSP in an offscreen document
- **Spike C** — `captureVisibleTab` pixels aligned with the DOM snapshot
- The extension shell itself (manifest, service worker, offscreen document, content script)
- Vision layer: MobileViT on crops, face detection, visibility verification
- Phase 2 (server + closed loop) and Phase 3 (benchmark + holdout)

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
