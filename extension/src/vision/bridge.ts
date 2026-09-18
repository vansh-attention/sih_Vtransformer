/**
 * Vision bridge — SIH26171. Hides the Chrome/Firefox host difference.
 *
 * Chrome: the service worker has no DOM, so vision work is dispatched to an offscreen
 * document by message.
 * Firefox: there ARE no offscreen documents, but the background event page has a DOM,
 * so the same handlers are called directly in-process.
 *
 * The orchestrator calls `callVision()` and never learns which browser it is running
 * in. Without this, supporting Firefox would mean a second copy of the agent loop.
 */

import type { VisionMessage } from './handlers.ts';

const OFFSCREEN_PATH = 'src/offscreen/index.html';

/** True on Chrome, where the offscreen API exists. */
function hasOffscreen(): boolean {
  return typeof chrome !== 'undefined' && !!(chrome as { offscreen?: unknown }).offscreen;
}

/**
 * Loaded ON DEMAND, and only on Firefox.
 *
 * A static import would pull ONNX Runtime into Chrome's service-worker bundle — which
 * grew it from 23KB to 195KB for code that browser never executes, since Chrome routes
 * vision to the offscreen document instead. Client resources are 20% of the grade.
 */
let localHandlers: typeof import('./handlers.ts') | null = null;
async function ensureLocal(): Promise<typeof import('./handlers.ts')> {
  if (!localHandlers) {
    localHandlers = await import('./handlers.ts');
    localHandlers.setUrlResolver((p) => chrome.runtime.getURL(p));
  }
  return localHandlers;
}

/**
 * THE one offscreen-document helper. Exported, because it was not.
 *
 * `orchestrator.ts` called a bare `ensureOffscreen()` that it never imported. There
 * were two private copies — one here, one in `background/index.ts` — and neither was
 * visible to it, so every turn that needed a screenshot threw `ensureOffscreen is not
 * defined` and the panel reported "Screenshot withheld". The agent then had no vision
 * at all and looped on "wait — form loading" until it hit the turn limit.
 *
 * ⚠ It also NO-OPS where the API does not exist. Firefox has no `chrome.offscreen`,
 * and the orchestrator called this unconditionally — so importing the other copy would
 * have replaced a crash on Chrome with a crash on Firefox.
 *
 * Chrome allows exactly one offscreen document per extension and `createDocument()`
 * throws if one already exists, including one left from a previous service-worker
 * lifetime, since MV3 kills and restarts workers freely.
 */
export async function ensureOffscreen(): Promise<void> {
  if (!hasOffscreen()) return;
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

export async function callVision(msg: VisionMessage): Promise<never> {
  if (hasOffscreen()) {
    await ensureOffscreen();
    return chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
  }
  // Firefox: run it here. The background event page has a DOM, and — unlike an
  // offscreen document — is not timer-throttled, so this path avoids the ~1s penalty
  // Chrome pays on any canvas encode.
  const h = await ensureLocal();
  return h.handleVisionMessage(msg) as Promise<never>;
}
