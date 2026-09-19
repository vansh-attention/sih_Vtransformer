import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPage, signalsFor, resolveElement, opaqueDocumentKind } from './extractor.ts';
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

/**
 * TABLE CONTEXT MUST NOT CARRY ANOTHER ROW'S DATA.
 *
 * `querySelector('tr')` returns the first row whether or not it is a header row. In a
 * header-LESS table that first row is DATA, so every later row was labelled with row
 * one's values: the order total's context came through as "123456789012 Order Total".
 *
 * That breaks the project's own rule — evidence about a value must not come from the
 * value — and it is not cosmetic. The bank-statement finding was a checksum-valid
 * total mis-redacted as an Aadhaar number precisely because foreign digits had leaked
 * into the context string.
 *
 * The whole 16-check suite passed both before and after the fix, so nothing covered
 * this. Both directions are asserted here: header-less falls back to the row label,
 * and a real <th> row still wins (the `tamil-opaque.html` finding must not regress).
 *
 * Rule 4: the expectations below are written out from the markup by hand. They are
 * never read back from the extractor, so breaking the extractor cannot quietly move
 * expectation and actual together.
 */
console.log('\n--- table context isolation ---');
{
  const mk = (markup: string) => {
    const d = new JSDOM(`<body>${markup}</body>`, { url: 'https://table.test/' });
    const w = d.window;
    let n = 0;
    (w as any).Element.prototype.getBoundingClientRect = function () {
      n += 20;
      return { x: 0, y: n, width: 120, height: 18, top: n, left: 0, right: 120, bottom: n + 18, toJSON(){} } as DOMRect;
    };
    globalThis.Node = w.Node; globalThis.CSS = w.CSS;
    globalThis.getComputedStyle = (el: Element) => w.getComputedStyle(el);
    extractPage(w.document, { maxNodes: 500 });
    return (id: string) => signalsFor(w.document.getElementById(id) as Element)?.contextLabel;
  };

  // No <th> anywhere: row 1 is data and must never be read as headers.
  const headerless = mk(`<table>
    <tr><td>Order Number</td><td id="h1">123456789012</td></tr>
    <tr><td>Order Total</td><td id="h2">999999999999</td></tr>
    <tr><td>Tracking (AWB)</td><td id="h3">4539578763621486</td></tr></table>`);
  check('header-less row 1 takes its row label', headerless('h1'), 'Order Number');
  check('header-less row 2 takes its row label', headerless('h2'), 'Order Total');
  check('header-less row 3 takes its row label', headerless('h3'), 'Tracking (AWB)');
  for (const [id, foreign] of [['h2', '123456789012'], ['h3', '123456789012']] as const) {
    check(`${id} context free of row 1's data`, (headerless(id) ?? '').includes(foreign), false);
  }

  // A real <th> row still supplies the column header, alongside the row label.
  const headed = mk(`<table>
    <tr><th>Description</th><th>Number</th></tr>
    <tr><td>Order Total</td><td id="t1">999999999999</td></tr></table>`);
  const t1 = headed('t1') ?? '';
  check('<th> column header is used',  t1.includes('Number'),      true);
  check('row label kept alongside it', t1.includes('Order Total'), true);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall extractor cases pass');


/**
 * A DOCUMENT WE CANNOT READ MUST ANNOUNCE ITSELF.
 *
 * He opened his IIT Madras ID card — a PDF at storage.googleapis.com — and Aavaran said
 * "Nothing of yours on this page" over a name, a mobile number, a full address, a date
 * of birth and a face. Extraction was correct: Chrome renders a PDF in another process,
 * so the DOM is a wrapper around an <embed> and there genuinely is no personal data IN
 * THE DOM. The bug was the confident claim made about it afterwards.
 */
console.log('\n--- documents whose content is not in the DOM ---');
{
  const make = (html: string) => {
    const d = new JSDOM(html).window.document;
    // jsdom has no layout, so the full-page test needs a box. 1280x900 viewport.
    Object.defineProperty(d.documentElement, 'clientWidth', { value: 1280, configurable: true });
    Object.defineProperty(d.documentElement, 'clientHeight', { value: 900, configurable: true });
    for (const el of Array.from(d.querySelectorAll('embed,object'))) {
      const w = Number((el as Element).getAttribute('data-w') ?? 0);
      const h = Number((el as Element).getAttribute('data-h') ?? 0);
      (el as HTMLElement).getBoundingClientRect = () =>
        ({ x: 0, y: 0, width: w, height: h, top: 0, left: 0, right: w, bottom: h,
           toJSON() {} }) as DOMRect;
    }
    return d;
  };

  const pdf = make('<body><embed type="application/pdf" data-w="1280" data-h="900"></body>');
  check('a full-page PDF embed is opaque',
    opaqueDocumentKind(pdf)?.kind, 'application/pdf');

  /**
   * THE CONTROL. A small embedded viewer inside an ordinary article is a REGION we
   * cannot read — `unreadableRegions` already strikes that out of the screenshot — not a
   * reason to declare the whole page unreadable and refuse to act on it. Without this
   * the rule would disable the agent on any page carrying an embedded map or video.
   */
  const article = make('<body><h1>Report</h1><p>Text we can read.</p>'
    + '<embed type="application/pdf" data-w="300" data-h="200"></body>');
  check('CONTROL: a small embed does NOT make the page opaque',
    opaqueDocumentKind(article), undefined);

  const plain = make('<body><h1>Ordinary</h1><p>Nothing embedded.</p></body>');
  check('CONTROL: an ordinary page is not opaque', opaqueDocumentKind(plain), undefined);

  /**
   * THE BRANCH THAT ACTUALLY FIRES IN CHROME, measured rather than assumed.
   *
   * A real PDF tab was probed over CDP and reports:
   *   contentType "application/pdf", 4 nodes, 0 characters of text, and NO <embed>
   *   visible to a content script at all — the viewer lives somewhere we cannot reach.
   *
   * So the embed test above is a fallback for other shapes, and `contentType` is the
   * signal doing the real work. Note the node count: 4, which sails past the existing
   * "blind" heuristic of two nodes or fewer. That is why this needed its own signal
   * rather than a wider version of an old one.
   */
  const realPdf = { contentType: 'application/pdf', querySelectorAll: () => [],
                    documentElement: { clientWidth: 1280, clientHeight: 900 } } as unknown as Document;
  check('Chrome\'s real PDF tab is opaque by content type',
    opaqueDocumentKind(realPdf)?.kind, 'application/pdf');

  const realHtml = { contentType: 'text/html', querySelectorAll: () => [],
                     documentElement: { clientWidth: 1280, clientHeight: 900 } } as unknown as Document;
  check('CONTROL: an ordinary text/html document is not opaque',
    opaqueDocumentKind(realHtml), undefined);

  const html = make('<body><embed type="text/html" data-w="1280" data-h="900"></body>');
  check('CONTROL: a full-page HTML embed is not opaque',
    opaqueDocumentKind(html), undefined);
}
