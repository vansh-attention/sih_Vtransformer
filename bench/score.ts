/**
 * The scorecard — SIH26171.
 *
 * Four of the five rubric metrics are numeric, so we build the scoreboard ourselves and
 * arrive at the finale with numbers instead of adjectives.
 *
 *   node --experimental-strip-types bench/score.ts            # tuned corpus
 *   node --experimental-strip-types bench/score.ts --holdout  # the sacred set
 *
 * HONESTY NOTES — read these before quoting any number from here.
 *
 * 1. This runs under Node + jsdom, which has no layout engine and no GPU. So:
 *    - Resource and latency figures are PROXIES. The real numbers come from the
 *      extension in a browser (Spikes A1/A2/D measured those).
 *    - Vision timing is excluded entirely; it cannot run here.
 * 2. The holdout was authored before the first scoring run and is never tuned against.
 *    It is still written by the same hands as the tuned set, so it is a weaker signal
 *    than a genuinely independent corpus. Treat the tuned/holdout gap as indicative,
 *    not as a guarantee about the finale's unseen sites.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from '../extension/src/content/extractor.ts';
import { sanitize } from '../extension/src/redact/sanitize.ts';
import { Vault } from '../extension/src/redact/vault.ts';
import { loadGazetteer } from '../extension/src/pii/names.ts';
import type { SanitizedNode } from '../extension/src/contracts.ts';

// PII layer 3 needs its gazetteer; without it names are silently not detected.
// `--no-layer3` measures the counterfactual, which is the only way to state what
// layer 3 actually buys and what it costs.
const NO_LAYER3 = process.argv.includes('--no-layer3');
if (!NO_LAYER3) {
  loadGazetteer(JSON.parse(readFileSync(
    new URL('../extension/models/name-gazetteer.json', import.meta.url), 'utf8')));
}

const HOLDOUT = process.argv.includes('--holdout');
const DIR = HOLDOUT ? 'holdout' : 'pages';

interface TruthElement {
  id: string;
  kind: string | null;
  redact: boolean;
  why?: string;
}
interface Truth {
  name: string;
  elements: TruthElement[];
  mustFind?: string[];
  mustNotFind?: string[];
  visionQueueMin?: number;
}

interface PageScore {
  name: string;
  tp: number; fp: number; fn: number; tn: number;
  contextKept: number; contextTotal: number;
  found: number; findTotal: number;
  leaked: string[];
  forbidden: string[];
  extractMs: number; sanitizeMs: number;
  nodes: number; heapMb: number;
  failures: string[];
}

function flatten(root: SanitizedNode): SanitizedNode[] {
  const out: SanitizedNode[] = [];
  (function walk(n: SanitizedNode) { out.push(n); n.children?.forEach(walk); })(root);
  return out;
}

function scorePage(file: string, truth: Truth): PageScore {
  const html = readFileSync(new URL(`./${DIR}/${file}`, import.meta.url), 'utf8');
  // `runScripts` so custom elements upgrade and attach their shadow roots. Without it
  // a web-component fixture is just three empty tags and proves nothing.
  const dom = new JSDOM(html, {
    url: `https://fixture.example.com/${truth.name}`,
    runScripts: 'dangerously',
  });
  const { window } = dom;

  // jsdom has no layout, so every rect would be 0x0 and everything would read as
  // invisible. Give elements a plausible box; hidden ones stay hidden.
  let top = 0;
  window.Element.prototype.getBoundingClientRect = function () {
    const el = this as Element;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden'
        || el.closest('[style*="display:none"]') || el.closest('[style*="visibility:hidden"]')) {
      return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} } as DOMRect;
    }
    top += 20;
    return { x: 10, y: top % 700, width: 200, height: 18, top: top % 700,
             left: 10, right: 210, bottom: (top % 700) + 18, toJSON() {} } as DOMRect;
  };
  globalThis.Node = window.Node;
  globalThis.CSS = window.CSS;
  globalThis.getComputedStyle = (el: Element) => window.getComputedStyle(el);

  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const { structure, nodeCount, visionQueue } = extractPage(window.document);
  const t1 = performance.now();

  const vault = new Vault();
  const { payload } = sanitize(structure, {
    goal: 'score', vault,
    signals: (id) => { const el = resolveElement(id); return el ? signalsFor(el) : undefined; },
  });
  const t2 = performance.now();
  const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576;

  // Map our minted el_N ids back to the fixture's DOM ids so truth can be applied.
  const domIdFor = new Map<string, string>();
  for (const node of flatten(payload.root)) {
    const el = resolveElement(node.id);
    if (el?.id) domIdFor.set(el.id, node.id);
  }
  const byOurId = new Map(flatten(payload.root).map((n) => [n.id, n]));

  const s: PageScore = {
    name: truth.name, tp: 0, fp: 0, fn: 0, tn: 0,
    contextKept: 0, contextTotal: 0, found: 0, findTotal: 0,
    leaked: [], forbidden: [],
    extractMs: t1 - t0, sanitizeMs: t2 - t1, nodes: nodeCount, heapMb,
    failures: [],
  };

  for (const t of truth.elements) {
    const ourId = domIdFor.get(t.id);
    const node = ourId ? byOurId.get(ourId) : undefined;
    if (!node) {
      // An element we were told about but never extracted. If it should have been
      // redacted, that is a miss; if it was a decoy, dropping it is harmless.
      if (t.redact) { s.fn++; s.failures.push(`${t.id}: expected redaction but element not extracted`); }
      continue;
    }

    const text = `${node.value ?? ''} ${node.label ?? ''}`;
    const wasRedacted = /<PII_[A-Z]+_\d+>/.test(text);

    if (t.redact && wasRedacted) {
      s.tp++;
      // REDACTION PRECISION: the value must go, and the surrounding context must not.
      // A redaction that blanks the whole field protects the value and destroys the
      // information the server needs — that is a failure, not a success.
      //
      // Only scored where DISTINCT context existed to lose. For a bare <span> the
      // accessible name IS the value, so replacing it wholesale is correct, not
      // over-redaction — an earlier version of this metric penalised exactly that and
      // reported a defect that was not one.
      const hasDistinctContext = !!node.contextLabel
        || (!!node.label && node.label !== node.value);
      if (hasDistinctContext) {
        s.contextTotal++;
        const contextSurvived = [node.label, node.contextLabel]
          .filter(Boolean)
          .some((txt) => !/^<PII_[A-Z]+_\d+>$/.test(txt!));
        if (contextSurvived) s.contextKept++;
        else s.failures.push(`${t.id}: over-redacted — all surrounding context destroyed`);
      }
    } else if (t.redact && !wasRedacted) {
      s.fn++;
      s.failures.push(`${t.id}: MISSED ${t.kind} (leak)`);
    } else if (!t.redact && wasRedacted) {
      s.fp++;
      s.failures.push(`${t.id}: over-redacted (${t.why ?? 'decoy'})`);
    } else {
      s.tn++;
    }
  }

  // The absolute invariant, independent of any labelling.
  const wire = JSON.stringify(payload);
  const norm = (x: string) => x.replace(/[\s\-()]/g, '').toLowerCase();
  const normWire = norm(wire);
  for (const secret of vault.secretsForLeakTestOnly()) {
    if (secret.length >= 6 && (wire.includes(secret) || normWire.includes(norm(secret)))) {
      s.leaked.push(secret);
    }
  }

  // VISUAL CONTEXT: did we keep the things a user could act on?
  const allText = flatten(payload.root).map((n) => `${n.label ?? ''} ${n.contextLabel ?? ''}`).join(' | ');
  for (const want of truth.mustFind ?? []) {
    s.findTotal++;
    if (allText.includes(want)) s.found++;
    else s.failures.push(`missing from tree: "${want}"`);
  }
  for (const forbidden of truth.mustNotFind ?? []) {
    if (wire.includes(forbidden)) { s.forbidden.push(forbidden); s.failures.push(`hidden content leaked: ${forbidden}`); }
  }
  if (truth.visionQueueMin && visionQueue.length < truth.visionQueueMin) {
    s.failures.push(`vision queue ${visionQueue.length} < expected ${truth.visionQueueMin}`);
  }

  return s;
}

// ---------------------------------------------------------------------------

const truths = readdirSync(new URL(`./${DIR}/`, import.meta.url))
  .filter((f) => f.endsWith('.truth.json'));

if (truths.length === 0) {
  console.error(`no .truth.json files in bench/${DIR}/`);
  process.exit(1);
}

console.log(`=== ${HOLDOUT ? 'HOLDOUT' : 'TUNED'} corpus — ${truths.length} pages${NO_LAYER3 ? ' — PII LAYER 3 DISABLED' : ''} ===\n`);

const scores: PageScore[] = [];
for (const tf of truths) {
  const truth: Truth = JSON.parse(
    readFileSync(new URL(`./${DIR}/${tf}`, import.meta.url), 'utf8'));
  scores.push(scorePage(tf.replace('.truth.json', '.html'), truth));
}

const sum = (f: (s: PageScore) => number) => scores.reduce((a, s) => a + f(s), 0);
const TP = sum((s) => s.tp), FP = sum((s) => s.fp), FN = sum((s) => s.fn);
const recall = TP + FN ? TP / (TP + FN) : 1;
const precision = TP + FP ? TP / (TP + FP) : 1;
const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
const redactionPrecision = sum((s) => s.contextTotal)
  ? sum((s) => s.contextKept) / sum((s) => s.contextTotal) : 1;
const contextAccuracy = sum((s) => s.findTotal)
  ? sum((s) => s.found) / sum((s) => s.findTotal) : 1;
const leaks = sum((s) => s.leaked.length) + sum((s) => s.forbidden.length);

console.log(`${'page'.padEnd(16)}${'TP'.padStart(4)}${'FP'.padStart(4)}${'FN'.padStart(4)}${'TN'.padStart(4)}  ${'extract'.padStart(9)}${'sanitize'.padStart(9)}${'nodes'.padStart(7)}`);
console.log('-'.repeat(64));
for (const s of scores) {
  console.log(`${s.name.padEnd(16)}${String(s.tp).padStart(4)}${String(s.fp).padStart(4)}${String(s.fn).padStart(4)}${String(s.tn).padStart(4)}  ${s.extractMs.toFixed(1).padStart(7)}ms${s.sanitizeMs.toFixed(1).padStart(7)}ms${String(s.nodes).padStart(7)}`);
}

console.log(`\n=== RUBRIC ===`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`  25%  visual context accuracy      ${pct(contextAccuracy).padStart(7)}   (${sum((s) => s.found)}/${sum((s) => s.findTotal)} expected elements present)`);
console.log(`  20%  PII detection                 recall ${pct(recall)}  precision ${pct(precision)}  F1 ${pct(f1)}`);
console.log(`  20%  redaction precision          ${pct(redactionPrecision).padStart(7)}   (${sum((s) => s.contextKept)}/${sum((s) => s.contextTotal)} kept surrounding context)`);
console.log(`  20%  client resources             ${(sum((s) => s.heapMb) / scores.length).toFixed(1).padStart(6)}MB   heap delta/page  [PROXY — real number is browser-side]`);
console.log(`  15%  latency (extract+sanitize)   ${(sum((s) => s.extractMs + s.sanitizeMs) / scores.length).toFixed(1).padStart(6)}ms   [PROXY — excludes vision and model]`);
console.log(`\n  HARD INVARIANT  vault leaks: ${leaks}${leaks ? '  ** FAILURE **' : '  (none)'}`);

const failures = scores.flatMap((s) => s.failures.map((f) => `${s.name}: ${f}`));
if (failures.length) {
  console.log(`\n=== ${failures.length} failure(s) ===`);
  for (const f of failures) console.log(`  ${f}`);
}

// Leaks are always fatal. Detection misses are reported but do not fail the run on the
// holdout, because the holdout exists to MEASURE generalisation, not to be passed.
process.exit(leaks > 0 ? 1 : 0);
