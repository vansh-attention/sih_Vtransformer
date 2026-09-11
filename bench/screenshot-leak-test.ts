/**
 * THE SECOND CHANNEL.
 *
 * `bench/leak-test.ts` proves no vault value appears in the outbound JSON. It has never
 * looked at the screenshot, and the screenshot is transmitted in the same request.
 *
 * That blind spot is this project's recurring leak shape, stated in RESUME.md: content
 * visible on screen but not accounted for by the redactor, while the image carries it
 * anyway. Four earlier bugs had it. This is the fifth, and the most general: a value can
 * be perfectly tokenised in the payload and perfectly legible in the picture beside it.
 *
 * So this test asserts the two channels AGREE. For every value the sanitizer redacts out
 * of the JSON, there must be a box telling the caller to strike the same value out of
 * the image.
 *
 *   node --experimental-strip-types bench/screenshot-leak-test.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement } from '../extension/src/content/extractor.ts';
import { sanitize } from '../extension/src/redact/sanitize.ts';
import { Vault } from '../extension/src/redact/vault.ts';
import { loadGazetteer } from '../extension/src/pii/names.ts';

loadGazetteer(JSON.parse(readFileSync(
  new URL('../extension/models/name-gazetteer.json', import.meta.url), 'utf8')));

interface Case {
  page: string;
  visionQueue: number;
  tokens: number;
  boxes: number;
  frames: number;
  /** Counted from the fixture's own DOM, NOT from the extractor. See below. */
  framesExpected: number;
  screenshotSent: boolean;
}

function run(dir: string, file: string): Case {
  const html = readFileSync(new URL(`./${dir}/${file}`, import.meta.url), 'utf8');
  const dom = new JSDOM(html, {
    url: `https://fixture.example.com/${file}`,
    runScripts: 'dangerously',
  });
  const { window } = dom;

  // Same box stub as score.ts: jsdom has no layout, so without this every node reads as
  // invisible and the test would pass by measuring nothing.
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

  const { structure, visionQueue, unreadableRegions } = extractPage(window.document);
  const vault = new Vault();
  const { payload, piiBoxes } = sanitize(structure, {
    goal: 'screenshot leak test',
    vault,
    signals: (id) => { const el = resolveElement(id); return el ? signalsFor(el) : undefined; },
  });

  const tokens = new Set(JSON.stringify(payload).match(/<PII_[A-Z]+_\d+>/g) ?? []);
  return {
    page: file.replace(/\.html$/, ''),
    visionQueue: visionQueue.length,
    tokens: tokens.size,
    // What the content script actually sends: redacted boxes PLUS frames it cannot read.
    boxes: piiBoxes.length + unreadableRegions.length,
    frames: unreadableRegions.length,
    /**
     * INDEPENDENT EXPECTATION.
     *
     * Taking the expected count from `unreadableRegions` would make the assertion
     * circular: break the detection and the expectation drops to zero with it, so the
     * test goes green while the leak is live. That is exactly the `[].every()` trap this
     * project has already been bitten by once, and the first version of this check had
     * it — caught by sabotaging the detection and watching the test still pass.
     *
     * So count the frames from the fixture's own DOM instead.
     */
    framesExpected: [...window.document.querySelectorAll('iframe, frame')]
      .filter((el) => {
        const st = window.getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden';
      }).length,
    // The orchestrator transmits an image exactly when the vision queue is non-empty.
    screenshotSent: visionQueue.length > 0,
  };
}

const cases: Case[] = [];
for (const dir of ['pages', 'holdout']) {
  for (const f of readdirSync(new URL(`./${dir}/`, import.meta.url))) {
    if (f.endsWith('.html')) cases.push(run(dir, f));
  }
}

console.log('=== THE TWO CHANNELS MUST AGREE ===\n');
console.log('page              vision  tokens  frames  masks  screenshot');
console.log('-'.repeat(64));

let fail = 0;
let covered = 0;
for (const c of cases) {
  // The failure condition: an image goes out, values were redacted from the JSON, and
  // nothing tells the caller to strike them out of the image.
  const needsMasking = c.tokens > 0 || c.framesExpected > 0;
  const bad = c.screenshotSent && needsMasking && c.boxes === 0;
  // A frame is a region we never read. Every visible one MUST be reported as unreadable,
  // whether or not this page happened to redact anything of its own.
  const frameBad = c.framesExpected > c.frames;
  if (bad || frameBad) fail++;
  if (c.screenshotSent && needsMasking) covered++;
  console.log(
    `${c.page.padEnd(17)} ${String(c.visionQueue).padStart(5)}  `
    + `${String(c.tokens).padStart(6)}  ${String(c.frames)}/${c.framesExpected}`.padEnd(11)
    + `${String(c.boxes).padStart(5)}  `
    + `${c.screenshotSent ? 'SENT' : 'skipped'}${bad || frameBad ? '   <-- LEAK' : ''}`);
}

/**
 * COVERAGE FIRST.
 *
 * A green test that cannot fail is worse than no test — `[].every()` is `true`, and this
 * project has already shipped one suite that passed while the extractor returned zero
 * nodes. If no fixture both transmits an image AND redacts something, this file proves
 * nothing and must say so rather than print a reassuring tick.
 */
console.log();
if (covered === 0) {
  console.log('FAIL  no fixture exercises the case: image transmitted AND values redacted.');
  console.log('      This test cannot fail, so it is not evidence. Add such a fixture.');
  process.exit(1);
}
console.log(`ok    ${covered} fixtures transmit an image while holding redacted values`);

if (fail) {
  console.log(`\n${fail} PAGE(S) LEAK THROUGH THE IMAGE`);
  console.log('The payload is clean and the screenshot beside it is not. Redacting one');
  console.log('channel is not redaction.');
  process.exit(1);
}
console.log('ok    every redacted value has a mask box for the image');

/**
 * THE COORDINATE SPACE — Spike C's failure class.
 *
 * A mask box in the wrong space paints a bar somewhere harmless and leaves the value
 * fully legible. The image looks processed, so nothing looks wrong. This asserts the
 * mapping on numbers, because nothing else will.
 */
console.log('\n=== CSS px -> image px ===\n');
const { scaleToImage } = await import('../extension/src/vision/detect.ts');
const box = { x: 10, y: 20, w: 200, h: 18 };
const mappings: Array<[string, { innerWidth: number; innerHeight: number } | undefined,
                       { width: number; height: number }, number]> = [
  ['1x display   ', { innerWidth: 1200, innerHeight: 800 }, { width: 1200, height: 800 }, 1],
  ['2x Retina    ', { innerWidth: 1200, innerHeight: 800 }, { width: 2400, height: 1600 }, 2],
  ['downscaled   ', { innerWidth: 2048, innerHeight: 1366 }, { width: 1024, height: 683 }, 0.5],
];
let scaleFail = 0;
for (const [name, vp, img, want] of mappings) {
  const [got] = scaleToImage([box], vp, img);
  const ok = Math.abs(got.x - box.x * want) < 0.01 && Math.abs(got.w - box.w * want) < 0.01;
  if (!ok) scaleFail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name} expected ${want}x  ->  `
    + `x=${got.x.toFixed(1)} w=${got.w.toFixed(1)}`);
}
// An unknown viewport must not silently scale by 1: that would be a guess presented as
// a measurement. It is the caller's job never to send one, and this pins the behaviour.
const [identity] = scaleToImage([box], undefined, { width: 2400, height: 1600 });
const identityOk = identity.x === box.x && identity.w === box.w;
console.log(`  ${identityOk ? 'ok  ' : 'FAIL'}  no viewport   falls back to 1x, unscaled`);
if (!identityOk) scaleFail++;

if (scaleFail) {
  console.log(`\n${scaleFail} COORDINATE MAPPING FAILURES`);
  process.exit(1);
}

console.log('\nboth channels agree');
