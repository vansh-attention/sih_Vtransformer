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

chrome.runtime.onInstalled.addListener(() => { void runSpikeA2(); });
chrome.runtime.onStartup.addListener(() => { void runSpikeA2(); });
