/**
 * Spike G page — runs the on-device work at a given CPU throttle rate.
 *
 * Measures the two things that scale with the client machine: face detection and crop
 * classification. The reasoning model is excluded — it runs on the server, so a slow
 * client does not slow it down.
 *
 * ⚠ CDP throttles the CPU, NOT the GPU. On a real low-end laptop the GPU is weaker too,
 * so these figures remain optimistic. Reported, not hidden.
 */
const log = (m) => { document.getElementById('log').textContent += m + '\n'; };
const results = { userAgent: navigator.userAgent, runs: [] };

const ort = await import('./ort/ort.bundle.min.mjs');
ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);

const adapter = 'gpu' in navigator ? await navigator.gpu.requestAdapter() : null;
results.webgpu = !!adapter;
log(`webgpu: ${!!adapter}`);

/**
 * WASM ON PURPOSE — this is the point of the spike, not a workaround.
 *
 * CDP's setCPUThrottlingRate throttles the CPU and NOT the GPU. Benchmarking the WebGPU
 * path under CPU throttling would therefore show almost no change and prove nothing
 * about a slow machine.
 *
 * It is also the more realistic path: a low-end laptop is exactly where WebGPU is most
 * likely to be missing, driver-blocked, or slow enough that ORT falls back. Spike A1
 * measured the WebGPU numbers on good hardware; this measures the floor.
 */
async function session(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return { s: await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] }), ep: 'wasm' };
}

const face = await session('./models/ultraface_rfb320.onnx');
const clf = await session('./models/mobilevit_fp32.onnx');
log(`face: ${face.ep}  classifier: ${clf.ep}`);

function tensor(side, h = side) {
  const n = 3 * side * h;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.random();
  return new ort.Tensor('float32', d, [1, 3, h, side]);
}

/**
 * A FRESH tensor per run.
 *
 * Reusing one tensor across runs fails on the WebGPU backend with
 * `Kernel "[Mul]" failed ... Failed to generate kernel's output`: ORT uploads the input
 * to a GPU buffer and the reused JS tensor no longer backs it. The extension never hits
 * this because it builds a new tensor from each new screenshot.
 */
async function timeIt(sess, makeTensor, runs = 8) {
  await sess.run({ [sess.inputNames[0]]: makeTensor() });   // warm-up: shader compile
  const times = [];
  for (let i = 0; i < runs; i++) {
    const feeds = { [sess.inputNames[0]]: makeTensor() };
    const s = performance.now();
    await sess.run(feeds);
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(runs / 2)] * 10) / 10;
}

window.__runBench = async (rate) => {
  const faceMs = await timeIt(face.s, () => tensor(320, 240));
  const clfMs = await timeIt(clf.s, () => tensor(256));

  // Pure-JS work, to show what a throttled CPU does to the parts that are not GPU.
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < 3_000_000; i++) acc += Math.sqrt(i) % 7;
  const cpuMs = Math.round(performance.now() - t0);

  results.runs.push({ rate, faceMs, classifyMs: clfMs, cpuBoundMs: cpuMs, acc: acc > 0 });
  log(`${rate}x  face ${faceMs}ms  classify ${clfMs}ms  cpu-bound ${cpuMs}ms`);
};

// Lets the driver assert that a run was actually recorded, instead of trusting that a
// call which threw nothing did something.
window.__count = () => results.runs.length;

window.__report = async () => {
  await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' },
                           body: JSON.stringify(results, null, 2) });
};
log('ready');
