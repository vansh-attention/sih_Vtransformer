/**
 * SPIKE A — can a ViT-class model actually run under WebGPU in the browser,
 * and what does it cost? SIH26171.
 *
 * This is the one unknown that could still force an architecture change, so it gets
 * answered before anything is built on top of it.
 *
 * Two questions, deliberately separated:
 *   A1 (this file)  — does ORT Web + WebGPU work at all, and how fast/heavy is it?
 *   A2 (next)       — does it still work under Manifest V3's CSP, which forbids
 *                     `unsafe-eval` and remote code, inside an offscreen document?
 *
 * A1 first, because if the runtime is too slow or too heavy on a plain page, MV3 is
 * moot and we need a smaller model class regardless.
 *
 * The model under test is int8 ViT-base (88MB) — deliberately the WORST case. Our real
 * workload is small crops through a much smaller network. If ViT-base is survivable,
 * the real thing certainly is; if it is not, we learn how far we have to come down.
 */

const log = (msg) => {
  const el = document.getElementById('log');
  el.textContent += msg + '\n';
  console.log(msg);
};

const results = {
  userAgent: navigator.userAgent,
  webgpuAvailable: false,
  adapter: null,
  backends: {},
  modelBytes: null,
  error: null,
};

async function probeWebGPU() {
  if (!('gpu' in navigator)) {
    log('navigator.gpu: ABSENT — WebGPU not exposed at all');
    return null;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      log('requestAdapter(): null — WebGPU exposed but no adapter available');
      return null;
    }
    const info = adapter.info ?? {};
    results.webgpuAvailable = true;
    results.adapter = {
      vendor: info.vendor ?? 'unknown',
      architecture: info.architecture ?? 'unknown',
      device: info.device ?? 'unknown',
      description: info.description ?? '',
      maxBufferSize: adapter.limits?.maxBufferSize ?? null,
      maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize ?? null,
    };
    log(`WebGPU adapter: ${info.vendor ?? '?'} / ${info.architecture ?? '?'} / ${info.device ?? '?'}`);
    return adapter;
  } catch (e) {
    log(`requestAdapter() threw: ${e.message}`);
    return null;
  }
}

function heapMb() {
  // Chrome-only, and coarse, but it is the number the resource metric will be judged
  // on, so it is the number we should be measuring.
  return performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
}

async function benchBackend(ort, modelBuffer, backend, runs = 10, sideOverride = null) {
  const out = { backend, ok: false };
  try {
    const heapBefore = heapMb();
    const t0 = performance.now();

    const session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: [backend],
      graphOptimizationLevel: 'all',
    });

    const t1 = performance.now();
    out.sessionCreateMs = Math.round(t1 - t0);
    out.inputNames = session.inputNames;
    out.outputNames = session.outputNames;
    log(`  [${backend}] session created in ${out.sessionCreateMs}ms; inputs=${session.inputNames}`);

    // Read the real input shape from the model rather than assuming 224x224.
    // MobileViT wants 256x256, and a hardcoded shape fails with a bare
    // "failed to call OrtRun()" that says nothing about the actual cause.
    const meta = session.inputMetadata?.[0] ?? session.inputMetadata?.[session.inputNames[0]];
    const declared = meta?.shape ?? meta?.dims ?? [];
    // NOTE: declared metadata cannot be trusted. MobileViT reports [1,3,224,224] but its
    // exported graph contains a reshape hard-coded for 256x256, and feeding 224 fails
    // deep inside with an opaque OrtRun error. Where we know better, we say so.
    const side = sideOverride ?? 224;
    const dims = declared.length === 4 && !sideOverride
      // Dynamic axes come through as strings or -1; substitute sane concrete values.
      ? declared.map((d, i) => (typeof d === 'number' && d > 0 ? d : [1, 3, 224, 224][i]))
      : [1, 3, side, side];
    out.inputShape = dims;
    log(`  [${backend}] input shape ${JSON.stringify(dims)} (declared ${JSON.stringify(declared)})`);
    const size = dims.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) data[i] = Math.random();
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', data, dims) };

    // Warm-up is not optional: the first run compiles shaders and would otherwise be
    // reported as the steady-state latency, which is the number judges will time.
    const w0 = performance.now();
    await session.run(feeds);
    out.warmupMs = Math.round(performance.now() - w0);
    log(`  [${backend}] warm-up (shader compile) ${out.warmupMs}ms`);

    const times = [];
    for (let i = 0; i < runs; i++) {
      const s = performance.now();
      await session.run(feeds);
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    out.runs = runs;
    out.medianMs = Math.round(times[Math.floor(runs / 2)] * 10) / 10;
    out.minMs = Math.round(times[0] * 10) / 10;
    out.maxMs = Math.round(times[runs - 1] * 10) / 10;

    const heapAfter = heapMb();
    out.heapBeforeMb = heapBefore ? Math.round(heapBefore * 10) / 10 : null;
    out.heapAfterMb = heapAfter ? Math.round(heapAfter * 10) / 10 : null;
    out.heapDeltaMb = heapBefore && heapAfter
      ? Math.round((heapAfter - heapBefore) * 10) / 10 : null;

    out.ok = true;
    log(`  [${backend}] median ${out.medianMs}ms  (min ${out.minMs} / max ${out.maxMs})  heap +${out.heapDeltaMb}MB`);

    await session.release();
  } catch (e) {
    // Full message, not the first 40 characters: ORT truncation is what made the
    // MobileViT failure look mysterious the first time round.
    out.error = `${e.name}: ${e.message}`;
    out.errorFull = String(e.stack ?? e.message);
    log(`  [${backend}] FAILED — ${out.error}`);
  }
  return out;
}

async function main() {
  try {
    log('--- Spike A1: ORT Web + WebGPU on a plain page ---');
    await probeWebGPU();

    const ort = await import('./ort/ort.bundle.min.mjs');
    // Absolute, not './ort/'. wasmPaths resolves relative to the ORT MODULE, not the
    // page, so a relative path here becomes /ort/ort/... and every backend fails to
    // initialise with a misleading "no available backend found".
    ort.env.wasm.wasmPaths = '/ort/';
    // Threads need cross-origin isolation headers; the server sets them, but keep the
    // count modest so we are not measuring an unrealistically wide machine.
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
    log(`ORT ${ort.env.versions?.common ?? '?'} loaded; wasm threads=${ort.env.wasm.numThreads}`);

    // Sweep model sizes so we get a latency-vs-size curve rather than one data point.
    // Picking the operating point is the actual decision this spike exists to inform.
    const MODELS = [
      { name: 'vit_base_int8',  file: './vit_base_int8.onnx' },
      { name: 'mobilevit_fp32', file: './mobilevit_fp32.onnx', side: 256 },
      { name: 'mobilevit_int8', file: './mobilevit_int8.onnx', side: 256 },
    ];
    results.models = [];

    for (const m of MODELS) {
      const t0 = performance.now();
      const buf = new Uint8Array(await (await fetch(m.file)).arrayBuffer());
      const fetchMs = Math.round(performance.now() - t0);
      log(`\n=== ${m.name}: ${(buf.byteLength / 1048576).toFixed(1)}MB (fetched ${fetchMs}ms) ===`);

      const entry = { name: m.name, bytes: buf.byteLength, fetchMs, backends: {} };
      entry.backends.webgpu = results.webgpuAvailable
        ? await benchBackend(ort, buf, 'webgpu', 10, m.side ?? null)
        : { backend: 'webgpu', ok: false, error: 'no adapter' };
      entry.backends.wasm = await benchBackend(ort, buf, 'wasm', 10, m.side ?? null);
      results.models.push(entry);
    }
  } catch (e) {
    results.error = `${e.name}: ${e.message}\n${e.stack}`;
    log(`FATAL: ${results.error}`);
  }

  log('--- done ---');
  document.title = 'SPIKE-DONE';
  await fetch('/result', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(results, null, 2),
  }).catch(() => {});
}

main();
