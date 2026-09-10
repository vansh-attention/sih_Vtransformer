# sih_Vtransformer

**SIH 2026 · SIH26171 — On-device Visual Perception for Light-weight Browser Agents**
ISRO / Department of Space · Software · Smart Automation

A browser extension where a small vision model runs **on the client**, reads the screen,
and strips every piece of PII **before any network request is made**. Only sanitized
context reaches the server-side VLM, which reasons about it and returns a UI action the
client executes locally.

The server does the thinking. It never learns your PAN, your account number, or what
you look like.

---

## Start here

**`RESUME.md`** — current state, the rubric, the architectural bet, and the list of
findings that must not be regressed. Read it before touching anything.

**`PLAN.md`** — the 20-day sprint, milestones and gates.

**`spikes/a-webgpu-vit/FINDINGS.md`** — measured performance data that decided the model
choice.

## Setup

```bash
npm install
node setup.mjs     # vendors ONNX Runtime + downloads model weights (~230MB, not in git)
node build.mjs     # bundles the extension into extension/dist/
```

Run the test suite:

```bash
for f in extension/src/pii/*.test.ts extension/src/content/*.test.ts bench/leak-test.ts; do
  node --experimental-strip-types "$f"
done
```

Render the Privacy Ledger demo artifact:

```bash
node --experimental-strip-types bench/render-ledger.ts   # -> bench/out/ledger.html
```

## The scoring rubric — it drives every decision

| Weight | Metric |
|---|---|
| 25% | Accuracy of visual context from screen |
| 20% | Recall + precision of PII detection |
| 20% | Precision of redaction |
| 20% | Client-side resource utilization |
| 15% | End-to-end latency |

**40% is privacy handling. 35% is efficiency. Only 25% is vision quality.** This is an
on-device engineering contest with a privacy-correctness bar — not a "whose model is
smartest" contest.

## Two constraints that decide the result

1. **Evaluation sites are revealed only at the finale.** Anything tuned to a specific
   site is worthless. **No hardcoded selectors, anywhere, ever.**
2. **Chrome AND Firefox** are both named in the PS. Firefox's WebGPU trails Chrome's, so
   the WASM fallback is not a nicety — it *is* the Firefox story.

## Architecture

**The screen is not just pixels. It is a DOM.**

- **DOM = structure layer.** Exact labels, field types, coordinates, enabled/disabled
  state. Free, instant, zero OCR error.
- **Vision model = visual layer.** Only where the DOM is blind: images, canvas, video,
  cross-origin iframes, embedded PDFs, and confirming what is *actually* visible.
- The vision model runs on **crops, not the whole page**.

This raises accuracy while cutting RAM and latency at the same time.

### PII detection is a three-layer cascade

1. **DOM semantics** — `input[type=password]`, `autocomplete` attributes, ARIA labels.
   Near-perfect precision, zero cost.
2. **Patterns with checksums** — Aadhaar (Verhoeff), cards (Luhn), GSTIN (mod-36), PAN,
   IFSC, UPI. Measured: the checksum gate drops random 12-digit strings from 100% to
   **8.08%** — a ~12x false-positive reduction at zero recall cost.
3. **Small ML model** — names and addresses, which have no fixed shape.

`reconcile()` in `extension/src/pii/dom.ts` is the seam where recall and precision get
traded against each other. That seam is 40% of the grade.

### Redaction: replace the value, keep the shape

Never black out a region. Mint a typed placeholder — `<PII_PAN_1>` — so the server can
reason *"the PAN field is populated and valid"* while blind to the value. That is the
PS's "server aware of the redaction scheme" requirement, satisfied structurally.

The token → value vault never leaves the browser. `Vault.toJSON()` **throws**, so any
attempt to serialize it fails loudly at the call site instead of quietly shipping every
secret to the server.

## The Privacy Ledger

`extension/src/ledger/` renders a panel showing, side by side, what was on screen versus
the exact bytes transmitted — plus the raw payload to inspect.

Every team will *claim* their pipeline is private. This lets a judge *check* it.

The ledger stores masked shadows only (`ABCPE1234F` → `AB•••••••F`), never real values —
a persistent searchable record of every secret on your screen would be worse than the
problem it solves.

## Measured so far

| | |
|---|---|
| Aadhaar checksum gate | random 12-digit strings: 100% → **8.08%** |
| MobileViT fp32 / WebGPU | **10 ms** per crop ← operating point |
| MobileViT fp32 / WASM | 45 ms (the Firefox fallback, quantified) |
| MobileViT int8 / WebGPU | 103 ms — **quantisation is 10x SLOWER here** |
| ViT-base int8 / WebGPU | 325 ms — ruled out |
| Leak test | 10 secrets in vault, **0 present** in the payload |

Numbers measured on Apple Silicon / metal-3, headless Chrome 152. They must be
re-measured on a low-end laptop before any of them goes on a slide.
