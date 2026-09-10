/**
 * Offscreen document — the on-device inference host. SIH26171.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * Manifest V3 puts the extension's background logic in a service worker, and a service
 * worker has neither a DOM nor a WebGPU context. So the vision model cannot live there.
 * An offscreen document is the only place in an MV3 extension that has both, which is
 * what makes this whole architecture possible — or not, which is Spike A2's question.
 *
 * The other MV3 constraint is CSP. Extension pages run under `script-src 'self'`: no
 * `unsafe-eval`, no remote code. ONNX Runtime needs to compile WebAssembly, so the
 * manifest must declare `'wasm-unsafe-eval'` and every `.wasm` and `.onnx` file must be
 * bundled locally rather than fetched from a CDN. If that were not permitted, the
 * client half of this project would need a different runtime entirely.
 */

import * as ort from 'onnxruntime-web/webgpu';

export interface InferenceReport {
  ok: boolean;
  cspAllowedWasm: boolean;
  webgpuInOffscreen: boolean;
  adapter: Record<string, unknown> | null;
  backendUsed: string | null;
  sessionCreateMs?: number;
  warmupMs?: number;
  medianMs?: number;
  inputShape?: number[];
  error?: string;
}

let session: ort.InferenceSession | null = null;
let backendUsed: string | null = null;

/** Probe WebGPU from inside the offscreen document specifically. */
async function probeAdapter(): Promise<Record<string, unknown> | null> {
  if (!('gpu' in navigator)) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const info = (adapter as GPUAdapter).info ?? ({} as GPUAdapterInfo);
    return {
      vendor: info.vendor ?? 'unknown',
      architecture: info.architecture ?? 'unknown',
      device: info.device ?? 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Try WebGPU, fall back to WASM.
 *
 * Not a nicety: Firefox's WebGPU support trails Chrome's and the PS names both
 * browsers, so the fallback IS the Firefox story. Spike A1 measured the cost of taking
 * it — 45ms vs 10ms — so degrading here is a known, quantified loss rather than a
 * silent one.
 */
async function createSession(modelUrl: string): Promise<{ ms: number }> {
  // Local paths only. A CDN URL here would be remote code and MV3 forbids it.
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('ort/');
  ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);

  const buf = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer());

  for (const backend of ['webgpu', 'wasm'] as const) {
    try {
      const t0 = performance.now();
      session = await ort.InferenceSession.create(buf, {
        executionProviders: [backend],
        graphOptimizationLevel: 'all',
      });
      backendUsed = backend;
      return { ms: Math.round(performance.now() - t0) };
    } catch (e) {
      console.warn(`[offscreen] backend ${backend} unavailable:`, e);
    }
  }
  throw new Error('no execution provider available (webgpu and wasm both failed)');
}

async function runSpike(modelUrl: string, side: number, runs: number): Promise<InferenceReport> {
  const report: InferenceReport = {
    ok: false,
    // Reaching this line at all means the CSP permitted the ORT module to load and
    // compile its WebAssembly. If `wasm-unsafe-eval` were missing we would have thrown
    // before now.
    cspAllowedWasm: true,
    webgpuInOffscreen: false,
    adapter: null,
    backendUsed: null,
  };

  try {
    report.adapter = await probeAdapter();
    report.webgpuInOffscreen = report.adapter !== null;

    const { ms } = await createSession(modelUrl);
    report.sessionCreateMs = ms;
    report.backendUsed = backendUsed;

    const dims = [1, 3, side, side];
    report.inputShape = dims;
    const size = dims.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) data[i] = Math.random();
    const feeds = { [session!.inputNames[0]]: new ort.Tensor('float32', data, dims) };

    // First run compiles shaders; excluded from the median so we report steady state.
    const w0 = performance.now();
    await session!.run(feeds);
    report.warmupMs = Math.round(performance.now() - w0);

    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      await session!.run(feeds);
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    report.medianMs = Math.round(times[Math.floor(runs / 2)] * 10) / 10;
    report.ok = true;
  } catch (e) {
    report.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  return report;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;

  if (msg.type === 'run-spike') {
    runSpike(
      chrome.runtime.getURL(msg.model ?? 'models/mobilevit_fp32.onnx'),
      msg.side ?? 256,
      msg.runs ?? 10,
    ).then(sendResponse);
    return true; // keep the channel open for the async reply
  }
  return false;
});

console.log('[offscreen] ready');
