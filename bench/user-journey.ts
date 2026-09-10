/**
 * User-perspective tests — SIH26171.
 *
 * Everything else here tests the pipeline the way a developer thinks about it. This
 * tests the things a PERSON actually does: empty input, running twice, a page with
 * nothing on it, pathological content pasted into a field. None of these are exotic;
 * all of them are one careless click away during a demo.
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from '../extension/src/content/extractor.ts';
import { sanitize } from '../extension/src/redact/sanitize.ts';
import { Vault } from '../extension/src/redact/vault.ts';
import { loadGazetteer } from '../extension/src/pii/names.ts';
import { validateActions } from '../extension/src/agent/validate.ts';

loadGazetteer(JSON.parse(readFileSync(
  new URL('../extension/models/name-gazetteer.json', import.meta.url), 'utf8')));

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(50)}${detail}`);
};

function pageFrom(html: string, opts: { scripts?: boolean } = {}) {
  const dom = new JSDOM(html, {
    url: 'https://user.test/',
    ...(opts.scripts ? { runScripts: 'dangerously' as const } : {}),
  });
  const { window } = dom;
  let top = 0;
  window.Element.prototype.getBoundingClientRect = function () {
    top += 20;
    return { x: 10, y: top % 700, width: 200, height: 18, top: top % 700,
             left: 10, right: 210, bottom: (top % 700) + 18, toJSON() {} } as DOMRect;
  };
  globalThis.Node = window.Node;
  globalThis.CSS = window.CSS;
  globalThis.getComputedStyle = (el: Element) => window.getComputedStyle(el);
  return window;
}

function run(html: string, goal = 'do something', vault = new Vault()) {
  const w = pageFrom(html);
  const { structure, nodeCount } = extractPage(w.document);
  const { payload, withheld } = sanitize(structure, {
    goal, vault,
    signals: (id) => { const el = resolveElement(id); return el ? signalsFor(el) : undefined; },
  });
  return { payload, withheld, nodeCount, vault };
}

console.log('=== a user opens the wrong kind of page ===');

// Completely empty document.
{
  const r = run('<!DOCTYPE html><html><head><title>x</title></head><body></body></html>');
  check('empty page does not crash', true, `${r.nodeCount} nodes`);
  check('empty page produces a valid payload', typeof r.payload.root?.id === 'string');
}

// Text-only page, nothing to click.
{
  const r = run('<body><p>Just some words. Nothing to do here.</p></body>');
  check('page with no controls does not crash', true, `${r.nodeCount} nodes`);
}

// A page that is one enormous unbroken string.
{
  const r = run(`<body><p>${'A'.repeat(200_000)}</p></body>`);
  check('200k-character single text node survives', r.nodeCount > 0,
    `${(JSON.stringify(r.payload).length / 1024).toFixed(0)}KB payload`);
}

console.log('\n=== a user types odd things into the goal box ===');
{
  const html = '<body><input id="a" name="email" value="x@y.co"><button id="b">Go</button></body>';
  for (const [label, goal] of [
    ['empty goal', ''],
    ['whitespace-only goal', '   \n\t  '],
    ['very long goal', 'please '.repeat(2000)],
    ['goal containing a fake token', 'type <PII_PAN_1> into the box'],
    ['goal with markup', '<script>alert(1)</script>'],
  ] as const) {
    const r = run(html, goal);
    check(`${label} produces a valid payload`, r.payload.goal === goal);
  }
}

console.log('\n=== pathological page CONTENT (a user pastes something odd) ===');
{
  const nasty = [
    ['a token the page invented', '<PII_PAN_1>'],
    ['nested fake tokens', '<PII_<PII_PAN_1>_2>'],
    ['regex metacharacters', '(.*)+$^[a-z]{999}'],
    ['null-ish and control chars', 'a\\u0000b\\u0007c'],
    ['RTL override', 'abc\\u202Edef'],
    ['emoji and combining marks', 'नाम😀🇮🇳 x̸̢̛'],
    ['very long "name"', 'Vikram ' + 'Sharma '.repeat(500)],
  ] as const;
  for (const [label, value] of nasty) {
    let ok = true; let detail = '';
    try {
      const r = run(`<body><input id="a" name="notes" value="${value.replace(/"/g, '&quot;')}"></body>`);
      JSON.stringify(r.payload);
    } catch (e) {
      ok = false;
      detail = e instanceof Error ? e.message.slice(0, 60) : String(e);
    }
    check(`survives: ${label}`, ok, detail);
  }
}

console.log('\n=== the user runs the agent twice ===');
{
  const html = '<body><input id="a" name="pan" value="ABCPE1234F"><button id="b">Go</button></body>';
  const vault = new Vault();
  const first = run(html, 'run one', vault);
  const second = run(html, 'run two', vault);
  const t1 = first.payload.placeholders.map((p) => p.token);
  const t2 = second.payload.placeholders.map((p) => p.token);
  check('same value gets the same token across runs', t1[0] === t2[0], `${t1[0]} vs ${t2[0]}`);
  check('the vault does not grow on a repeat run', vault.tokens().length === 1,
    `${vault.tokens().length} tokens`);
  const wire = JSON.stringify(second.payload);
  check('no leak on the second run', !wire.includes('ABCPE1234F'));
}

console.log('\n=== the agent is handed junk by the server ===');
{
  const r = run('<body><input id="a" name="notes"><button id="b">Go</button></body>');
  const junk = [
    null, undefined, {}, { kind: 'click' }, { kind: 'click', target: null },
    { kind: 'type', target: 'el_2', value: null },
    { kind: 'CLICK', target: 'el_2', reasoning: 'wrong case' },
    { kind: 'click', target: 'el_2', reasoning: 'ok', extra: 'ignored' },
  ];
  let ok = true; let detail = '';
  try {
    const report = validateActions(junk as never, r.payload);
    ok = report.results.length === junk.length
      && report.results.every((x) => typeof x.allowed === 'boolean');
    detail = `${report.denied.length}/${junk.length} refused`;
  } catch (e) {
    ok = false;
    detail = e instanceof Error ? e.message.slice(0, 70) : String(e);
  }
  check('malformed action list is handled, not thrown on', ok, detail);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall user-journey checks pass');
process.exit(fail ? 1 : 0);
