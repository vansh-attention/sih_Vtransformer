/**
 * Content script — SIH26171. The only code that touches the live page.
 *
 * WHERE THE VAULT LIVES, AND WHY IT MATTERS
 *
 * Extraction, sanitization and the vault all live HERE, in the page's own content
 * script. The background service worker — the only part that talks to the network —
 * receives a `SanitizedPayload` and never has access to a real value at all.
 *
 * That is a structural guarantee rather than a promise. A bug in the background script
 * cannot leak a PAN, because the background script has never held one. The vault is a
 * `#private` field in a module that the network layer does not import.
 *
 * Token resolution happens back here too, at execution time, so a real value exists for
 * exactly as long as it takes to type it into a field.
 */

import { extractPage, signalsFor, resolveElement } from './extractor.ts';
import { executeAction } from './execute.ts';
import { sanitize } from '../redact/sanitize.ts';
import { Vault } from '../redact/vault.ts';
import type { AgentAction, PiiKind } from '../contracts.ts';

/** One vault per page session. Cleared on navigation by the script being re-injected. */
const vault = new Vault();

export interface CaptureContext {
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
}

function captureContext(): CaptureContext {
  return {
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

/** Token + a masked shadow of what it replaced. Never the value. */
function maskedPreviews(): Array<{ token: string; kind: string; masked: string }> {
  return vault.tokens().map((token) => {
    const value = vault.resolve(token) ?? '';
    const kind = token.match(/^<PII_(.+)_\d+>$/)?.[1] ?? '';
    // Passwords reveal nothing: unlike a card number there is no legitimate reason to
    // recognise WHICH password it was.
    const masked = kind === 'PASSWORD' || value.length <= 4
      ? '\u2022'.repeat(8)
      : `${value.slice(0, 2)}${'\u2022'.repeat(Math.min(value.length - 3, 12))}${value.slice(-1)}`;
    return { token, kind, masked };
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'content') return false;

  // Extract + sanitize in one round trip. Splitting them would mean the raw
  // PageStructure crossing a message boundary, and messages are structured-cloned into
  // the background — where real values must never arrive.
  if (msg.type === 'observe') {
    const before = captureContext();
    const t0 = performance.now();
    const result = extractPage(document);
    const extractMs = performance.now() - t0;

    const t1 = performance.now();
    const { payload, withheld } = sanitize(result.structure, {
      goal: msg.goal ?? '',
      vault,
      history: msg.history ?? [],
      signals: (id) => {
        const el = resolveElement(id);
        return el ? signalsFor(el) : undefined;
      },
    });
    const sanitizeMs = performance.now() - t1;
    const after = captureContext();

    // If the viewport moved during extraction, every box is already stale. Report it
    // rather than let the caller silently act on bad geometry.
    const stable = before.scrollX === after.scrollX
      && before.scrollY === after.scrollY
      && before.innerWidth === after.innerWidth
      && before.innerHeight === after.innerHeight;

    sendResponse({
      ok: true,
      stable,
      payload,
      withheld,
      context: after,
      visionQueue: result.visionQueue,
      nodeCount: result.nodeCount,
      truncated: result.truncated,
      timings: {
        extractMs: Math.round(extractMs),
        sanitizeMs: Math.round(sanitizeMs),
      },
      // Masked shadows for the Privacy Ledger, captured NOW.
      //
      // The vault is per-page and dies on navigation - correctly; secrets must not
      // survive a page change. So the masks have to be taken at observe time. Asking
      // for them after the agent has acted returns nothing, or throws outright once
      // the old document is bfcached.
      previews: maskedPreviews(),
    });
    return true;
  }

  if (msg.type === 'execute') {
    (async () => {
      const results = [];
      for (const action of msg.actions as AgentAction[]) {
        // Token resolution is bound here, so the vault reference never leaves this file.
        const r = await executeAction(action, (t) => vault.resolve(t));
        results.push(r);
        if (!r.executed) break;   // stop on the first failure; the page state is now unknown
        await new Promise((res) => setTimeout(res, 250));
      }
      return { results };
    })().then(sendResponse);
    return true;
  }

  // Masked previews for the ledger. Kept in the content script so the masking function
  // is applied on the same side of the boundary as the values themselves.
  if (msg.type === 'ledger-previews') {
    sendResponse({ previews: maskedPreviews() });
    return true;
  }

  return false;
});

console.log('[content] ready');
