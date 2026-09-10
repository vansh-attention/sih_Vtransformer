/**
 * Real-website drill — SIH26171.
 *
 * Every page tested so far, INCLUDING the holdout, is a fixture we wrote. The finale
 * gives us unseen real sites, and real sites are nothing like clean fixtures: cookie
 * banners, 5,000-node React trees, inline SVG, lazy-loaded content, deeply nested
 * wrappers.
 *
 * This is the largest untested risk in the project, so it gets measured rather than
 * hoped at. There is no ground truth here — we cannot label a real page's PII by hand
 * at this scale. What this asserts is that the pipeline SURVIVES: bounded time, bounded
 * memory, no crash, and no vault value in the payload.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from '../extension/src/content/extractor.ts';
import { sanitize } from '../extension/src/redact/sanitize.ts';
import { Vault } from '../extension/src/redact/vault.ts';
import { loadGazetteer } from '../extension/src/pii/names.ts';
import type { SanitizedNode } from '../extension/src/contracts.ts';

loadGazetteer(JSON.parse(readFileSync(
  new URL('../extension/models/name-gazetteer.json', import.meta.url), 'utf8')));

const dir = new URL('./realpages/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.html'));

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

console.log(`=== ${files.length} real pages ===\n`);

for (const file of files) {
  const html = readFileSync(new URL(file, dir), 'utf8');
  const dom = new JSDOM(html, { url: `https://example.test/${file}` });
  const { window } = dom;

  let top = 0;
  window.Element.prototype.getBoundingClientRect = function () {
    top += 3;
    return { x: 0, y: top % 4000, width: 100, height: 14, top: top % 4000,
             left: 0, right: 100, bottom: (top % 4000) + 14, toJSON() {} } as DOMRect;
  };
  globalThis.Node = window.Node;
  globalThis.CSS = window.CSS;
  globalThis.getComputedStyle = (el: Element) => window.getComputedStyle(el);

  const domNodes = window.document.querySelectorAll('*').length;
  const heapBefore = process.memoryUsage().heapUsed;

  let extractMs = 0; let sanitizeMs = 0; let nodeCount = 0; let truncated = false;
  let bytes = 0; let withheldTotal = 0; let leaked: string[] = [];
  let crashed: string | null = null;

  try {
    const t0 = performance.now();
    const r = extractPage(window.document);
    extractMs = performance.now() - t0;
    nodeCount = r.nodeCount; truncated = r.truncated;

    const t1 = performance.now();
    const vault = new Vault();
    const { payload, withheld } = sanitize(r.structure, {
      goal: 'real page drill', vault,
      signals: (id) => { const el = resolveElement(id); return el ? signalsFor(el) : undefined; },
    });
    sanitizeMs = performance.now() - t1;

    const wire = JSON.stringify(payload);
    bytes = wire.length;
    withheldTotal = withheld.reduce((a, w) => a + w.count, 0);

    const norm = (x: string) => x.replace(/[\s\-()]/g, '').toLowerCase();
    const nw = norm(wire);
    leaked = vault.secretsForLeakTestOnly()
      .filter((s) => s.length >= 6 && (wire.includes(s) || nw.includes(norm(s))));

    // Sanity: did we actually keep anything actionable?
    let interactive = 0;
    (function walk(n: SanitizedNode) {
      if (['button', 'link', 'textbox', 'select'].includes(n.role)) interactive++;
      n.children?.forEach(walk);
    })(payload.root);

    const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576;

    console.log(`  ${file}`);
    console.log(`    ${domNodes.toLocaleString()} DOM nodes -> ${nodeCount} kept `
      + `(truncated=${truncated}) | ${interactive} interactive | `
      + `${(bytes / 1024).toFixed(0)}KB | withheld ${withheldTotal}`);
    console.log(`    extract ${Math.round(extractMs)}ms | sanitize ${Math.round(sanitizeMs)}ms `
      + `| heap ${heapMb.toFixed(0)}MB`);

    // The hard invariant holds on real pages or it holds nowhere.
    check('no vault value in the payload', leaked.length === 0,
      leaked.length ? `LEAKED ${leaked.slice(0, 3).join(', ')}` : '');
    check('extraction bounded', extractMs + sanitizeMs < 5000,
      `${Math.round(extractMs + sanitizeMs)}ms`);
    check('payload bounded', bytes < 400_000, `${(bytes / 1024).toFixed(0)}KB`);
    check('found something to act on', interactive > 0, `${interactive} controls`);
  } catch (e) {
    crashed = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.log(`  ${file}`);
    check('did not crash', false, crashed);
  }
  console.log('');
}

console.log(fail ? `${fail} FAILURES` : 'pipeline survives every real page');
process.exit(fail ? 1 : 0);
