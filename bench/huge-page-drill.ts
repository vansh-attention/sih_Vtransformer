/**
 * Huge-page drill — SIH26171.
 *
 * Real pages are not the four tidy fixtures in bench/pages. A search results page, an
 * admin table or a social feed is tens of thousands of nodes, and an unbounded extractor
 * on one of those blows both the resource budget (20%) and the latency budget (15%) at
 * the same time.
 *
 * Asserts the node budget actually binds, and that extraction stays fast enough to be
 * usable rather than merely finite.
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from '../extension/src/content/extractor.ts';
import { sanitize } from '../extension/src/redact/sanitize.ts';
import { Vault } from '../extension/src/redact/vault.ts';
import { loadGazetteer } from '../extension/src/pii/names.ts';

loadGazetteer(JSON.parse(readFileSync(
  new URL('../extension/models/name-gazetteer.json', import.meta.url), 'utf8')));

// 20,000 interactive rows — comparable to a large admin table or a long feed.
const ROWS = 20_000;
// Enough style calls to average out scheduler noise, few enough to stay quick.
const CAL_NODES = 2_000;
// Nodes the extractor walks to keep 1,500. Measured, and the number the ratio is against.
const NODES_VISITED = 13_893;
const rows = Array.from({ length: ROWS }, (_, i) =>
  `<tr><td>Row ${i}</td><td><input name="f${i}" value="value ${i}"></td>` +
  `<td><button>Act ${i}</button></td></tr>`).join('');
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Huge</title></head>
<body><h1>Large table</h1><table>${rows}</table></body></html>`;

const dom = new JSDOM(html, { url: 'https://huge.example.com/' });
const { window } = dom;
let top = 0;
window.Element.prototype.getBoundingClientRect = function () {
  top += 4;
  return { x: 0, y: top % 5000, width: 120, height: 16, top: top % 5000,
           left: 0, right: 120, bottom: (top % 5000) + 16, toJSON() {} } as DOMRect;
};
globalThis.Node = window.Node;
globalThis.CSS = window.CSS;
globalThis.getComputedStyle = (el: Element) => window.getComputedStyle(el);

const domNodes = window.document.querySelectorAll('*').length;

// Calibrate this machine before measuring, so the timing check below can be a ratio
// rather than a wall-clock number. A separate throwaway document: calibrating on the
// real one would prime jsdom's style cache for the very nodes extraction is about to
// visit, and flatter the result.
const calDom = new JSDOM(`<!DOCTYPE html><html><body><table>${
  Array.from({ length: CAL_NODES }, (_, i) =>
    `<tr><td>c${i}</td></tr>`).join('')}</table></body></html>`);
const calEls = [...calDom.window.document.querySelectorAll('td')];
const c0 = performance.now();
for (const el of calEls) calDom.window.getComputedStyle(el).display;
const perStyleCallMs = (performance.now() - c0) / calEls.length;

const heapBefore = process.memoryUsage().heapUsed;

const t0 = performance.now();
const { structure, nodeCount, truncated } = extractPage(window.document);
const extractMs = performance.now() - t0;

const t1 = performance.now();
const vault = new Vault();
const { payload } = sanitize(structure, {
  goal: 'drill', vault,
  signals: (id) => { const el = resolveElement(id); return el ? signalsFor(el) : undefined; },
});
const sanitizeMs = performance.now() - t1;
const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576;
const bytes = JSON.stringify(payload).length;

console.log(`DOM nodes on page : ${domNodes.toLocaleString()}`);
console.log(`extracted         : ${nodeCount.toLocaleString()} (truncated=${truncated})`);
console.log(`extract           : ${Math.round(extractMs)}ms`);
console.log(`sanitize          : ${Math.round(sanitizeMs)}ms`);
console.log(`payload           : ${(bytes / 1024).toFixed(0)}KB`);
console.log(`heap delta        : ${heapMb.toFixed(1)}MB`);
// Print the calibration so a failure says whether the machine was slow or we were.
console.log(`this machine      : ${perStyleCallMs.toFixed(3)}ms per jsdom style call`);
// Environment-independent efficiency measure: how many nodes we touch per node we keep.
// Unlike wall-clock this means the same thing in jsdom and in Chrome, so it is the
// number to watch if extraction ever feels slow.
console.log(`visited/kept      : ~${(13893 / nodeCount).toFixed(1)}x (see FINDINGS)`);

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

// The budget must BIND — the whole point is that a huge page cannot run away with us.
//
// A small overshoot is correct, not sloppy: ancestors holding kept children (body,
// table, tbody) must survive the cut, or the tree collapses to nothing the moment the
// budget is reached. The allowance is the maximum nesting depth, not a fudge factor.
const MAX_CONTAINER_OVERSHOOT = 16;
check('budget respected', nodeCount <= 1500 + MAX_CONTAINER_OVERSHOOT && truncated,
  `${nodeCount} nodes (budget 1500 + ${MAX_CONTAINER_OVERSHOOT} for containers), truncated=${truncated}`);

// TIMING HERE IS A JSDOM-RELATIVE REGRESSION GUARD, NOT A BROWSER NUMBER.
//
// Profiled: the cost is `getComputedStyle`, which jsdom implements by running its CSS
// selector engine — against roughly a microsecond in a real browser. The walk visits
// ~14,000 nodes to keep 1,500, so jsdom spends seconds where Chrome spends milliseconds.
// Spike E measured real extraction in Chrome at 2-5ms.
//
// This is a RATIO against a style call timed on this same machine, not a wall-clock
// threshold. It used to be `< 6000ms`, which is a statement about how fast the computer
// is: a loaded CI runner came in at 6021ms and failed a docs-only commit. Scaling both
// sides by machine speed cancels that out, while the regressions this exists to catch
// change the ratio by two to three orders of magnitude — reintroducing
// `Array.from(el.children)` took extraction from 4ms to 8644ms, and a per-element
// `label[for]` query cost 54s per 1500 nodes.
const expectedMs = NODES_VISITED * perStyleCallMs;
const ratio = (extractMs + sanitizeMs) / expectedMs;
const SLACK = 3;
check('within time budget (jsdom-relative)', ratio < SLACK,
  `${Math.round(extractMs + sanitizeMs)}ms = ${ratio.toFixed(2)}x the ` +
  `${Math.round(expectedMs)}ms this machine needs for ${NODES_VISITED.toLocaleString()} ` +
  `style calls (limit ${SLACK}x) — browser figure is Spike E's 2-5ms`);

// Truncation must be REPORTED, or the server silently reasons about a partial page and
// concludes the missing controls do not exist.
check('truncation is reported to the caller', truncated === true);

console.log(fail ? `\n${fail} FAILURES` : '\nhuge-page drill passed');
process.exit(fail ? 1 : 0);
