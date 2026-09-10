/**
 * THE INVARIANT TEST — SIH26171.
 *
 * The single most valuable test in this project. Everything else checks that we did
 * something clever; this checks that we did not do something catastrophic.
 *
 * Claim under test: after sanitization, NO value held in the vault appears anywhere in
 * the bytes we would transmit.
 *
 * It checks normalised variants too, because a secret stored as "4111 1111 1111 1111"
 * leaking as "4111111111111111" is still a leak, and a naive substring check would
 * sail straight past it.
 *
 * If this test ever fails, stop and fix it before anything else. Do not skip it, do
 * not mark it pending, do not "fix it after the demo".
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from '../extension/src/content/extractor.ts';
import { sanitize } from '../extension/src/redact/sanitize.ts';
import { Vault } from '../extension/src/redact/vault.ts';

// --- fixture setup ---------------------------------------------------------

const html = readFileSync(new URL('./pages/checkout.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://shop.example.com/checkout?session=SECRET_TOKEN_123&email=hb@example.com' });
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

// --- run the real pipeline -------------------------------------------------

const { structure } = extractPage(window.document);
const vault = new Vault();
const { payload, withheld } = sanitize(structure, {
  goal: 'Complete the checkout',
  vault,
  signals: (id) => {
    const el = resolveElement(id);
    return el ? signalsFor(el) : undefined;
  },
});

const wire = JSON.stringify(payload);

// --- the assertions --------------------------------------------------------

const norm = (s: string) => s.replace(/[\s\-()]/g, '').toLowerCase();
const normWire = norm(wire);

let fail = 0;
const secrets = vault.secretsForLeakTestOnly();

console.log(`vault holds ${secrets.length} secrets; payload is ${wire.length} bytes\n`);
console.log('--- leak check ---');
for (const secret of secrets) {
  const literal = wire.includes(secret);
  const normalised = secret.length >= 6 && normWire.includes(norm(secret));
  const leaked = literal || normalised;
  if (leaked) fail++;
  const how = literal ? 'LITERAL' : normalised ? 'NORMALISED' : '';
  console.log(`  ${leaked ? `LEAK (${how})` : 'clean       '}  ${JSON.stringify(secret)}`);
}

console.log('\n--- other invariants ---');
const t = (name: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
};

// The query string carried a session token and an email. Only the origin may survive.
t('url reduced to origin', payload.origin === 'https://shop.example.com');
t('session token from query string absent', !wire.includes('SECRET_TOKEN_123'));

// Tripwire: serializing a vault must explode rather than leak.
let threw = false;
try { JSON.stringify({ vault }); } catch { threw = true; }
t('JSON.stringify(vault) throws', threw);

t('placeholders were emitted', payload.placeholders.length > 0);
t('every placeholder has a token', payload.placeholders.every((p) => p.token.startsWith('<PII_')));
t('withheld counts reported for ledger', withheld.length > 0);

// Decoys must NOT have been redacted — over-redaction costs 20% of the grade.
t('decoy order total kept (999999999999)', wire.includes('999999999999'));
t('decoy AWB kept (4539578763621486)', wire.includes('4539578763621486'));

// --- what the server actually sees -----------------------------------------

console.log('\n--- withheld (counts only, per the ledger contract) ---');
for (const w of withheld) console.log(`  ${w.kind.padEnd(9)} x${w.count}`);

console.log('\n--- sanitized field values as transmitted ---');
(function walk(n: typeof payload.root) {
  if (n.value) console.log(`  ${(n.label ?? n.id).slice(0, 34).padEnd(36)} = ${n.value}`);
  n.children?.forEach(walk);
})(payload.root);

console.log(fail ? `\n${fail} FAILURES — DO NOT PROCEED` : '\nno leaks; all invariants hold');
process.exit(fail ? 1 : 0);
