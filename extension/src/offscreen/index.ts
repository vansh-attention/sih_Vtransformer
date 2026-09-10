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
import { loadFaceModel, detectFaces, blurRegions } from '../vision/detect.ts';

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

/**
 * Decode a captured screenshot and sample pixels at given points.
 *
 * Lives here because the service worker has no DOM and therefore no canvas. Sampling
 * actual pixels is the only way to prove the DOM->image coordinate mapping is right:
 * a box that is merely "about right" still blurs the wrong region, and nothing else
 * in the pipeline would notice.
 */
async function samplePixels(
  dataUrl: string,
  points: Array<{ name: string; x: number; y: number }>,
): Promise<{ width: number; height: number; samples: Array<Record<string, unknown>> }> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);

  const samples = points.map((p) => {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
      return { name: p.name, x, y, outOfBounds: true, hex: null };
    }
    const d = ctx.getImageData(x, y, 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]]
      .map((v) => v.toString(16).padStart(2, '0')).join('');
    return { name: p.name, x, y, outOfBounds: false, hex, rgb: [d[0], d[1], d[2]] };
  });

  return { width: bitmap.width, height: bitmap.height, samples };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;

  if (msg.type === 'detect-faces') {
    (async () => {
      const t0 = performance.now();
      const load = await loadFaceModel(chrome.runtime.getURL('models/ultraface_rfb320.onnx'));
      const blob = await (await fetch(msg.dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const result = await detectFaces(bitmap, msg.threshold ?? 0.7);

      let redactedDataUrl: string | undefined;
      let applied: unknown[] = [];
      if (msg.blur !== false && result.detections.length) {
        const { canvas, applied: a } = await blurRegions(
          bitmap, result.detections.map((d) => d.box));
        applied = a;
        const out = await canvas.convertToBlob({ type: 'image/png' });
        redactedDataUrl = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result as string);
          fr.readAsDataURL(out);
        });
      }

      return {
        ...result,
        loadMs: load.ms,
        totalMs: Math.round(performance.now() - t0),
        appliedBoxes: applied,
        redactedDataUrl,
      };
    })().then(sendResponse).catch((e) => sendResponse({ error: String(e?.stack ?? e) }));
    return true;
  }

  if (msg.type === 'region-stats') {
    (async () => {
      const blob = await (await fetch(msg.dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);

      const r = msg.region as { x: number; y: number; w: number; h: number };
      const { data } = ctx.getImageData(r.x, r.y, r.w, r.h);

      // Luma variance is the right measure of "was detail destroyed".
      //
      // Absolute pixel change is NOT: blurring a flat region of skin barely moves its
      // values, so a delta test reports failure while the blur is working perfectly.
      // Blur is a low-pass filter — what it removes is high-frequency detail, and
      // variance is what that shows up as.
      let sum = 0;
      let sumSq = 0;
      const n = r.w * r.h;
      for (let i = 0; i < n; i++) {
        const y = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        sum += y;
        sumSq += y * y;
      }
      const mean = sum / n;
      return {
        mean: Math.round(mean * 100) / 100,
        variance: Math.round((sumSq / n - mean * mean) * 100) / 100,
        pixels: n,
      };
    })().then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
    return true;
  }

  if (msg.type === 'sample-pixels') {
    samplePixels(msg.dataUrl, msg.points)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }

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
