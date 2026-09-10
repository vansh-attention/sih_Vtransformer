/**
 * MV3 service worker — orchestration only. SIH26171.
 *
 * Deliberately thin. The service worker has no DOM and no WebGPU, so it cannot host
 * the model; it exists to own the offscreen document's lifecycle and to be the single
 * point of network egress. Keeping egress in one place is what makes "nothing leaves
 * unsanitized" an auditable claim rather than a hopeful one.
 */

const OFFSCREEN_PATH = 'src/offscreen/index.html';

/**
 * Chrome allows exactly one offscreen document per extension, and createDocument()
 * throws if one already exists — including one left over from a previous service worker
 * lifetime, since workers are killed and restarted freely under MV3.
 */
async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['WORKERS' as chrome.offscreen.Reason],
    justification:
      'Runs the on-device vision model (WebGPU/WASM). A service worker has neither a ' +
      'DOM nor a GPU context, so inference cannot live there.',
  });
}

async function reportTo(url: string, payload: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
    });
  } catch (e) {
    console.error('[bg] failed to post result', e);
  }
}

/** Spike A2 entry point: prove the offscreen document can actually do the work. */
async function runSpikeA2(): Promise<void> {
  const result: Record<string, unknown> = {
    at: new Date().toISOString(),
    userAgent: navigator.userAgent,
  };

  try {
    const t0 = performance.now();
    await ensureOffscreen();
    result.offscreenCreateMs = Math.round(performance.now() - t0);
    result.offscreenCreated = true;

    const report = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'run-spike',
      model: 'models/mobilevit_fp32.onnx',
      side: 256,
      runs: 10,
    });
    result.inference = report;
  } catch (e) {
    result.offscreenCreated = false;
    result.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  console.log('[bg] spike A2 result', result);
  await reportTo('http://127.0.0.1:8972/result', result);
}

/**
 * Spike C — is the DOM's coordinate space actually aligned with the screenshot's?
 *
 * `getBoundingClientRect()` returns CSS pixels in viewport space.
 * `captureVisibleTab()` returns a PNG in DEVICE pixels. On a Retina display those
 * differ by a factor of 2, and nothing in either API announces it.
 *
 * Get this wrong and every redaction box is drawn in the wrong place — a face is
 * "blurred" while the actual face is still visible. That failure is completely silent
 * unless something asserts on pixels, which is exactly what this does: map each known
 * block's centre into image space, sample the pixel there, compare to the colour the
 * DOM said should be there.
 */
async function runSpikeC(pageUrl: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  const tab = await chrome.tabs.create({ url: pageUrl, active: true });
  const tabId = tab.id!;

  // Wait for the load to settle. A screenshot of a half-painted page would produce
  // mismatches that look like mapping bugs but are not.
  await new Promise<void>((resolve) => {
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  await new Promise((r) => setTimeout(r, 400));

  await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/content.js'] });

  // DOM read first, screenshot immediately after. The content script reports whether
  // the viewport moved during extraction so skew is detectable rather than assumed away.
  const extraction = await chrome.tabs.sendMessage(tabId, { target: 'content', type: 'extract' });
  const captureStart = performance.now();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'png' });
  result.captureMs = Math.round(performance.now() - captureStart);
  result.dataUrlBytes = dataUrl.length;
  result.extraction = {
    stable: extraction.stable,
    context: extraction.context,
    extractMs: extraction.extractMs,
    nodeCount: extraction.nodeCount,
  };

  // Blocks the fixture defines, and the colour each must show.
  const EXPECTED: Record<string, string> = {
    topleft: '#ff0000', topright: '#00ff00', centre: '#0000ff',
    offset: '#ffff00', tall: '#ff00ff',
  };

  const byLabel = new Map<string, { box: { x: number; y: number; w: number; h: number }; visible: boolean }>();
  for (const n of extraction.flat) if (n.label) byLabel.set(n.label, n);

  // Scale is DERIVED from the image, not assumed from devicePixelRatio. That is the
  // whole question: whether captureVisibleTab's output matches DPR or something else.
  await ensureOffscreen();
  const probe = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'sample-pixels', dataUrl, points: [{ name: 'probe', x: 0, y: 0 }],
  });
  const ctx = extraction.context;
  const scaleX = probe.width / ctx.innerWidth;
  const scaleY = probe.height / ctx.innerHeight;
  result.image = { width: probe.width, height: probe.height };
  result.viewport = { w: ctx.innerWidth, h: ctx.innerHeight };
  result.devicePixelRatio = ctx.devicePixelRatio;
  result.derivedScale = { x: Math.round(scaleX * 1000) / 1000, y: Math.round(scaleY * 1000) / 1000 };
  result.scaleMatchesDpr =
    Math.abs(scaleX - ctx.devicePixelRatio) < 0.01 && Math.abs(scaleY - ctx.devicePixelRatio) < 0.01;

  const points: Array<{ name: string; x: number; y: number }> = [];
  for (const [label] of Object.entries(EXPECTED)) {
    const node = byLabel.get(label);
    if (!node) continue;
    points.push({
      name: label,
      x: (node.box.x + node.box.w / 2) * scaleX,
      y: (node.box.y + node.box.h / 2) * scaleY,
    });
  }

  const sampled = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'sample-pixels', dataUrl, points,
  });

  // Exact RGB equality is the WRONG assertion on a screenshot. macOS colour management
  // shifts captured pixels by a channel or two even through a lossless PNG — the first
  // run reported #01ff00 against an expected #00ff00 and #ffff04 against #ffff00.
  // Those are colour drift, not misalignment.
  //
  // So: a tight per-channel tolerance, AND the sampled colour must be nearer to its own
  // expected colour than to any other block's. The fixture's colours are maximally far
  // apart, so a genuinely mis-mapped box lands on white or a different hue and fails
  // both tests. A tolerance alone would be too weak; nearest-match alone too loose.
  const TOLERANCE = 8;
  const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  const checks = sampled.samples.map((s: Record<string, unknown>) => {
    const name = s.name as string;
    const expectedHex = EXPECTED[name];
    if (!s.hex) return { ...s, expected: expectedHex, match: false, reason: 'no pixel' };

    const got = s.rgb as number[];
    const want = hexToRgb(expectedHex);
    const maxDelta = Math.max(...got.map((v, i) => Math.abs(v - want[i])));

    // Which block's colour is this pixel actually closest to?
    let nearest = name;
    let nearestDist = Infinity;
    for (const [other, hex] of Object.entries(EXPECTED)) {
      const o = hexToRgb(hex);
      const d = Math.hypot(...got.map((v, i) => v - o[i]));
      if (d < nearestDist) { nearestDist = d; nearest = other; }
    }

    return {
      ...s,
      expected: expectedHex,
      maxChannelDelta: maxDelta,
      nearestBlock: nearest,
      match: maxDelta <= TOLERANCE && nearest === name,
    };
  });
  result.checks = checks;

  // COVERAGE FIRST. `[].every()` returns true, so an empty check set previously
  // reported a clean pass while verifying nothing at all — the test was green because
  // the extractor had found zero elements. A verification that cannot fail is not a
  // verification.
  const expectedCount = Object.keys(EXPECTED).length;
  result.expectedCount = expectedCount;
  result.checkedCount = checks.length;
  result.coverageComplete = checks.length === expectedCount;
  result.allMatched =
    result.coverageComplete && checks.every((c: { match: boolean }) => c.match);

  // Elements the extractor must have handled structurally, independent of pixels.
  result.structural = {
    hiddenPruned: !byLabel.has('hidden'),
    belowFoldExcluded: !byLabel.has('belowfold'),
    blocksFound: Object.keys(EXPECTED).filter((k) => byLabel.has(k)),
  };

  await chrome.tabs.remove(tabId);
  return result;
}

async function runAll(): Promise<void> {
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  try {
    const page = new URLSearchParams(location.search).get('page');
    out.spikeC = await runSpikeC(page ?? 'http://127.0.0.1:8974/alignment.html');
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
  }
  console.log('[bg] spike C', out);
  await reportTo('http://127.0.0.1:8974/result', out);
}

chrome.runtime.onInstalled.addListener(() => { void runAll(); });
chrome.runtime.onStartup.addListener(() => { void runAll(); });
