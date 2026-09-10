# Spike G — what happens on a machine that isn't an M5?

Run: 10 Sep 2026 · Chrome for Testing 153, CPU throttled via CDP
Reproduce: `./run.sh`

Every performance number in this project came from an Apple M5 with a metal-3 GPU. A
judge's laptop will be slower and we did not know by how much — which made every one of
those numbers unsafe to put on a slide.

## Result

WASM execution path, median of 8 runs:

| CPU throttle | face detect | classify (per crop) | cpu-bound JS |
|---|---|---|---|
| **1x** (this M5) | 6.5 ms | 86.6 ms | 64 ms |
| **4x** (mid-range laptop) | 35.2 ms | 329.1 ms | 188 ms |
| **6x** (low-end laptop) | **52.6 ms** | **490.5 ms** | 244 ms |

Scaling from 1x to 6x: face **8.1x**, classify **5.7x**, plain JS **3.8x**.

## What a slow laptop actually costs

A typical turn runs face detection once and the classifier over ~2 crops:

| | this M5 (WebGPU) | **6x-throttled (WASM)** |
|---|---|---|
| vision | 65 ms | **~1030 ms** |
| extract + sanitize | ~10 ms | ~40 ms |
| model (server-side) | ~3600 ms | ~3600 ms |
| **turn total** | **~3.7 s** | **~4.7 s** |

**~27% slower per turn, and still perfectly usable.** The reason the hit is modest is
that the reasoning model dominates and runs on the server, where the client's CPU is
irrelevant. The client-side work we spent all that effort optimising is a small share of
the total — which is itself worth knowing.

## Why WASM, deliberately

CDP's `setCPUThrottlingRate` throttles the **CPU, not the GPU**. Benchmarking the WebGPU
path under CPU throttling would show almost no change and prove nothing.

WASM is also the honest choice for the scenario: a low-end laptop is exactly where
WebGPU is most likely to be absent, driver-blocked, or slow enough that ORT falls back.
Spike A1 measured the ceiling on good hardware; this measures the floor.

## Caveats — do not over-claim these either

- **The GPU is not throttled.** A real low-end machine has a weaker GPU too, so a device
  that *does* use WebGPU will land somewhere between these rows and Spike A1's.
- CPU throttling is a uniform multiplier. Real slow machines also have less memory
  bandwidth, slower storage, and thermal limits.
- 4x/6x are the conventional stand-ins for mid-range and low-end. They are approximations,
  not models of a specific laptop.

**The honest headline: ~4.7 s per turn on a low-end machine against ~3.7 s here.**
Quote that, not the M5 figure alone.

## Two harness bugs worth recording

1. **`Runtime.evaluate` reports failures in `exceptionDetails`, not by rejecting.** Every
   call looked successful while `window.__runBench` did not yet exist, and the benchmark
   posted an empty result set with no error anywhere. A driver that cannot fail is as
   useless as a test that cannot fail.
2. **Reusing one input tensor across runs breaks the WebGPU backend** —
   `Kernel "[Mul]" failed ... Failed to generate kernel's output`. ORT uploads the input
   to a GPU buffer and the reused JS tensor no longer backs it. The extension never hits
   this because it builds a fresh tensor from each new screenshot.
