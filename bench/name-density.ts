/**
 * NAME DENSITY PER PAGE — the measurement behind the reference-document damper.
 *
 * Layer 3 cannot tell "Vikram Sharma called this morning to dispute the charge" from
 * "Kapil Sibal argued for the petitioners". Both are a person's name in a sentence in a
 * `<p>`, both score 0.9 through the gazetteer, and one is the user's data while the other
 * is an encyclopedia's subject matter. No per-value signal separates them, so the
 * separation has to come from the PAGE.
 *
 * The claim being tested is this: your own personal data appears on a page in SMALL
 * NUMBERS. A form holds your name once. A bank statement holds an account holder. A case
 * note names a customer and the person it was escalated to. A page that mentions fifteen
 * different people is a page ABOUT people, and none of them are you.
 *
 * This prints, for every page in every corpus, how many DISTINCT names layer 3 would
 * redact and how many of its text blocks are paragraph-scale. The threshold in
 * sanitize.ts is chosen off this table with a stated margin, rather than fitted to
 * whichever number made Wikipedia pass.
 *
 *   node --experimental-strip-types bench/name-density.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadGazetteer, detectNames } from '../extension/src/pii/names.ts';

loadGazetteer(JSON.parse(readFileSync(
  new URL('../extension/models/name-gazetteer.json', import.meta.url), 'utf8')));

/** Mirrors sanitize.ts: a field holds a value, a paragraph holds prose. */
const PROSE_MIN = 120;

const corpora = ['pages', 'holdout', 'holdout-wild', 'realpages'];

console.log('page                                       names  prose-blocks');
console.log('-'.repeat(68));

for (const c of corpora) {
  const base = new URL(`./${c}/`, import.meta.url);
  for (const f of readdirSync(base).filter((x) => x.endsWith('.html'))) {
    const dom = new JSDOM(readFileSync(new URL(f, base), 'utf8'));
    const names = new Set<string>();
    let prose = 0;
    for (const el of dom.window.document.querySelectorAll('p,div,span,li,dd,td,h1,h2,h3')) {
      // Own text only, so a wrapper is not counted once per descendant.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join(' ')
        .trim();
      if (!own || own.length > 2000) continue;
      if (own.length >= PROSE_MIN) prose++;
      for (const n of detectNames(own)) if (n.confidence >= 0.6) names.add(n.text);
    }
    console.log(`${`${c}/${f}`.padEnd(42)} ${String(names.size).padStart(5)}`
      + `  ${String(prose).padStart(12)}`);
  }
}
