/**
 * End-to-end agent loop — SIH26171.
 *
 * Closes the circle for the first time:
 *   real page -> extract -> sanitize -> server -> validate -> actions
 *
 * Every stage is the production code path. Nothing here is a simplified stand-in,
 * because a harness that exercises a copy proves nothing about what ships.
 *
 * Usage:
 *   server/.venv/bin/uvicorn main:app --port 8975   (from server/)
 *   node --experimental-strip-types bench/agent-loop.ts
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from '../extension/src/content/extractor.ts';
import { sanitize } from '../extension/src/redact/sanitize.ts';
import { Vault } from '../extension/src/redact/vault.ts';
import { validateActions } from '../extension/src/agent/validate.ts';
import type { AgentAction } from '../extension/src/contracts.ts';

const SERVER = process.env.AGENT_SERVER ?? 'http://127.0.0.1:8975';
const GOAL = process.argv[2] ?? 'Submit the payment form';

// --- page ------------------------------------------------------------------

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

// --- extract + sanitize ----------------------------------------------------

const t0 = performance.now();
const { structure, nodeCount } = extractPage(window.document);
const t1 = performance.now();

const vault = new Vault();
const { payload, withheld } = sanitize(structure, {
  goal: GOAL,
  vault,
  signals: (id) => {
    const el = resolveElement(id);
    return el ? signalsFor(el) : undefined;
  },
});
const t2 = performance.now();

console.log(`extract   ${Math.round(t1 - t0)}ms  (${nodeCount} nodes)`);
console.log(`sanitize  ${Math.round(t2 - t1)}ms  (withheld ${withheld.map((w) => `${w.count}x${w.kind}`).join(', ')})`);
console.log(`goal      "${GOAL}"`);

// --- health ----------------------------------------------------------------

const health = await fetch(`${SERVER}/health`).then((r) => r.json()).catch(() => null);
if (!health) {
  console.error(`\nserver unreachable at ${SERVER}`);
  console.error('start it with:  cd server && .venv/bin/uvicorn main:app --port 8975');
  process.exit(1);
}
if (!health.ok) {
  console.error(`\nserver up but not ready: ${JSON.stringify(health)}`);
  process.exit(1);
}
console.log(`server    ${health.model} via ${health.backend}`);

// --- act -------------------------------------------------------------------

const t3 = performance.now();
const res = await fetch(`${SERVER}/act`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ payload }),
});
const networkMs = Math.round(performance.now() - t3);

if (!res.ok) {
  console.error(`\n/act failed ${res.status}: ${JSON.stringify(await res.json(), null, 2)}`);
  process.exit(1);
}

const reply = await res.json();
console.log(`model     ${networkMs}ms  (${reply.meta?.promptEvalCount ?? '?'} prompt tokens, ${reply.meta?.evalCount ?? '?'} generated)`);

// --- validate --------------------------------------------------------------

const actions: AgentAction[] = reply.actions ?? [];
const report = validateActions(actions, payload);

// Resolve every target back to the element it actually names. "The loop closed
// cleanly" is not the same as "the agent did the right thing": an action can pass every
// structural check and still click the wrong button. Printing the identity of the
// target is the difference between verifying the endpoint and verifying the effect.
const index = new Map<string, { role: string; label?: string }>();
(function walk(n: { id: string; role: string; label?: string; children?: unknown[] }) {
  index.set(n.id, { role: n.role, label: n.label });
  (n.children as typeof n[] | undefined)?.forEach(walk);
})(payload.root as never);

console.log(`\n--- ${actions.length} action(s) returned ---`);
for (const r of report.results) {
  const a = r.action;
  const target = a.target ? ` ${a.target}` : '';
  const value = a.value ? ` = ${JSON.stringify(a.value)}` : '';
  console.log(`  ${r.allowed ? 'ALLOW ' : 'DENY  '} ${a.kind}${target}${value}`);
  if (a.target) {
    const el = index.get(a.target);
    console.log(`          target is: ${el ? `${el.role} "${el.label ?? ''}"` : 'UNKNOWN ELEMENT'}`);
  }
  console.log(`          why: ${a.reasoning}`);
  if (!r.allowed) console.log(`          REFUSED: ${r.reason}`);
}

// --- the assertions that matter --------------------------------------------

console.log('\n--- checks ---');
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

check('server returned at least one action', actions.length > 0);
check('every action carries reasoning', actions.every((a) => !!a.reasoning));

// The whole point: the model directed the agent without seeing any real value.
const secrets = vault.secretsForLeakTestOnly();
const replyBlob = JSON.stringify(reply);
const leaked = secrets.filter((s) => s.length >= 6 && replyBlob.includes(s));
check('no vault secret appears in the model response', leaked.length === 0,
  leaked.length ? `LEAKED: ${leaked.join(', ')}` : '');

check('no action targets an unknown element',
  !report.denied.some((d) => d.reason?.startsWith('unknown element id')));

// THE SEMANTIC TEST, and the one that actually matters.
//
// A token means "this field is filled in with a valid value of that type". If the model
// reads a token as an empty or broken field, it tries to re-fill it — and would
// overwrite the user's real data with a guess. That is the central failure mode of the
// whole design, so it gets asserted rather than hoped at.
//
// The validator refuses these anyway, but a model that keeps producing them is a model
// that has not understood the redaction scheme, and the PS requires that it does.
const tokenFields = new Set<string>();
(function walk(n: { id: string; value?: string; children?: unknown[] }) {
  if (n.value && /<PII_[A-Z]+_\d+>/.test(n.value)) tokenFields.add(n.id);
  (n.children as typeof n[] | undefined)?.forEach(walk);
})(payload.root as never);

const refilled = actions.filter(
  (a) => a.kind === 'type' && a.target && tokenFields.has(a.target),
);
check('model did not try to re-fill an already-populated field',
  refilled.length === 0,
  refilled.length
    ? `tried to overwrite: ${refilled.map((a) => `${a.target} ("${a.reasoning}")`).join('; ')}`
    : '');

console.log(fail ? `\n${fail} FAILURES` : '\nagent loop closed cleanly');
process.exit(fail ? 1 : 0);
