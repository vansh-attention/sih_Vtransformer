/**
 * Offscreen document — SIH26171. Chrome only.
 *
 * A thin adapter. Chrome MV3's service worker has neither a DOM nor a GPU context, so
 * an offscreen document is the only place in a Chrome extension that can host the
 * models. Firefox needs none of this: its background event page has a DOM, and calls
 * the same handlers directly.
 *
 * ⚠ This host is TIMER-THROTTLED to ~1s because it is hidden — a 16x16 canvas takes
 * 1004ms to encode here. Never put avoidable async work in it.
 * See spikes/e-e2e/FINDINGS.md.
 */

import { handleVisionMessage, setUrlResolver } from '../vision/handlers.ts';

setUrlResolver((p) => chrome.runtime.getURL(p));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  handleVisionMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String(e?.stack ?? e) }));
  return true;
});

console.log('[offscreen] ready');
