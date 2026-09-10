import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from './extractor.ts';
import { classifyField, reconcile } from '../pii/dom.ts';
import { scanText } from '../pii/patterns.ts';
import type { ElementNode } from '../contracts.ts';

const html = readFileSync(new URL('../../../bench/pages/checkout.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://shop.example.com/checkout?token=abc123' });
const { window } = dom;

// jsdom has no layout engine, so every rect is 0x0 and everything would read as
// invisible. Stub a plausible box so the traversal/pruning logic can be exercised.
// Real geometry is verified in Spike C against Chrome, not here.
let top = 0;
window.Element.prototype.getBoundingClientRect = function () {
  const hiddenAncestor = (this as Element).closest('#hidden-panel');
  if (hiddenAncestor) return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON(){} } as DOMRect;
  top += 20;
  return { x: 10, y: top % 700, width: 200, height: 18, top: top % 700, left: 10, right: 210, bottom: (top % 700) + 18, toJSON(){} } as DOMRect;
};
globalThis.Node = window.Node; globalThis.CSS = window.CSS;
globalThis.getComputedStyle = (el: Element) => window.getComputedStyle(el);

const result = extractPage(window.document, { maxNodes: 1500 });
console.log(`nodes=${result.nodeCount} truncated=${result.truncated} visionQueue=${result.visionQueue.length}`);

const flat: ElementNode[] = [];
(function walk(n: ElementNode) { flat.push(n); n.children?.forEach(walk); })(result.structure.root);

let fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(44)} got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

const byLabel = (l: string) => flat.find((n) => n.label === l);
check('hidden subtree pruned (no Ghost Button)', !!byLabel('Ghost Button'), false);
check('hidden input pruned',                     flat.some((n) => n.value === 'XYZPE9999K'), false);
check('submit button captured',                  byLabel('Pay now')?.role, 'button');
check('disabled button marked disabled',         byLabel('Cancel')?.enabled, false);
check('password role inferred',                  byLabel('Payment PIN')?.role, 'password');
check('label resolved via <label for>',          !!byLabel('Aadhaar Number'), true);
check('canvas queued for vision',                result.visionQueue.length >= 2, true);
check('alt-less img queued for vision',          flat.find((n)=>n.id===result.visionQueue[0])?.role, 'image');
check('stable id round-trips to element',        resolveElement(byLabel('Pay now')!.id)?.tagName, 'BUTTON');

// End-to-end: run every captured field through layers 1+2 and check the verdicts.
console.log('\n--- PII verdicts on captured fields ---');
const verdicts = new Map<string, boolean>();
for (const node of flat) {
  const el = resolveElement(node.id);
  if (!el) continue;
  const hint = classifyField(signalsFor(el));
  // Direct text only, never el.textContent — that concatenates descendants and makes
  // a container re-report every child's PII. The sanitizer must follow the same rule.
  const own = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? '')
    .join('').replace(/\s+/g, ' ').trim();
  const text = node.value ?? own;
  const det = scanText(text)[0] ?? null;
  const r = reconcile(hint, det);
  if (!r) continue;
  const key = node.label ?? node.id;
  if (verdicts.has(key)) continue;
  verdicts.set(key, r.redact);
  console.log(`  ${r.redact ? 'REDACT' : 'keep  '}  ${key.slice(0, 34).padEnd(36)} ${r.kind.padEnd(9)} conf=${r.confidence.toFixed(2)}  ${r.rationale}`);
}

console.log('');
const want: Array<[string, boolean]> = [
  ['Full Name', true], ['Email', true], ['Mobile Number', true],
  ['Aadhaar Number', true], ['GSTIN (optional)', true], ['Card Number', true],
  ['Payment PIN', true], ['Billing Address', true],
  ['PAN (for invoices above \u20B92 lakh)', true],
];
for (const [label, expect] of want) check(`verdict: ${label}`, verdicts.get(label), expect);

console.log(fail ? `\n${fail} FAILURES` : '\nall extractor cases pass');
