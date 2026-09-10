# Spike A1 — ORT Web + WebGPU in the browser

Run: 10 Sep 2026 · Chrome 152 headless · Apple Silicon, WebGPU adapter `apple / metal-3`
Reproduce: `./run.sh` (serves, drives headless Chrome, writes `result.json`)

## Result

| model | size | input | backend | session | warm-up | **median** |
|---|---|---|---|---|---|---|
| vit_base_int8 | 84.2 MB | 224² | webgpu | 177 ms | 333 ms | **324.6 ms** |
| vit_base_int8 | 84.2 MB | 224² | wasm | 54 ms | 272 ms | **258.8 ms** |
| mobilevit_fp32 | 21.6 MB | 256² | **webgpu** | 51 ms | 224 ms | **10.0 ms** ✅ |
| mobilevit_fp32 | 21.6 MB | 256² | wasm | 35 ms | 52 ms | **45.0 ms** |
| mobilevit_int8 | 6.0 MB | 256² | webgpu | 76 ms | 116 ms | **103.0 ms** |
| mobilevit_int8 | 6.0 MB | 256² | wasm | 62 ms | 55 ms | **55.6 ms** |

## What this changes

**1. Quantisation HURTS on WebGPU. This is the opposite of the obvious move.**

MobileViT fp32 runs in 10 ms on WebGPU; the same network quantised to int8 takes
103 ms — **ten times slower at a quarter of the size**. ORT's WebGPU backend has no
native int8 matmul path, so a quantised graph gets dequantised with extra operators and
ends up doing more work, not less. On the GPU, fp32 is the native path.

Any team that reflexively ships the smallest int8 file will land on the slow config and
never know why. We have the measurement.

**2. Architecture matters far more than parameter count.**

ViT-base int8 at 84 MB: 259–325 ms. MobileViT fp32 at 21.6 MB: 10 ms.
**~30x faster at a quarter of the size.** ViT-base is out — it cannot serve more than
one crop per page inside any sane latency budget.

**3. WebGPU is not automatically the right backend.**

For ViT-base int8, WASM (258.8 ms) beat WebGPU (324.6 ms) — GPU transfer overhead
dominates when the model is a poor GPU fit. WebGPU only wins decisively for the
architecture and precision that suit it. The PS says "e.g. via WebGPU"; it is a
suggestion, not an instruction, and we should say why we chose what we chose.

## The operating point

**MobileViT-class, fp32, on WebGPU. ~21 MB, ~10 ms per crop.**

At 10 ms we can afford 10–20 crops per page and still leave room in the latency budget
(15% of the grade). The WASM path at 45 ms is 4.5x slower but perfectly usable — which
is exactly the Firefox fallback story, so that gap is now quantified rather than hoped
at.

## Caveats — do not over-claim these numbers

- Measured on **Apple Silicon with a metal-3 adapter**. A judge's laptop with integrated
  Intel graphics will be slower, possibly much slower. Re-measure on a weak machine
  during M6 before any number goes on a slide.
- Headless Chrome. Headed rendering competes for the same GPU.
- Random input tensors: this measures cost, not accuracy.
- Still unanswered: **A2 — does any of this survive Manifest V3's CSP inside an
  offscreen document?** That is the next spike and the remaining architectural risk.

## Two traps this spike cost us, worth not repeating

1. **`ort.env.wasm.wasmPaths` resolves relative to the ORT module, not the page.**
   Setting `'./ort/'` produced `/ort/ort/...` and every backend failed with a
   misleading "no available backend found". Use an absolute path.
2. **Declared ONNX input metadata cannot be trusted.** MobileViT reports
   `[1,3,224,224]` while its exported graph contains a reshape hard-coded for 256².
   Feeding 224 fails deep inside with an opaque `OrtRun` error that names neither the
   input nor the expected size. Always print the full error, never a truncated one.
