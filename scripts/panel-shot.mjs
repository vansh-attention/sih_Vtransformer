/**
 * Screenshot the side panel, in every state, at real panel width.
 *
 * A design change is only as good as the pixels it produces, and the panel is the
 * one surface nothing in the suite looks at — `test-all.sh` proves the detector is
 * right and says nothing about whether the thing a human sees is legible. This
 * closes that: it renders the real index.html against the real built panel.js and
 * writes PNGs that can be opened and judged.
 *
 * The panel is served over http rather than loaded as an extension, and the few
 * chrome.* APIs it touches are stubbed before the module runs. That keeps the
 * harness deterministic — no profile, no service worker, no model, no network —
 * and it is the stylesheet and layout being tested here, not the browser plumbing.
 *
 *   node scripts/panel-shot.mjs [--width 400] [--out /tmp/panel]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const WIDTH = Number(arg('--width', 400));
const OUT = arg('--out', '/tmp/panel-shots');
const PORT = 8987;
const CDP_PORT = 9334;

mkdirSync(OUT, { recursive: true });

/* ── find Chrome the same way the spikes do ─────────────────────────────── */
function findChrome() {
  const candidates = [
    `${process.env.HOME}/.cache/sih-browsers/chrome/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    `${process.env.HOME}/.cache/sih-browsers/chrome/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // fall back to whatever find-browser.sh resolves
  try {
    return execFileSync('bash', ['-c',
      `. ${ROOT}/scripts/find-browser.sh && find_chrome`], { encoding: 'utf8' }).trim();
  } catch { return null; }
}

/* ── serve extension/ ───────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const server = http.createServer(async (req, res) => {
  const path = normalize(join(`${ROOT}/extension`, decodeURIComponent(req.url.split('?')[0])));
  if (!path.startsWith(`${ROOT}/extension`)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* ── launch ─────────────────────────────────────────────────────────────── */
const CHROME = findChrome();
if (!CHROME) { console.error('no Chrome — run scripts/get-chrome-for-testing.sh'); process.exit(1); }

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  '--user-data-dir=/tmp/panel-shot-profile', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=2', 'about:blank',
], { stdio: 'ignore' });

/* ── CDP ────────────────────────────────────────────────────────────────── */
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('CDP never came up');
}
const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  const p = pending.get(m.id);
  if (p) { pending.delete(m.id); p(m); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const msgId = ++id; pending.set(msgId, resolve);
  ws.send(JSON.stringify({ id: msgId, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');

/**
 * Stub the extension APIs BEFORE the panel module runs.
 *
 * Each state below decides what chrome.* returns, so one harness can render the
 * offline case, the scan result and a finished run without a server or a model.
 */
function stub({ tabUrl, health, scan, run }) {
  return `
  globalThis.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [{ url: ${JSON.stringify(tabUrl)} }],
            onActivated: { addListener(){} }, onUpdated: { addListener(){} } },
    runtime: { onMessage: { addListener(){} },
      sendMessage: async (m) => m.type === 'scan-page' ? ${JSON.stringify(scan)}
                             : m.type === 'run-agent'  ? ${JSON.stringify(run)} : {} },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => String(u).includes('/health')
    ? new Response(JSON.stringify(${JSON.stringify(health)}), { headers: { 'content-type': 'application/json' } })
    : realFetch(u, o);
  `;
}

const HEALTH_OK = { ok: true, model: 'qwen2.5vl:7b' };
const HEALTH_DOWN = { ok: false, error: 'not ready' };

const SCAN = {
  title: 'Income Tax e-Filing', url: 'https://eportal.incometax.gov.in', nodeCount: 101,
  bytes: 13079,
  withheld: [{ kind: 'PAN', count: 1 }, { kind: 'NAME', count: 2 }, { kind: 'PHONE', count: 1 }],
  previews: [
    { token: '<PII_PAN_1>', kind: 'PAN', masked: 'ABC••••••F' },
    { token: '<PII_NAME_1>', kind: 'NAME', masked: 'Ha••• Ba•••i' },
    { token: '<PII_NAME_2>', kind: 'NAME', masked: 'Pu•• Sa•••r' },
    { token: '<PII_PHONE_1>', kind: 'PHONE', masked: '99••••••41' },
  ],
  unreadable: [], truncated: false,
};

const RUN = {
  stopReason: 'goal-complete',
  previews: SCAN.previews,
  records: [{
    turn: 1, origin: 'eportal.incometax.gov.in', nodeCount: 101, transmittedBytes: 47104,
    withheld: [{ kind: 'PAN', count: 1 }, { kind: 'NAME', count: 2 }],
    facesBlurred: 1, piiMasked: 3,
    timings: { extractMs: 12, sanitizeMs: 4, visionMs: 65, networkMs: 3820, totalMs: 3901 },
    actions: [{ allowed: true, executed: true,
      action: { kind: 'type', target: '#pan', value: '<PII_PAN_1>',
                reasoning: 'The PAN field is empty and the form cannot be submitted without it.' } },
      { allowed: false, reason: 'target is outside the form being completed',
        action: { kind: 'click', target: 'a.external',
                  reasoning: 'Following the help link.' } }],
    transmitted: { goal: 'Fill in the form and submit it',
                   nodes: [{ role: 'textbox', label: 'PAN', value: '<PII_PAN_1>' }] },
  }],
};

const STATES = [
  // Captured mid-sweep on purpose: the launch screen is the one moment that a
  // still cannot otherwise show, and it is the first thing anyone sees.
  { name: '0-launch-screen', tabUrl: 'https://eportal.incometax.gov.in/iec/foservices/',
    health: HEALTH_OK, scan: SCAN, run: RUN, after: null, splash: true },
  { name: '1-idle-server-ready', tabUrl: 'https://eportal.incometax.gov.in/iec/foservices/',
    health: HEALTH_OK, scan: SCAN, run: RUN, after: null },
  { name: '2-server-offline', tabUrl: 'chrome://extensions/',
    health: HEALTH_DOWN, scan: SCAN, run: RUN, after: null },
  { name: '3-scan-result', tabUrl: 'https://eportal.incometax.gov.in/iec/foservices/',
    health: HEALTH_OK, scan: SCAN, run: RUN, after: `document.getElementById('scan').click()` },
  { name: '4-run-complete', tabUrl: 'https://eportal.incometax.gov.in/iec/foservices/',
    health: HEALTH_OK, scan: SCAN, run: RUN,
    after: `document.getElementById('goal').value='Fill in the form and submit it';
            document.getElementById('run').click()` },
  { name: '5-settings-open', tabUrl: 'https://eportal.incometax.gov.in/iec/foservices/',
    health: HEALTH_OK, scan: SCAN, run: RUN,
    after: `document.getElementById('settings').open=true` },
];

let priorStub = null;
for (const s of STATES) {
  await send('Page.navigate', { url: 'about:blank' });
  await new Promise((r) => setTimeout(r, 150));
  // These REGISTRATIONS ACCUMULATE. Without removing the previous one, every
  // state after the first ran with the first state's stub still installed — the
  // offline shot rendered a healthy server and looked entirely plausible.
  if (priorStub) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: priorStub });
  const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: stub(s) });
  priorStub = added.result?.identifier ?? null;
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: 1500, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/src/panel/index.html` });

  // The launch screen is dismissed by CSS at 1.05s + 0.34s fade. The old 1400ms
  // wait landed exactly on that boundary, so a shot could catch the splash
  // half-faded over the panel and look like a rendering fault.
  if (s.splash) {
    await new Promise((r) => setTimeout(r, 520));  // mid-sweep, bar partly across
  } else {
    await new Promise((r) => setTimeout(r, 2100)); // splash fully gone, fonts settled
  }
  if (s.after) {
    await send('Runtime.evaluate', { expression: s.after, awaitPromise: false });
    await new Promise((r) => setTimeout(r, 1600)); // let count-up + stagger finish
  }

  // Size the shot to the content so nothing is cropped and nothing is padded.
  // CDP nests twice: { id, result: { result: { value } } }. Reading one level of
  // it gave NaN, and setDeviceMetricsOverride accepted the NaN silently — the
  // screenshots came out at the previous height and looked plausible.
  // The splash is position:fixed, so it fills the VIEWPORT, not the content box.
  // Sizing that shot to content height would centre the wordmark in whatever the
  // panel happens to be tall — shoot it at a realistic side-panel height instead.
  if (s.splash) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: 820, deviceScaleFactor: 2, mobile: false });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${s.name}.png`, Buffer.from(shot.result.data, 'base64'));
    console.log(`${s.name}.png  ${WIDTH}x820  (mid-sweep)`);
    continue;
  }

  const evaluated = await send('Runtime.evaluate', {
    // scrollHeight floors at the viewport, so every state measured 1508 and the
    // shots were mostly empty background. The panel's own box is the real height.
    expression: 'Math.ceil(document.querySelector(".app").getBoundingClientRect().bottom)',
    returnByValue: true });
  const measured = evaluated.result?.result?.value;
  if (!Number.isFinite(measured)) throw new Error(`could not measure height: ${JSON.stringify(evaluated)}`);
  const height = Math.min(measured + 8, 4000);
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height, deviceScaleFactor: 2, mobile: false });
  await new Promise((r) => setTimeout(r, 250));

  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(`${OUT}/${s.name}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log(`${s.name}.png  ${WIDTH}x${height}`);
}

/**
 * Accessibility invariants, asserted on the LIVE DOM.
 *
 * These are the fixes from the Web Interface Guidelines review, and every one of
 * them is invisible: an unlabelled input, a silent live region and an icon that
 * announces itself all look perfect in a screenshot. A check is the only thing
 * that can notice them coming back.
 */
const a11y = await send('Runtime.evaluate', {
  expression: `JSON.stringify((() => {
    const fails = [];
    // every control has an accessible name
    for (const el of document.querySelectorAll('input, button')) {
      const labelled = el.labels?.length
        || el.getAttribute('aria-label')
        || el.textContent.trim().length;
      if (!labelled) fails.push('unnamed control: ' + (el.id || el.className));
    }
    // clicking the label must focus the field
    const lab = document.querySelector('label[for="goal"]');
    if (!lab) fails.push('#goal has no <label for>');
    // icons must not be announced
    // NOTE: lucide sets aria-hidden itself, so this can only ever catch a
    // HAND-WRITTEN inline <svg> — which is exactly what it caught in sabotage.
    // Identify it by its parent chain; an <svg> has no useful id of its own.
    for (const svg of document.querySelectorAll('svg')) {
      if (svg.getAttribute('aria-hidden') !== 'true') {
        const where = svg.closest('[id]')?.id
          || svg.parentElement?.className
          || svg.parentElement?.tagName
          || 'unknown';
        fails.push('icon not aria-hidden, inside: ' + where);
      }
    }
    // async surfaces must announce
    for (const id of ['phase', 'lamp', 'target', 'serverstatus']) {
      const el = document.getElementById(id);
      if (!el) { fails.push('missing #' + id); continue; }
      if (el.getAttribute('aria-live') !== 'polite') fails.push('#' + id + ' not aria-live');
    }
    // the lamp's label element must exist, or setLamp writes into the dot
    if (!document.getElementById('lamptext')) fails.push('#lamptext missing');
    // a focusable summary needs a focus style
    const sum = document.querySelector('#settings summary');
    if (sum && !getComputedStyle(sum).outlineStyle) fails.push('summary has no outline rule');
    return { fails, controls: document.querySelectorAll('input, button').length,
             icons: document.querySelectorAll('svg[aria-hidden="true"]').length };
  })())`, returnByValue: true });
const report = JSON.parse(a11y.result.result.value);
console.log(`a11y: ${report.controls} controls, ${report.icons} icons hidden, `
  + `${report.fails.length} failure(s)`);
for (const f of report.fails) console.error(`  ✘ ${f}`);
if (report.fails.length) process.exitCode = 1;

/* A font that failed to load leaves the panel on a fallback and the whole
   redesign looks half-applied — so assert it, rather than eyeballing it. */
/**
 * ⚠ `document.fonts.check()` is NOT the test it looks like — it returns true when a
 * FALLBACK can render the text, so it reported success for "Inter" and "JetBrains
 * Mono" long after both had been removed from the panel. The only honest signal is
 * which faces actually reached status 'loaded'.
 */
const EXPECT_FONTS = ['Archivo Black', 'Geist', 'Geist Mono'];
const fonts = await send('Runtime.evaluate', {
  expression: `JSON.stringify([...document.fonts]
    .filter(f => f.status === 'loaded').map(f => f.family))`, returnByValue: true });
const loaded = JSON.parse(fonts.result.result.value);
const missingFonts = EXPECT_FONTS.filter((f) => !loaded.includes(f));
console.log(`fonts loaded: ${loaded.join(', ') || '(none)'}`);
if (missingFonts.length) {
  console.error(`  ✘ not loaded, panel is on a fallback: ${missingFonts.join(', ')}`);
  process.exitCode = 1;
}

ws.close(); chrome.kill(); server.close();
process.exit(0);
