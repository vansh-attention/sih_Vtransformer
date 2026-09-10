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

import type { AgentAction, SanitizedPayload } from '../contracts.ts';
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

/**
 * Screenshot the tab and blur any faces BEFORE the image is attached to a payload.
 *
 * Ordering is the whole point: the un-blurred screenshot never becomes part of anything
 * that could be sent. If face detection fails, we send NO screenshot rather than an
 * unredacted one — degrading the visual context is recoverable, leaking a face is not.
 */
async function captureAndRedact(
  windowId: number,
): Promise<{ screenshot?: string; faces: number; visionMs: number; error?: string }> {
  const t0 = performance.now();
  try {
    const raw = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    await ensureOffscreen();
    const det = await chrome.runtime.sendMessage({
      target: 'offscreen', type: 'detect-faces', dataUrl: raw, threshold: 0.7, blur: true,
    });

    if (det?.error) {
      return { faces: 0, visionMs: Math.round(performance.now() - t0), error: det.error };
    }

    const faces = det.detections?.length ?? 0;
    return {
      // If faces were found we send the BLURRED image; if none were found the original
      // is already clean.
      screenshot: faces > 0 ? det.redactedDataUrl : raw,
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
    const vision = await captureAndRedact(windowId);

    const payload: SanitizedPayload = { ...obs.payload, screenshot: vision.screenshot };
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
