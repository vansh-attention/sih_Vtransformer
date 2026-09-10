/**
 * Renders the Privacy Ledger for bench fixture 01 into `bench/out/ledger.html`.
 *
 * This is the demo artifact. Open the file, and the whole privacy claim is visible in
 * one screen: what was on the page, what left the machine, and the raw bytes to check
 * it against. It is also the panel that ships inside the extension — same renderer,
 * different host.
 *
 * Timings here are real measurements of our own pipeline. Network is 0 because there
 * is no server yet (Phase 2); it is not a placeholder that will be quietly forgotten.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from '../extension/src/content/extractor.ts';
import { sanitize } from '../extension/src/redact/sanitize.ts';
import { Vault } from '../extension/src/redact/vault.ts';
import { Ledger } from '../extension/src/ledger/ledger.ts';
import { renderLedger } from '../extension/src/ledger/render.ts';
import type { PiiKind } from '../extension/src/contracts.ts';

const html = readFileSync(new URL('./pages/checkout.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://shop.example.com/checkout?session=SECRET_TOKEN_123' });
const { window } = dom;

let top = 0;
window.Element.prototype.getBoundingClientRect = function () {
  if ((this as Element).closest('#hidden-panel')) {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} } as DOMRect;
  }
  top += 20;
  return { x: 10, y: top % 700, width: 200, height: 18, top: top % 700, left: 10, right: 210, bottom: (top % 700) + 18, toJSON() {} } as DOMRect;
};
globalThis.Node = window.Node;
globalThis.CSS = window.CSS;
globalThis.getComputedStyle = (el: Element) => window.getComputedStyle(el);

// --- run the pipeline, measuring each stage --------------------------------

const t0 = performance.now();
const { structure, nodeCount, visionQueue } = extractPage(window.document);
const t1 = performance.now();

const vault = new Vault();
const { payload, withheld } = sanitize(structure, {
  goal: 'Complete the checkout',
  vault,
  signals: (id) => {
    const el = resolveElement(id);
    return el ? signalsFor(el) : undefined;
  },
});
const t2 = performance.now();

// Masks are computed here and the real values are dropped immediately; the ledger
// itself never receives a persistent copy.
const withheldValues = vault.tokens().map((token) => ({
  token,
  kind: token.match(/^<PII_(.+)_\d+>$/)![1] as PiiKind,
  value: vault.resolve(token)!,
}));

const ledger = new Ledger();
ledger.record({
  origin: payload.origin,
  transmitted: payload,
  withheldValues,
  timings: {
    extractMs: Math.round(t1 - t0),
    visionMs: 0,          // Phase 3
    sanitizeMs: Math.round(t2 - t1),
    networkMs: 0,         // Phase 2
    totalMs: Math.round(t2 - t0),
  },
  peakHeapMb: process.memoryUsage().heapUsed / 1024 / 1024,
});

const outDir = new URL('./out/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const outFile = new URL('./ledger.html', outDir);
writeFileSync(outFile, renderLedger(ledger));

const totals = ledger.totals();
console.log(`extracted ${nodeCount} nodes (${visionQueue.length} queued for vision) in ${Math.round(t1 - t0)}ms`);
console.log(`sanitized in ${Math.round(t2 - t1)}ms; withheld ${totals.withheld} values`);
console.log(withheld.map((w) => `  ${w.kind} x${w.count}`).join('\n'));
console.log(`\nwrote ${outFile.pathname}`);
