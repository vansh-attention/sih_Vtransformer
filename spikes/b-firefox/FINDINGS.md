# Spike B — Firefox

Run: 10 Sep 2026 · **Firefox 155.0 headless** · macOS Apple Silicon
Reproduce: `./run.sh` (reuses the Spike A1 harness unchanged, so numbers are comparable)

The PS names **Chrome AND Firefox**. Firefox's WebGPU trails Chrome's, so the question
was never "does it work" but "what does the fallback cost".

## Result: Firefox has NO WebGPU adapter — and it does not matter much

`navigator.gpu.requestAdapter()` returns null even with `dom.webgpu.enabled` and
`gfx.webgpu.force-enabled` set in the profile. Every WebGPU attempt fails with
`no adapter`, and the runtime falls through to WASM.

| model | backend | Chrome | Firefox | Firefox penalty |
|---|---|---|---|---|
| mobilevit_fp32 | **wasm** | 29.5 ms | **32.3 ms** | **+9%** |
| mobilevit_fp32 | webgpu | 7.6 ms | ✗ no adapter | — |
| mobilevit_int8 | wasm | 40.4 ms | 50.5 ms | +25% |
| vit_base_int8 | wasm | 184.3 ms | 195.5 ms | +6% |

## What this means

**Firefox is not a blocker.** On the chosen model it runs at **~32 ms per crop** — only
9% behind Chrome's own WASM path, and ~4x behind Chrome's WebGPU. At 32 ms we can still
process 10+ crops per page inside the latency budget.

So the story we tell is concrete rather than apologetic:

> Chrome gets WebGPU at ~8 ms/crop. Firefox has no WebGPU adapter on macOS, so it takes
> the WASM path at ~32 ms/crop. Both are inside budget. The fallback is automatic and
> the cost is measured.

This also validates the try-WebGPU-then-WASM ladder already in
`extension/src/offscreen/index.ts`: it is not defensive boilerplate, it is the only
reason Firefox works at all.

## ⚠ Caveat — this is HEADLESS Firefox

Headless browsers frequently have no GPU access. Chrome headless *did* expose a
`metal-3` adapter, so headless is not automatically fatal — but Firefox's headless mode
may be suppressing WebGPU independently of whether headed Firefox on this Mac has it.

**Not yet tested: headed Firefox.** If headed Firefox does expose an adapter, the
Firefox number improves from 32 ms toward Chrome's 8 ms. Worth 10 minutes before the
finale; do not claim either way until measured.

## ⚠ Run-to-run variance is real

Chrome's mobilevit_fp32/WebGPU figure was **10.0 ms** in the first A1 run and **7.6 ms**
in the re-run — roughly 25% spread on an idle machine. Report ranges, not single
decimals, and never put an unqualified "10ms" on a slide.

## Environment note

Firefox is **not installed** — it is running from the mounted DMG at
`/Volumes/Firefox/Firefox.app`. `run.sh` points at that path via `$FF`. Install it to
`/Applications` and the default path should be updated, or the spike breaks as soon as
the DMG is ejected.

## A trap this spike introduced and then fixed

The first version of `run.sh` executed inside the Spike A1 directory and wrote to the
same hardcoded `result.json` — **silently destroying A1's output**. The harness now
takes the result filename from `$RESULT_FILE`. Any shared harness needs per-caller
output paths, or one spike quietly eats another's evidence.
