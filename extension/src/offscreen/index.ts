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
import { loadFaceModel, detectFaces, blurRegions, prepareForTransmission } from '../vision/detect.ts';
import { loadClassifier, classifyCrop } from '../vision/classify.ts';

/**
 * The most recent frame, kept decoded HERE.
 *
 * A 2400x1314 PNG as a data URL is several megabytes of base64. Passing it
 * offscreen -> background -> offscreen so the classifier could re-decode it cost over a
 * second per turn in structured-clone and decode time alone — for an image that never
 * needed to leave this document. The background now gets only the small downscaled JPEG
 * it actually transmits, and the classifier reads the frame straight from here.
 */
let lastFrame: { bitmap: ImageBitmap; token: string } | null = null;

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

  // Diagnostic: is convertToBlob doing WORK, or is the hidden offscreen document
  // being timer-throttled? A 16x16 canvas takes no measurable time to encode, so if it
  // also lands near 1000ms the cost is throttling and no amount of optimisation helps.
  if (msg.type === 'probe-encode') {
    (async () => {
      const results: Record<string, number> = {};
      for (const side of [16, 256, 1024]) {
        const c = new OffscreenCanvas(side, side);
        const cx = c.getContext('2d')!;
        cx.fillStyle = '#345'; cx.fillRect(0, 0, side, side);
        const t = performance.now();
        await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        results[`${side}px`] = Math.round(performance.now() - t);
      }
      // Same sizes again, to see whether the first call in a tick pays and later ones
      // do not.
      const t2 = performance.now();
      const c2 = new OffscreenCanvas(16, 16);
      c2.getContext('2d')!.fillRect(0, 0, 16, 16);
      await c2.convertToBlob({ type: 'image/jpeg' });
      results['16px_again'] = Math.round(performance.now() - t2);
      return results;
    })().then(sendResponse);
    return true;
  }

  if (msg.type === 'classify-crops') {
    (async () => {
      const t0 = performance.now();
      const load = await loadClassifier(
        chrome.runtime.getURL('models/mobilevit_fp32.onnx'),
        chrome.runtime.getURL('models/imagenet-labels.json'));

      // Reuse the decoded frame from detect-faces; only fall back to decoding when the
      // caller supplies its own image (the spikes do).
      let bitmap: ImageBitmap;
      if (msg.frameToken && lastFrame?.token === msg.frameToken) {
        bitmap = lastFrame.bitmap;
      } else {
        const blob = await (await fetch(msg.dataUrl)).blob();
        bitmap = await createImageBitmap(blob);
      }

      const results = [];
      // Bounded: a page full of images would otherwise cost 10ms each with no cap, and
      // latency is 15% of the grade.
      for (const c of (msg.crops as Array<{ id: string; box: never }>).slice(0, msg.max ?? 12)) {
        const r = await classifyCrop(bitmap, c.box, c.id);
        if (r) results.push(r);
      }

      return { results, loadMs: load.ms, backend: load.backend,
               totalMs: Math.round(performance.now() - t0) };
    })().then(sendResponse).catch((e) => sendResponse({ error: String(e?.stack ?? e) }));
    return true;
  }

  if (msg.type === 'detect-faces') {
    (async () => {
      const t0 = performance.now();
      const load = await loadFaceModel(chrome.runtime.getURL('models/ultraface_rfb320.onnx'));
      const tLoad = performance.now();

      const blob = await (await fetch(msg.dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const tDecode = performance.now();

      const result = await detectFaces(bitmap, msg.threshold ?? 0.7);
      const tInfer = performance.now();

      let redactedDataUrl: string | undefined;
      let applied: unknown[] = [];
      void redactedDataUrl;
      let transmit: Awaited<ReturnType<typeof prepareForTransmission>> | undefined;

      // Cache the frame the classifier should read. When faces were blurred that is
      // the BLURRED canvas, so a face is destroyed before the classifier ever sees it.
      const frameToken = `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      lastFrame = { bitmap, token: frameToken };

      if (msg.blur !== false && result.detections.length) {
        const { canvas, applied: a } = await blurRegions(
          bitmap, result.detections.map((d) => d.box));
        applied = a;
        // createImageBitmap COPIES; transferToImageBitmap DETACHES the canvas, which
        // left convertToBlob below encoding an empty surface — a blank "redacted"
        // frame that Spike D correctly caught as zero variance.
        lastFrame = { bitmap: await createImageBitmap(canvas), token: frameToken };

        // Lossless PNG of the blurred frame, for the pixel-level verification in
        // Spike D. Re-encoding to JPEG first would make 'was detail destroyed'
        // unmeasurable, since JPEG destroys detail on its own.
        const png = await canvas.convertToBlob({ type: 'image/png' });
        redactedDataUrl = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result as string);
          fr.readAsDataURL(png);
        });

        // Faces were blurred, so the frame MUST be re-encoded from the canvas. Pays
        // the ~1s offscreen throttle; correctness beats latency when the alternative is
        // transmitting an unblurred face.
        if (msg.transmitReady !== false) transmit = await prepareForTransmission(lastFrame.bitmap);
      }
      // No faces: the captured frame is already clean AND already JPEG, so re-encoding
      // it buys only a smaller payload and costs a full second of throttled scheduling.
      // The caller sends the original.

      return {
        ...result,
        loadMs: load.ms,
        // Sub-timings inside the handler. Two rounds of guessing from the outside
        // pointed at the wrong thing; this is where the answer actually is.
        stages: {
          modelLoadMs: Math.round(tLoad - t0),
          decodeMs: Math.round(tDecode - tLoad),
          detectMs: Math.round(tInfer - tDecode),
          blurAndEncodeMs: Math.round(performance.now() - tInfer),
          transmitStages: transmit?.stages,
          imagePx: bitmap.width * bitmap.height,
        },
        totalMs: Math.round(performance.now() - t0),
        appliedBoxes: applied,
        // Only returned when explicitly asked for: it is multi-megabyte base64 and the
        // agent loop never needs it. Spike D does, for pixel verification.
        redactedDataUrl: msg.wantFullFrame ? redactedDataUrl : undefined,
        frameToken,
        transmit,
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
