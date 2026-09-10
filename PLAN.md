# Build plan — SIH26171 — 20-DAY SPRINT

Read `RESUME.md` first.

**Decision (10 Sep 2026):** build the complete working prototype by **30 September**,
not by the December finale. Rationale: the internal college hackathon happens *before*
SPOC nomination and is judged on a live presentation — a working demo is what gets us
nominated at all. Everything after 30 Sep then goes into hardening and generalization.

Note for the record: the 30 Sep portal upload is a **6-slide PPT**, not a codebase.
Building early wins the *internal* round and buys runway; it does not itself change the
national screening input.

---

## The one decision that makes 20 days possible

**Freeze the wire contracts on day 1.** Three JSON schemas:

1. `PageStructure` — what the DOM extractor emits
2. `SanitizedPayload` — what actually crosses the network
3. `AgentAction` — what the server returns

Once these are frozen, all six people build against stubs in parallel and nothing
blocks anything. Six people on a codebase that does not exist yet fails by integration
hell, not by lack of effort. The contracts are the fix.

---

## Ruthless scope cuts

Everything that does not score gets deferred. Against the rubric:

**Non-negotiable (this is the whole grade):**
- PII cascade with checksums + typed placeholders — 40%
- Privacy Ledger — this is what *proves* the 40%
- An on-device ViT genuinely running under WebGPU — 25%, and the PS mandates it
- Resource + latency measurement — 35%
- Works on sites we never tuned against — the finale is unseen sites

**Deferred to October:**
- Firefox polish. Chrome for the demo; WASM fallback exists and is documented, not
  tuned. (The PS names Firefox — we own this gap and say so rather than hide it.)
- NER layer 3. Layers 1+2 with checksums carry most of the recall.
- Multi-step task chains beyond a hard iteration cap.

**Kept despite cost:** face detection. It is the most visually convincing thing in the
demo, and demos are what the internal round is judged on.

---

## Phase 0 · 10–13 Sep · spikes (Harsh is on IITM end-term 13 Sep — team only)

- Freeze the three wire contracts. Commit them before anything else.
- **Spike A:** int8 ViT under ONNX Runtime Web + WebGPU inside an MV3 **offscreen
  document**. The landmine is MV3's CSP forbidding `unsafe-eval` while the service
  worker has neither DOM nor WebGPU. *Gate: cold start, per-inference ms, peak MB.*
- **Spike C:** `captureVisibleTab` pixels + content-script structure, same instant,
  same coordinate space. *Gate: a DOM box lands on the right pixels.*
- Repo, TypeScript build, extension loads unpacked in Chrome.

If Spike A fails the architecture changes — which is exactly why it is on day 1.

## Phase 1 · 14–19 Sep · the privacy spine (no AI at all)

Highest value per day in the whole sprint: 40% of the rubric, zero ML required.

- DOM extractor → `PageStructure` with **stable element IDs**, never coordinates.
- PII layer 1 — DOM semantics: `input[type=password]`, `autocomplete` (`cc-number`,
  `tel`, `email`, `street-address`), aria-label / name / placeholder.
- PII layer 2 — patterns **with checksums**: Aadhaar (Verhoeff), PAN, card (Luhn),
  GSTIN, IFSC, UPI VPA, phone, email. The checksums turn a recall-heavy regex into a
  precision-heavy detector, and precision is scored **twice** (metrics 2 and 3).
- Placeholder vault + typed token minting (`<PII_PAN_1>`).
- Privacy Ledger v1 — on screen vs bytes sent, side by side.
- **The invariant test:** fuzz a page corpus, assert no vault value ever appears in any
  outbound body. Most valuable test in the project. Never skip it.

*Gate (19 Sep): a page with a real-shaped PAN, Aadhaar and password produces an
outbound payload containing zero real values — proven in the ledger AND the raw
network log.*

## Phase 2 · 20–24 Sep · closed loop + vision

- FastAPI + vLLM, Qwen2.5-VL class, **constrained decoding** to strict `AgentAction`.
- Client-side action validator — the server may never say "type into the password
  field". Every action checked before it executes.
- Loop: observe → sanitize → send → plan → validate → act → re-observe, hard cap.
- ViT on **crops only**: images, canvas, cross-origin iframes. Face detection on image
  regions. Visibility verification.

*Gate (24 Sep): a full task completes end to end on a site, screen → action →
executed, with the ledger showing what was withheld.*

## Phase 3 · 25–27 Sep · numbers and generalization

- Benchmark harness → all five rubric metrics from one command.
- **Open `bench/holdout/` for the first time.** Fix breakages **generically only** —
  if a fix needs a site-specific selector, the fix is wrong and the design changes.

*Gate (27 Sep): five rubric numbers on the tuned set and on holdout. The gap between
them is our honest prediction of finale performance, and it goes on a slide.*

## Phase 4 · 28–30 Sep · deck, video, submit

- 6-slide deck. `~/sih-kabadiwala/build.py` already fills the official SIH template
  programmatically — config change, not a rebuild.
- Demo video: the Privacy Ledger walkthrough, where a judge watches the PAN *not*
  leave. That converts a claim into an observable fact.
- Rehearse. Submit via SPOC.

Portal placeholders still needed: PS ID (SIH26171), Theme, Team ID, Team Name.

---

## Team split (6 people, all parallel from day 1 against stubs)

| Owner | Area |
|---|---|
| 1 | Extension platform — MV3, offscreen document, capture pipeline |
| 2 | DOM extractor, stable IDs, action executor, validator |
| 3 | PII cascade — layers 1–2, checksums, vault |
| 4 | On-device models — ONNX conversion, int8, WebGPU perf |
| 5 | Server — vLLM, prompting, constrained decoding |
| 6 | Benchmark harness, Privacy Ledger UI, deck and video |

## Standing rules

- **No hardcoded selectors, ever.** CI greps for them.
- **`bench/holdout/` is sacred until 25 Sep.** Looking early destroys the only honest
  signal we have about whether this generalizes to the finale's unseen sites.
- Every gate is a measured number, not a demo that looked fine.
