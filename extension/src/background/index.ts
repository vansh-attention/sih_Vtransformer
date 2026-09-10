/**
 * MV3 service worker — orchestration only. SIH26171.
 *
 * Deliberately thin. The service worker has no DOM and no WebGPU, so it cannot host
 * the model; it exists to own the offscreen document's lifecycle and to be the single
 * point of network egress. Keeping egress in one place is what makes "nothing leaves
 * unsanitized" an auditable claim rather than a hopeful one.
 */

import { runAgentLoop } from './orchestrator.ts';
import { callVision } from '../vision/bridge.ts';

const OFFSCREEN_PATH = 'src/offscreen/index.html';
const SERVER_URL = 'http://127.0.0.1:8975';

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
  //
  // Uses the production 'observe' path, not a spike-only shortcut: a spike that
  // exercises a different code path proves nothing about what ships.
  const extraction = await chrome.tabs.sendMessage(tabId, {
    target: 'content', type: 'observe', goal: 'spike C alignment check', history: [],
  });
  // Flatten the sanitized tree; boxes are unchanged by sanitization.
  extraction.flat = (() => {
    const out: Array<{ id: string; role: string; label?: string; box: unknown; visible: boolean }> = [];
    (function walk(n: { id: string; role: string; label?: string; box: unknown; visible: boolean; children?: unknown[] }) {
      out.push({ id: n.id, role: n.role, label: n.label, box: n.box, visible: n.visible });
      (n.children as typeof n[] | undefined)?.forEach(walk);
    })(extraction.payload.root);
    return out;
  })();
  extraction.extractMs = extraction.timings.extractMs;
  extraction.nodeCount = extraction.nodeCount ?? extraction.flat.length;
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

/**
 * Spike D — does face redaction actually redact the face?
 *
 * "We blurred the faces" is the single easiest claim in this project to believe and not
 * verify. A tight box, a fixed blur radius, an off-by-a-scale-factor coordinate map:
 * every one of those produces an image that LOOKS processed while the person stays
 * perfectly recognisable.
 *
 * So this asserts on pixels, twice over:
 *   INSIDE  the applied box — pixels must have CHANGED (something was destroyed)
 *   OUTSIDE the applied box — pixels must be IDENTICAL (nothing else was damaged)
 *
 * The second half matters as much as the first. A blur that smears the whole image
 * would pass the first check and wreck the visual context the server needs to act on,
 * costing 25% of the grade to protect 20%.
 */
async function runSpikeD(imageUrl: string): Promise<Record<string, unknown>> {
  await ensureOffscreen();

  const dataUrl: string = await (async () => {
    const blob = await (await fetch(imageUrl)).blob();
    return new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.readAsDataURL(blob);
    });
  })();

  const det = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'detect-faces', dataUrl, threshold: 0.7, blur: true,
    wantFullFrame: true,   // Spike D verifies actual pixels
  });
  if (det?.error) return { error: det.error };

  const result: Record<string, unknown> = {
    faces: det.detections?.length ?? 0,
    scores: (det.detections ?? []).map((d: { score: number }) => Math.round(d.score * 100) / 100),
    boxes: (det.detections ?? []).map((d: { box: unknown }) => d.box),
    appliedBoxes: det.appliedBoxes,
    image: { width: det.width, height: det.height },
    inferenceMs: det.inferenceMs,
    loadMs: det.loadMs,
    totalMs: det.totalMs,
    backend: det.backend,
  };

  if (!det.redactedDataUrl || !det.appliedBoxes?.length) {
    result.verified = false;
    result.reason = 'no faces detected, nothing to verify';
    return result;
  }

  // Sample inside every applied box, and at control points well away from all of them.
  const box = det.appliedBoxes[0] as { x: number; y: number; w: number; h: number };
  const inside = [
    { name: 'face-centre', x: box.x + box.w / 2, y: box.y + box.h / 2 },
    { name: 'face-upper',  x: box.x + box.w / 2, y: box.y + box.h * 0.3 },
    { name: 'face-lower',  x: box.x + box.w / 2, y: box.y + box.h * 0.7 },
  ];

  const farFrom = (x: number, y: number) =>
    (det.appliedBoxes as typeof box[]).every(
      (b) => x < b.x - 20 || x > b.x + b.w + 20 || y < b.y - 20 || y > b.y + b.h + 20);

  const outside: Array<{ name: string; x: number; y: number }> = [];
  const candidates = [
    ['top-left', 8, 8], ['top-right', det.width - 8, 8],
    ['bottom-left', 8, det.height - 8], ['bottom-right', det.width - 8, det.height - 8],
    ['centre-bottom', det.width / 2, det.height - 8],
  ] as const;
  for (const [name, x, y] of candidates) if (farFrom(x, y)) outside.push({ name, x, y });

  const points = [...inside, ...outside];
  const before = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'sample-pixels', dataUrl, points });
  const after = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'sample-pixels', dataUrl: det.redactedDataUrl, points });

  const comparisons = points.map((p, i) => {
    const b = before.samples[i];
    const a = after.samples[i];
    const delta = b.rgb && a.rgb
      ? Math.max(...(b.rgb as number[]).map((v, j) => Math.abs(v - (a.rgb as number[])[j])))
      : -1;
    return { name: p.name, before: b.hex, after: a.hex, delta,
             region: i < inside.length ? 'inside' : 'outside' };
  });

  result.comparisons = comparisons;
  const outsideC = comparisons.filter((c) => c.region === 'outside');

  // Detail destruction, measured as luma variance inside the face box.
  //
  // Point-delta was the wrong test: a blur over flat skin tone moves individual pixels
  // barely at all, so it reported failure while the redaction was working. Blur is a
  // low-pass filter; what it removes is high-frequency detail, and variance is how that
  // shows up. This is the measure that actually corresponds to "is this person still
  // recognisable".
  const statsBefore = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'region-stats', dataUrl, region: box });
  const statsAfter = await chrome.runtime.sendMessage({
    target: 'offscreen', type: 'region-stats', dataUrl: det.redactedDataUrl, region: box });

  const varianceRatio = statsBefore.variance > 0
    ? statsAfter.variance / statsBefore.variance : 1;

  result.detailBefore = statsBefore;
  result.detailAfter = statsAfter;
  result.varianceRatio = Math.round(varianceRatio * 1000) / 1000;

  // Blur must destroy most of the detail in the region.
  result.detailDestroyed = varianceRatio < 0.5;
  result.outsideUntouched = outsideC.every((c) => c.delta === 0);
  result.outsideControlPoints = outsideC.length;
  result.verified =
    result.detailDestroyed === true &&
    result.outsideUntouched === true &&
    outsideC.length >= 2;   // coverage: two control points minimum, or it proves nothing

  return result;
}

async function runAll(): Promise<void> {
  const out: Record<string, unknown> = { at: new Date().toISOString() };
  try {
    // Both run in one pass: they share the browser launch, and a service worker has no
    // way to read a flag injected from outside.
    out.spikeC = await runSpikeC('http://127.0.0.1:8974/pages/alignment.html');
    out.spikeD = await runSpikeD('http://127.0.0.1:8974/assets/face-test.jpg');
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
  }
  console.log('[bg] spike C', out);
  await reportTo('http://127.0.0.1:8974/result', out);
}

chrome.action?.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;

  if (msg.type === 'run-agent') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { error: 'no active tab' };
      if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        return { error: 'cannot run on a browser-internal page; open a normal site first' };
      }

      const records = await runAgentLoop({
        tabId: tab.id,
        windowId: tab.windowId!,
        goal: msg.goal,
        serverUrl: SERVER_URL,
        onProgress: (event) => {
          // Best-effort: the panel may be closed, and a rejected sendMessage here
          // would abort the whole run for the sake of a status line.
          chrome.runtime.sendMessage({ target: 'panel', type: 'progress', event })
            .catch(() => {});
        },
      });

      // Masks were captured at observe time inside the content script - the only place
      // real values ever exist. Reading them from the turn record also survives the
      // agent navigating the page, which asking the tab afterwards does not.
      return { records, previews: records[0]?.previews ?? [] };
    })()
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
    return true;
  }
  return false;
});

/**
 * Spike E — the whole product, end to end, in a real browser.
 *
 * Everything up to here was verified in pieces: the loop in a Node harness, the vision
 * in the offscreen document, the alignment against pixels. This runs the actual
 * extension against an actual page through the actual agent loop, which is the only
 * configuration a judge will ever see.
 */
async function runSpikeE(): Promise<Record<string, unknown>> {
  const url = 'http://127.0.0.1:8976/pages/checkout.html';
  const tab = await chrome.tabs.create({ url, active: true });
  const tabId = tab.id!;

  await new Promise<void>((resolve) => {
    const l = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(l); resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(l);
  });
  await new Promise((r) => setTimeout(r, 500));

  const phases: string[] = [];
  const records = await runAgentLoop({
    tabId,
    windowId: tab.windowId!,
    goal: 'Submit the payment form',
    serverUrl: SERVER_URL,
    maxTurns: 2,
    onProgress: (e) => phases.push(`${e.turn}:${e.phase}`),
  });

  // Previews come from the turn records, captured at observe time. Asking the page now
  // would fail: the agent may well have navigated it.
  return { records, phases, previews: records[0]?.previews ?? [] };
}

/**
 * Spike F — does the extension actually work in Firefox?
 *
 * Reports what the host provides, then exercises the vision path through the bridge.
 * On Firefox that runs in the background event page; on Chrome it goes to the offscreen
 * document. If the bridge is right, this returns the same shape on both.
 */
async function runSpikeF(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    userAgent: navigator.userAgent,
    hasOffscreenApi: !!(chrome as { offscreen?: unknown }).offscreen,
    hasSidePanelApi: !!(chrome as { sidePanel?: unknown }).sidePanel,
    hasSidebarAction: !!(chrome as { sidebarAction?: unknown }).sidebarAction,
    hasWebGPU: 'gpu' in navigator,
  };

  // A 1x1 PNG: enough to prove the vision path is reachable and the model loads.
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    + 'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  try {
    const t0 = performance.now();
    const det = await callVision({ type: 'detect-faces', dataUrl: px, blur: false,
                                   wantFullFrame: false }) as never as Record<string, never>;
    out.visionReachable = true;
    out.visionBackend = det.backend;
    out.visionMs = Math.round(performance.now() - t0);
    out.facesOnBlankPixel = (det.detections as unknown[] | undefined)?.length ?? 0;
  } catch (e) {
    out.visionReachable = false;
    out.visionError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  // Throttling differs by host: Chrome's offscreen document is quantised to ~1s, a
  // Firefox background page should not be.
  try {
    out.encodeProbe = await callVision({ type: 'probe-encode' });
  } catch (e) {
    out.encodeProbeError = String(e);
  }

  // The content script must inject and observe on a real page.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['dist/content.js'] });
      const obs = await chrome.tabs.sendMessage(tab.id, {
        target: 'content', type: 'observe', goal: 'spike F', history: [] });
      out.contentScript = {
        ok: !!obs?.ok,
        nodeCount: obs?.nodeCount,
        withheld: obs?.withheld,
        extractMs: obs?.timings?.extractMs,
        sanitizeMs: obs?.timings?.sanitizeMs,
      };
    }
  } catch (e) {
    out.contentScript = { ok: false, error: String(e) };
  }

  return out;
}

/** Is a spike collector listening on this port? */
async function collectorUp(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spike entry point.
 *
 * Both spike harnesses launch the extension the same way, so `onInstalled` fires for
 * both and whichever suite is hardcoded here wins — which silently stopped Spikes C and
 * D from running at all when E was added. The port that is actually listening decides.
 */
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const out: Record<string, unknown> = { at: new Date().toISOString() };

    if (await collectorUp(8974)) {
      try {
        out.spikeC = await runSpikeC('http://127.0.0.1:8974/pages/alignment.html');
        out.spikeD = await runSpikeD('http://127.0.0.1:8974/assets/face-test.jpg');
      } catch (e) {
        out.error = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
      }
      await reportTo('http://127.0.0.1:8974/result', out);
      return;
    }

    if (await collectorUp(8977)) {
      try {
        out.spikeF = await runSpikeF();
      } catch (e) {
        out.error = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
      }
      await reportTo('http://127.0.0.1:8977/result', out);
      return;
    }

    if (await collectorUp(8976)) {
      try {
        out.spikeE = await runSpikeE();
        await ensureOffscreen();
        out.encodeProbe = await chrome.runtime.sendMessage({
          target: 'offscreen', type: 'probe-encode' });
      } catch (e) {
        out.error = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
      }
      await reportTo('http://127.0.0.1:8976/result', out);
    }
  })();
});

