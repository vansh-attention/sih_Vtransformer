/**
 * THE BACKGROUND -> PANEL BOUNDARY — does everything the panel reads actually cross it?
 *
 * `run-agent` returns an explicit object rather than the whole `LoopResult`, because the
 * service worker is the one part of the extension that touches the network and a blind
 * spread would forward whatever a future field happens to carry. That is the right call
 * and it has a failure mode: a field added to the loop, read by the panel, and never
 * named in the middle.
 *
 * It has already happened once. `needs-user-input` shipped with `question` and
 * `questionTarget` missing from that list, so the panel printed "the agent needs one
 * value from you" and then rendered no question and no input — a dead end that announces
 * itself, which is worse than no feature at all. Nothing caught it: the unit tests do not
 * run the worker, and the screenshot harness stubs the run result and never crosses this
 * boundary.
 *
 * So this reads both files as TEXT and compares them. Crude on purpose — importing
 * `background/index.ts` needs a `chrome` global, a service-worker context and a live tab,
 * which is why no test has ever covered this seam. Reading the source costs nothing and
 * fails loudly the next time the two drift.
 *
 *   node --experimental-strip-types extension/src/background/panel-contract.test.ts
 */

import { readFileSync } from 'node:fs';

const bg = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../panel/index.ts', import.meta.url), 'utf8');

let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(54)}${ok ? '' : ` ${detail}`}`);
};

/** The object literal returned by the `run-agent` handler. */
const forwarded = (() => {
  const marker = 'return {\n        records: result.records,';
  const start = bg.indexOf(marker);
  if (start === -1) return null;
  const end = bg.indexOf('};', start);
  const block = bg.slice(start, end);
  return new Set([...block.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]!));
})();

check('found the run-agent response object', forwarded !== null,
  'the marker moved — update this test rather than deleting it');

if (forwarded) {
  /**
   * Every `res.<field>` the panel reads out of that response.
   *
   * `res` is the name the panel binds the reply to. Anything it reads and the worker does
   * not send arrives as `undefined`, which in this panel means a card that silently does
   * not render.
   */
  /**
   * Scoped to the run-agent block, NOT the whole file. The panel binds `res` to a fetch
   * Response elsewhere — the first draft of this test scanned everything and demanded the
   * worker forward `ok`, `body` and `status`. A test that reports fields nobody is missing
   * is one people learn to ignore.
   */
  const from = panel.indexOf("type: 'run-agent'");
  const region = from === -1 ? '' : panel.slice(from);
  check('found the run-agent call in the panel', from !== -1, 'the call moved');

  const read = new Set([...region.matchAll(/\bres\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!));
  // `error` is produced by the handler's catch path, not the success object.
  read.delete('error');

  const missing = [...read].filter((f) => !forwarded.has(f));
  check('every field the panel reads is forwarded', missing.length === 0,
    `NOT FORWARDED: ${missing.join(', ')} — the panel will read undefined`);

  // The specific pair that was lost, named so a regression says what broke.
  for (const field of ['question', 'questionTarget', 'answer', 'stopReason', 'records']) {
    check(`forwards \`${field}\``, forwarded.has(field), 'dropped at the boundary');
  }
}

console.log(fail ? `\n${fail} FAILURES` : '\nthe panel contract holds');
process.exit(fail ? 1 : 0);
