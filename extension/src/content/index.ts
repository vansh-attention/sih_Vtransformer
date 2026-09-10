/**
 * Content script — the only code that touches the live page. SIH26171.
 *
 * Runs the real extractor (not a spike-specific stand-in) so that whatever Spike C
 * verifies is the same code path the product uses. A spike that tests a simplified
 * copy proves nothing about the thing that ships.
 */

import { extractPage, signalsFor, resolveElement } from './extractor.ts';
import type { ElementNode } from '../contracts.ts';

/**
 * Everything the screenshot mapping needs, captured at the SAME MOMENT as the DOM read.
 *
 * Timing matters more than it looks: if the page scrolls or reflows between the DOM
 * snapshot and the screenshot, every box is offset and every redaction lands somewhere
 * it should not. `scrollX/scrollY` are recorded so a mismatch is at least detectable
 * rather than silent.
 */
export interface CaptureContext {
  devicePixelRatio: number;
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
  capturedAt: number;
}

function captureContext(): CaptureContext {
  return {
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    capturedAt: Date.now(),
  };
}

function flatten(root: ElementNode): ElementNode[] {
  const out: ElementNode[] = [];
  (function walk(n: ElementNode) { out.push(n); n.children?.forEach(walk); })(root);
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'content') return false;

  if (msg.type === 'extract') {
    const before = captureContext();
    const t0 = performance.now();
    const result = extractPage(document);
    const extractMs = Math.round(performance.now() - t0);
    const after = captureContext();

    // If the viewport moved mid-extraction the boxes are already stale. Report it
    // rather than pretend; the caller can retry.
    const stable = before.scrollX === after.scrollX
      && before.scrollY === after.scrollY
      && before.innerWidth === after.innerWidth
      && before.innerHeight === after.innerHeight;

    sendResponse({
      ok: true,
      stable,
      context: after,
      extractMs,
      nodeCount: result.nodeCount,
      truncated: result.truncated,
      visionQueue: result.visionQueue,
      structure: result.structure,
      // Flat list keyed by aria-label, so the spike can look up its fixture blocks
      // without the extension needing any knowledge of the fixture.
      flat: flatten(result.structure.root).map((n) => ({
        id: n.id, role: n.role, label: n.label, box: n.box, visible: n.visible,
      })),
    });
    return true;
  }

  if (msg.type === 'signals') {
    const el = resolveElement(msg.id);
    sendResponse(el ? signalsFor(el) : null);
    return true;
  }

  return false;
});

console.log('[content] ready');
