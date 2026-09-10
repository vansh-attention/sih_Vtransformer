/**
 * The agent loop — SIH26171.
 *
 *   observe -> face-redact -> reason -> validate -> act -> re-observe
 *
 * Runs in the service worker, which is the ONLY part of the extension that touches the
 * network. Note what it never holds: the vault lives in the content script, so nothing
 * here has ever seen a real value. That is why "no PII leaves the machine" is a
 * property of the architecture rather than a claim about this file's correctness.
 */

import type { AgentAction, SanitizedNode, SanitizedPayload } from '../contracts.ts';
import { validateActions } from '../agent/validate.ts';

const OFFSCREEN_PATH = 'src/offscreen/index.html';

export interface LoopOptions {
  tabId: number;
  windowId: number;
  goal: string;
  serverUrl: string;
  /** Hard cap. Without it a confused model loops until the user closes the tab. */
  maxTurns?: number;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  turn: number;
  phase: 'observing' | 'redacting' | 'reasoning' | 'validating' | 'acting' | 'done' | 'error';
  detail?: unknown;
}

export interface TurnRecord {
  turn: number;
  origin: string;
  withheld: Array<{ kind: string; count: number }>;
  facesBlurred: number;
  actions: Array<{ action: AgentAction; allowed: boolean; reason?: string; executed?: boolean }>;
  /** Masked shadows captured at observe time, before anything could navigate. */
  previews: Array<{ token: string; kind: string; masked: string }>;
  /** True when the page navigated as a result of our own actions. */
  navigated: boolean;
  /**
   * Why the screenshot is absent, when it is.
   *
   * Surfaced rather than swallowed: a silently missing screenshot degrades visual
   * context (25% of the grade) while every other number still looks healthy, so it must
   * be visible in the record and in the ledger.
   */
  visionError?: string;
  /** Sub-timings, because 'vision took a second' is not a diagnosis. */
  visionBreakdown?: Record<string, unknown>;
  timings: {
    extractMs: number; sanitizeMs: number; visionMs: number;
    networkMs: number; totalMs: number;
  };
  /** Byte count of what was actually transmitted, for the ledger. */
  transmittedBytes: number;
  nodeCount: number;
}

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['WORKERS' as chrome.offscreen.Reason],
    justification: 'Runs on-device vision models; a service worker has no DOM or GPU.',
  });
}

/** Downscale via the content script; fall back to the original if anything fails. */
async function downscaleInPage(tabId: number, dataUrl: string): Promise<string> {
  try {
    const r = await chrome.tabs.sendMessage(tabId, {
      target: 'content', type: 'downscale', dataUrl, maxWidth: 1024, quality: 0.8,
    });
    return r?.dataUrl ?? dataUrl;
  } catch {
    return dataUrl;
  }
}

/**
 * Screenshot the tab and blur any faces BEFORE the image is attached to a payload.
 *
 * Ordering is the whole point: the un-blurred screenshot never becomes part of anything
 * that could be sent. If face detection fails, we send NO screenshot rather than an
 * unredacted one — degrading the visual context is recoverable, leaking a face is not.
 */
async function captureAndRedact(
  windowId: number,
  tabId: number,
): Promise<{
  screenshot?: string; rawForCrops?: string; faces: number; visionMs: number;
  imageSize?: { width: number; height: number }; error?: string;
  breakdown?: Record<string, unknown>;
}> {
  const t0 = performance.now();
  try {
    // JPEG, not PNG. Measured: a PNG capture of a 2400x1314 Retina viewport is several
    // megabytes of base64, and moving that string into the offscreen document cost
    // ~1350ms per turn — against 68ms of actual face inference. Detection and
    // classification are both robust to JPEG artefacts at this quality.
    //
    // Spike D still captures PNG, because verifying that a blur destroyed detail
    // requires an encoder that is not itself destroying detail.
    // Quality 70: this frame is usually transmitted as-is (see below), so the capture
    // setting IS the payload setting. A VLM reading page layout does not need 85.
    const raw = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 70 });
    const captureMs = Math.round(performance.now() - t0);
    await ensureOffscreen();
    const tDetect = performance.now();
    const det = await chrome.runtime.sendMessage({
      target: 'offscreen', type: 'detect-faces', dataUrl: raw, threshold: 0.7, blur: true,
      // The full-resolution frame stays in the offscreen document; we only need the
      // handle to it.
      wantFullFrame: false,
    });

    if (det?.error) {
      return { faces: 0, visionMs: Math.round(performance.now() - t0), error: det.error };
    }

    const detectMs = Math.round(performance.now() - tDetect);
    const faces = det.detections?.length ?? 0;
    return {
      breakdown: { captureMs, detectMs, ...det.stages, encodeBytes: det.transmit?.bytes },
      // `transmit` is the downscaled, JPEG-encoded frame — blurred if faces were found,
      // the original if not. Falls back to the full-resolution image only if the
      // downscale step failed, since a large payload beats no payload.
      // No faces: downscale in the CONTENT SCRIPT, which is not throttled. Doing it in
      // the offscreen document costs ~1000ms of pure scheduling delay; skipping it
      // entirely ships a 2400px frame and makes the MODEL several times slower, because
      // a VLM tokenises by image area. The content script is the only place that is
      // both cheap and correct.
      screenshot: det.transmit?.dataUrl ?? (await downscaleInPage(tabId, raw)),
      // A handle, not an image. The classifier reads the decoded frame in place.
      rawForCrops: det.frameToken,
      imageSize: { width: det.width, height: det.height },
      faces,
      visionMs: Math.round(performance.now() - t0),
    };
  } catch (e) {
    // Fail closed: no screenshot at all.
    return {
      faces: 0,
      visionMs: Math.round(performance.now() - t0),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run the classifier over the regions the DOM could not describe, and attach the
 * results to the matching nodes.
 *
 * Crops come from the BLURRED frame, so a face is already destroyed before the
 * classifier ever sees it. Coordinates use the image/viewport scale verified in
 * Spike C — derived from the image rather than trusting devicePixelRatio.
 */
async function annotateWithVision(
  payload: SanitizedPayload,
  visionQueue: string[],
  dataUrl: string,
  ctx: { innerWidth: number; innerHeight: number },
  imageSize: { width: number; height: number },
): Promise<number> {
  try {
    const index = new Map<string, SanitizedNode>();
    (function walk(n: SanitizedNode) { index.set(n.id, n); n.children?.forEach(walk); })(payload.root);

    // Dimensions come from the detection result we already have. Probing for them with
    // sample-pixels meant decoding a 2400x1314 screenshot a SECOND time every turn,
    // which took vision from 69ms to over 1000ms — the measurement caught it.
    const scaleX = imageSize.width / ctx.innerWidth;
    const scaleY = imageSize.height / ctx.innerHeight;

    const crops = visionQueue
      .map((id) => ({ id, node: index.get(id) }))
      .filter((c) => c.node)
      .map((c) => ({
        id: c.id,
        box: {
          x: Math.round(c.node!.box.x * scaleX), y: Math.round(c.node!.box.y * scaleY),
          w: Math.round(c.node!.box.w * scaleX), h: Math.round(c.node!.box.h * scaleY),
        },
      }));
    if (!crops.length) return 0;

    const res = await chrome.runtime.sendMessage({
      target: 'offscreen', type: 'classify-crops', frameToken: dataUrl, crops, max: 12 });
    if (res?.error) return 0;

    let n = 0;
    for (const r of res.results ?? []) {
      const node = index.get(r.id);
      if (!node) continue;
      node.vision = { label: r.label, confidence: r.confidence, likelyPerson: r.likelyPerson };
      n++;
    }
    return n;
  } catch {
    return 0;   // never block the loop for a description
  }
}

export async function runAgentLoop(opts: LoopOptions): Promise<TurnRecord[]> {
  const { tabId, windowId, goal, serverUrl } = opts;
  const maxTurns = opts.maxTurns ?? 5;
  const progress = opts.onProgress ?? (() => {});
  const history: AgentAction[] = [];
  const records: TurnRecord[] = [];

  for (let turn = 1; turn <= maxTurns; turn++) {
    const turnStart = performance.now();

    // Re-injected every turn. A submit or a link click replaces the document and takes
    // the previous content script - and its vault - with it. Re-injecting is both the
    // fix and the correct security behaviour: the new page gets a new, empty vault.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['dist/content.js'] });

    progress({ turn, phase: 'observing' });
    const obs = await chrome.tabs.sendMessage(tabId, {
      target: 'content', type: 'observe', goal, history,
    });
    if (!obs?.ok) throw new Error('observation failed');
    if (!obs.stable) {
      // Geometry is stale; retry rather than act on boxes that have moved.
      progress({ turn, phase: 'observing', detail: 'viewport moved during extraction; retrying' });
      continue;
    }

    progress({ turn, phase: 'redacting' });
    const vision = await captureAndRedact(windowId, tabId);

    const payload: SanitizedPayload = { ...obs.payload, screenshot: vision.screenshot };

    // Describe the regions the DOM could not. Best-effort: a classifier failure
    // degrades visual context but must never block the loop or the redaction.
    let classifyMs = 0;
    if (vision.rawForCrops && obs.visionQueue?.length) {
      const t = performance.now();
      const annotated = await annotateWithVision(
        payload, obs.visionQueue, vision.rawForCrops, obs.context, vision.imageSize!);
      classifyMs = Math.round(performance.now() - t);
      if (annotated) progress({ turn, phase: 'redacting', detail: `${annotated} region(s) described` });
    }

    const transmitted = JSON.stringify({ payload });

    progress({ turn, phase: 'reasoning' });
    const netStart = performance.now();
    const res = await fetch(`${serverUrl}/act`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: transmitted,
    });
    const networkMs = Math.round(performance.now() - netStart);

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      progress({ turn, phase: 'error', detail });
      throw new Error(`server ${res.status}: ${JSON.stringify(detail)}`);
    }
    const reply = await res.json();
    const actions: AgentAction[] = reply.actions ?? [];

    progress({ turn, phase: 'validating' });
    const report = validateActions(actions, payload);

    progress({ turn, phase: 'acting', detail: report.allowed });
    let execResults: Array<{ executed: boolean; error?: string }> = [];
    let navigated = false;
    if (report.allowed.length) {
      try {
        const exec = await chrome.tabs.sendMessage(tabId, {
          target: 'content', type: 'execute', actions: report.allowed,
        });
        execResults = exec?.results ?? [];
      } catch (e) {
        // A submit or navigation tears down the message channel mid-call. That is the
        // action SUCCEEDING, not failing - the click did exactly what it should.
        const m = e instanceof Error ? e.message : String(e);
        if (/back\/forward cache|message channel|Receiving end does not exist/i.test(m)) {
          navigated = true;
          execResults = report.allowed.map(() => ({ executed: true }));
        } else {
          throw e;
        }
      }
    }

    records.push({
      turn,
      origin: payload.origin,
      withheld: obs.withheld ?? [],
      facesBlurred: vision.faces,
      actions: report.results.map((r, i) => ({
        action: r.action,
        allowed: r.allowed,
        reason: r.reason,
        executed: r.allowed ? execResults[i]?.executed : false,
      })),
      timings: {
        extractMs: obs.timings.extractMs,
        sanitizeMs: obs.timings.sanitizeMs,
        visionMs: vision.visionMs,
        networkMs,
        totalMs: Math.round(performance.now() - turnStart),
      },
      transmittedBytes: transmitted.length,
      nodeCount: obs.nodeCount,
      previews: obs.previews ?? [],
      navigated,
      visionError: vision.error,
      visionBreakdown: { ...vision.breakdown, classifyMs },
    });

    history.push(...report.allowed);

    if (report.allowed.some((a) => a.kind === 'done')) {
      progress({ turn, phase: 'done' });
      break;
    }
    if (navigated) {
      // Let the new document load before the next observe.
      progress({ turn, phase: 'acting', detail: 'page navigated' });
      await new Promise((r) => setTimeout(r, 1200));
    }
    // Nothing survived validation — another identical turn would produce the same
    // refusals, so stop rather than spin.
    if (report.allowed.length === 0) {
      progress({ turn, phase: 'error', detail: report.denied });
      break;
    }

    await new Promise((r) => setTimeout(r, 600));   // let the page settle
  }

  return records;
}
