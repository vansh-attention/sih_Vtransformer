/**
 * Side panel — SIH26171.
 *
 * Two jobs: take a goal, and make the privacy claim CHECKABLE while the agent runs.
 *
 * The ledger is not a status readout. Every team will say their pipeline is private;
 * this is what lets a judge verify it in the room — withheld counts, masked shadows of
 * what was destroyed, and the exact bytes transmitted, one click away.
 */

import { animate, stagger, press, hover } from 'motion';
import {
  createIcons, Zap, Square, ScanEye, Settings2, ShieldCheck, Lightbulb, FileSearch,
} from 'lucide';

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * Motion, bundled — never fetched.
 *
 * MV3 forbids remote code, so the library ships inside the extension like
 * everything else. The springs here are the same oscillators the stylesheet's
 * linear() curves were integrated from, so CSS-driven and JS-driven motion in
 * this panel obey one physics rather than two sets of hand-picked numbers.
 */
const SPRING = { type: 'spring', stiffness: 520, damping: 30 } as const;
const SPRING_SOFT = { type: 'spring', stiffness: 260, damping: 26 } as const;

/** Someone who has asked the OS for less motion gets none of it. */
const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate, or place instantly if the user opted out. */
function enter(els: Element | Element[], opts: Record<string, unknown> = {}): void {
  const list = Array.isArray(els) ? els : [els];
  if (!list.length) return;
  if (STILL) return;
  void animate(
    list,
    { opacity: [0, 1], transform: ['translateY(6px)', 'translateY(0px)'] },
    { ...SPRING, ...opts },
  );
}

/**
 * Count a number up rather than printing it.
 *
 * Not decoration: the totals are the claim this whole product makes, and a
 * figure that lands by moving is a figure the eye follows to. "0 values leaked"
 * counting to zero also reads, correctly, as a measurement rather than a label.
 */
function countUp(el: Element, to: number, suffix = ''): void {
  if (STILL || to === 0) { el.textContent = `${to}${suffix}`; return; }
  void animate(0, to, {
    duration: 0.9,
    ease: [0.16, 1, 0.3, 1],
    onUpdate: (v: number) => {
      el.textContent = suffix === 's' ? `${v.toFixed(1)}${suffix}` : `${Math.round(v)}${suffix}`;
    },
  });
}

/**
 * Every icon here sits beside its own text label, so all of them are decorative.
 *
 * `aria-hidden` is REDUNDANT — lucide adds it itself unless the placeholder already
 * carries an a11y prop (`replaceElement.mjs`, `hasA11yProp`). It is stated anyway so
 * that reading this file tells you the icons are hidden, rather than requiring you to
 * know a library default. `focusable: 'false'` is NOT a lucide default and is the part
 * doing real work here.
 *
 * ⚠ Consequence: the icon assertion in `scripts/panel-shot.mjs` cannot fail for these
 * icons however they are configured. It still catches a hand-written inline <svg>,
 * which is verified by sabotage — that is the case it exists for.
 */
createIcons({
  icons: { Zap, Square, ScanEye, Settings2, ShieldCheck, Lightbulb, FileSearch },
  attrs: { 'stroke-width': 2.1, 'aria-hidden': 'true', focusable: 'false' },
});

/**
 * Numbers, formatted for the reader's locale, with the unit bound to the value.
 *
 * Two reasons this is not string concatenation. A hard space between the figure
 * and its unit stops "3901" and "ms" landing on different lines, which happens
 * constantly in a 400px panel and reads as two separate facts. And Intl means an
 * Indian reader sees 1,20,000 rather than a grouping nobody here writes.
 */
const num = (n: number) => new Intl.NumberFormat(navigator.language).format(n);
/** "1 value", "4 values" — never "value(s)", which asks the reader to do the work. */
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const ms = (n: number) => `${num(n)}&nbsp;ms`;
const kb = (bytes: number) =>
  `${new Intl.NumberFormat(navigator.language, { maximumFractionDigits: 1 })
    .format(bytes / 1024)}&nbsp;KB`;

/**
 * Draw a masked value as the BAR that actually covers it, not as bullet dots.
 *
 * `maskPreview` returns e.g. `AB••••••F` — two characters of recognition, the rest
 * destroyed. Rendering those bullets as a solid block is the honest picture: it is
 * precisely what the redactor paints over the value in the transmitted screenshot,
 * and for the same reason a blur was rejected there. The kept characters stay
 * readable so a reader can tell WHICH field it was without the value surviving.
 *
 * Width is in `ch`, so the bar covers exactly the columns the characters occupied
 * in the monospaced face and the row cannot reflow when the mask length changes.
 */
function maskHtml(masked: string): string {
  return esc(masked).replace(/•+/g,
    (run) => `<span class="blk" style="width:${run.length}ch"></span>`);
}

/** Shimmering placeholders for the shape of the result that is coming. */
const SKELETON = '<div class="skel"><i></i><i></i><i></i></div>';

interface Preview { token: string; kind: string; masked: string }

function renderTurn(rec: any, previews: Map<string, Preview>): string {
  const t = rec.timings;
  const chips = (rec.withheld ?? [])
    .map((w: any) => `<span class="chip"><b>${w.count}</b> ${esc(w.kind)}</span>`).join('')
    || '<span class="chip">nothing withheld</span>';

  const faces = rec.facesBlurred
    ? `<span class="chip"><b>${rec.facesBlurred}</b> FACE blurred</span>` : '';

  // The screenshot half of the redaction. Without this the panel says a PAN was withheld
  // while the image beside it carried the PAN in pixels, and nothing on screen said so.
  const struck = rec.piiMasked
    ? `<span class="chip"><b>${rec.piiMasked}</b> struck out of screenshot</span>` : '';

  const actions = (rec.actions ?? []).map((a: any) => `
    <div class="row">
      <span class="${a.allowed ? 'allow' : 'deny'}">${a.allowed ? 'ALLOW' : 'DENY '}</span>
      <b>${esc(a.action.kind)}</b> ${esc(a.action.target ?? '')}
      ${a.action.value ? `<span class="tok" translate="no">${esc(a.action.value)}</span>` : ''}
      ${a.allowed && a.executed === false ? '<span class="deny">(not executed)</span>' : ''}
      <div class="t">${esc(a.action.reasoning ?? '')}</div>
      ${a.reason ? `<div class="deny t">refused: ${esc(a.reason)}</div>` : ''}
    </div>`).join('');

  const masked = [...previews.values()].slice(0, 8).map((p) =>
    `<div class="row"><span class="mask" translate="no">${maskHtml(p.masked)}</span> &rarr; <span class="tok" translate="no">${esc(p.token)}</span></div>`
  ).join('');

  // A withheld screenshot is a PROTECTION FIRING, not an error. It was recorded and
  // never shown, so the user saw "vision 0ms" and no explanation at all.
  const withheldShot = rec.visionError
    ? `<div class="withheld-note">Screenshot withheld — ${esc(String(rec.visionError))}</div>`
    : '';

  return `<div class="turn">
    <h2>Turn ${rec.turn} &middot; ${esc(rec.origin)}</h2>
    ${withheldShot}
    <div class="row">${chips}${faces}${struck}</div>
    ${masked}
    ${actions}
    <details><summary>Raw bytes transmitted this turn — inspect it yourself</summary>
      <pre>${esc(JSON.stringify(rec.transmitted ?? { note: 'payload omitted', bytes: rec.transmittedBytes }, null, 2))}</pre>
    </details>
    <div class="row t nums">
      extract <b>${ms(t.extractMs)}</b> &middot; sanitize <b>${ms(t.sanitizeMs)}</b> &middot;
      vision <b>${ms(t.visionMs)}</b> &middot; model <b>${ms(t.networkMs)}</b> &middot;
      total <b>${ms(t.totalMs)}</b> &middot; ${num(rec.nodeCount)}&nbsp;nodes &middot;
      ${kb(rec.transmittedBytes)} sent
    </div>
  </div>`;
}

const DEFAULT_SERVER = 'http://127.0.0.1:8975';

/**
 * What kind of build is this, and can its server be started at all?
 *
 * `build-info.json` is stamped by `build.mjs` (repo, with absolute paths) and replaced
 * by `scripts/package-extension.sh` (scan-only). Reading it is what stops the panel
 * telling a zip user to `cd server` — a directory the zip does not contain.
 */
interface BuildInfo {
  variant: 'repo' | 'scan-only';
  root?: string;
  setupNeeded?: boolean;
  setupCommand?: string;
  startCommands?: string[];
  note?: string;
}
let build: BuildInfo = { variant: 'repo' };

async function loadBuildInfo(): Promise<void> {
  try {
    const r = await fetch(chrome.runtime.getURL('build-info.json'));
    if (r.ok) build = await r.json();
  } catch {
    // An older package with no stamp. Leave the default and say nothing misleading.
  }
}

/**
 * In a scan-only package the agent can NEVER run, so Run must not look pressable.
 *
 * It was the big white primary button next to instructions that could not be followed.
 * A control that cannot work should say so before it is pressed, not after.
 */
function applyBuildVariant(): void {
  if (build.variant !== 'scan-only') return;
  const run = $('run') as HTMLButtonElement;
  run.disabled = true;
  run.title = 'This package ships the scanner only — it contains no reasoning server.';
  $('goal').setAttribute('disabled', '');
  ($('goal') as HTMLInputElement).placeholder = 'Needs the full repository';
  $('scan').classList.add('promoted');
  $('serveradvice').innerHTML =
    '<b>This package cannot run the agent.</b> It ships the scanner only and contains '
    + 'no reasoning server — there is nothing to start. <b>Scan this page</b> needs no '
    + 'server and is the whole privacy demonstration. To run the agent, clone the '
    + 'repository and follow its README.';
  $('serveradvice').hidden = false;
}

/**
 * The server URL is configurable rather than compiled in.
 *
 * Teammates run the server on whatever port is free, and at the finale it may not be
 * on this machine at all. Requiring a source edit to change it is a trap: the person
 * who hits it is under time pressure and does not know the code.
 */
async function loadServer(): Promise<string> {
  const { serverUrl } = await chrome.storage.local.get('serverUrl');
  return serverUrl || DEFAULT_SERVER;
}

/** Probe one URL. Short timeout: a wrong port should fail fast, not hang. */
async function probe(url: string, ms = 1500): Promise<{ ok: boolean; model?: string; detail?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${url}/health`, { signal: ctl.signal }).then((x) => x.json());
    if (r.ok) return { ok: true, model: r.model };
    return {
      ok: false,
      model: r.available?.length ? r.model : undefined,
      detail: r.available?.length
        ? `model ${r.model} is not installed`
        : String(r.error ?? 'not ready'),
    };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Reflect the server in the header lamp as well as inside Settings.
 *
 * The state that decides whether "Run" can work at all was previously legible
 * only after opening a collapsed <details>. A user whose server is down pressed
 * the big button and read a failure, when the panel already knew.
 */
/** Reveal the status card — it starts hidden so the idle panel has no dead block. */
function showPhase(): void { $('phase').hidden = false; }

function setLamp(state: 'ok' | 'bad' | 'unknown', label: string): void {
  const lamp = $('lamp');
  lamp.className = `lamp${state === 'unknown' ? '' : ` ${state}`}`;
  // Write to #lamptext, never querySelector('span') — the first span is now the
  // decorative dot, and writing text into it would both lose the label and make
  // the dot announce itself.
  //
  // Short text only — the header has no room for a sentence. The context ("Reasoning
  // server:") is a visually-hidden prefix in the markup, so the eye reads READY and a
  // screen reader hears the whole thing.
  $('lamptext').textContent = label;
  // When the model cannot be reached, Run is dead weight and Scan is the whole
  // demo — so the two SWAP visual roles rather than leaving the user to discover
  // it by pressing the big button and reading a failure.
  // In a scan-only package Scan is permanently the primary action, so this must not
  // toggle it back off — setLamp runs after applyBuildVariant and was clobbering it.
  const down = state === 'bad' || build.variant === 'scan-only';
  $('scan').classList.toggle('promoted', down);
  $('run').classList.toggle('demoted', down);
}

async function checkServer(url: string): Promise<boolean> {
  const el = $('serverstatus');
  el.innerHTML = 'checking…';
  setLamp('unknown', 'checking');
  const r = await probe(url, 4000);
  if (r.ok) {
    el.innerHTML = `<span class="allow">ready</span> · ${esc(r.model ?? '')}`;
    setLamp('ok', 'ready');
  } else if (r.detail) {
    el.innerHTML = `<span class="deny">not ready</span> · ${esc(r.detail)}`;
    setLamp('bad', 'no model');
    // The server answered, so it is running — only the model is absent. Different
    // problem, different command, and it must be copyable for the same reason.
    if (r.model) {
      const box = $('serveradvice');
      // A BUTTON, NOT A COMMAND. The 6 GB download is the step most likely to kill a
      // demo, and `ollama pull` in a terminal the reader has never opened is the worst
      // possible place to put it. The server proxies the pull because ollama answers a
      // chrome-extension:// origin with 403 and a localhost one with 200.
      box.innerHTML = `<b>The server is running, but the model is not installed.</b> `
        + `It is about 6&nbsp;GB and only downloads once.`
        + `<button type="button" id="pullmodel" class="pullbtn">`
        + `Install ${esc(r.model)}</button>`
        + `<div class="bar" id="pullbar" hidden><i></i></div>`
        + `<div class="t" id="pulltext"></div>`
        + `<div class="advice-note"><b>Scan this page</b> needs none of this.</div>`;
      box.hidden = false;
      $('pullmodel').addEventListener('click', () => void pullModel(url));
    }
  } else {
    el.innerHTML = '<span class="deny">unreachable</span>';
    setLamp('bad', 'offline');
    showStartAdvice();
  }
  return r.ok;
}

/**
 * Download the model from the panel, with real progress.
 *
 * ollama reports progress PER LAYER, so a naive reading shows the bar jumping back to
 * zero every time a new blob starts. Totals are accumulated per digest and summed, which
 * is the only number that means anything to a person watching a 6 GB download.
 *
 * ⚠ It must be able to FAIL VISIBLY. A stalled pull that sits at 40% forever is worse
 * than an error, so this watches for bytes not moving and says so rather than relying on
 * a timeout, which would kill a healthy slow connection at a venue.
 */
async function pullModel(serverUrl: string): Promise<void> {
  const btn = $('pullmodel') as HTMLButtonElement;
  const bar = $('pullbar');
  const fill = bar.querySelector('i') as HTMLElement;
  const text = $('pulltext');
  btn.disabled = true;
  btn.textContent = 'Downloading…';
  bar.hidden = false;

  const layers = new Map<string, { total: number; completed: number }>();
  let lastBytes = -1;
  let lastMoved = Date.now();
  const stallCheck = setInterval(() => {
    if (Date.now() - lastMoved > 45_000) {
      text.innerHTML = '<span class="deny">No progress for 45 seconds.</span> The '
        + 'connection may have stalled — it is safe to press Install again, ollama '
        + 'resumes where it stopped.';
    }
  }, 5_000);

  try {
    const res = await fetch(`${serverUrl}/pull`, { method: 'POST' });
    if (!res.ok || !res.body) throw new Error(`server returned ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // NDJSON: split on newlines and keep the trailing partial line for next time.
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: { status?: string; digest?: string; total?: number; completed?: number; error?: string };
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.error) throw new Error(msg.error);

        if (msg.digest && typeof msg.total === 'number') {
          layers.set(msg.digest, { total: msg.total, completed: msg.completed ?? 0 });
        }
        let total = 0; let done2 = 0;
        for (const l of layers.values()) { total += l.total; done2 += l.completed; }
        if (done2 !== lastBytes) { lastBytes = done2; lastMoved = Date.now(); }

        if (total > 0) {
          const pctNum = Math.min(100, Math.round((done2 / total) * 100));
          fill.style.width = `${pctNum}%`;
          text.textContent = `${pctNum}% · ${(done2 / 1e9).toFixed(2)} of `
            + `${(total / 1e9).toFixed(2)} GB`;
        } else {
          text.textContent = msg.status ?? 'starting…';
        }
      }
    }

    fill.style.width = '100%';
    text.innerHTML = '<span class="allow">Download finished.</span> Verifying…';
    btn.textContent = 'Installed';

    /**
     * VERIFY, THEN DECIDE. Do not just re-render.
     *
     * The first version called checkServer() here, which rebuilt this whole box. If the
     * server still could not see the model the user got a fresh "Install" button with no
     * explanation — the screen simply reset, which reads as the click having done
     * nothing. That is a real state: a pull can report success while the server is
     * configured for a different model name.
     */
    const after = await probe(serverUrl, 8000);
    if (after.ok) {
      setLamp('ok', 'ready');
      $('serveradvice').hidden = true;
      $('serverstatus').innerHTML =
        `<span class="allow">ready</span> · ${esc(after.model ?? '')}`;
      $('run').classList.remove('demoted');
      $('scan').classList.remove('promoted');
    } else {
      text.innerHTML = '<span class="deny">The download finished, but the server still '
        + 'does not see the model.</span> That usually means it is looking for a '
        + 'different name — check <b>Settings</b>, or restart the server.';
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  } catch (e) {
    text.innerHTML = `<span class="deny">Download failed.</span> ${esc(String(e))}`;
    btn.disabled = false;
    btn.textContent = 'Try again';
  } finally {
    clearInterval(stallCheck);
  }
}

/**
 * Say how to start the server — correctly, for THIS build, and copyably.
 *
 * The old message was a single relative command printed inline: `cd server && ...`. It
 * was wrong for the zip (no server/ exists there) and wrong for the repo unless the
 * reader's shell already sat in the repository root. It also had to be retyped by hand
 * from a panel, which is its own small cruelty.
 */
function showStartAdvice(): void {
  const box = $('serveradvice');
  if (build.variant === 'scan-only') { applyBuildVariant(); return; }

  const raw = build.startCommands ?? [];
  // Each of these holds a terminal open, which is the bit people get wrong: they run
  // the first, see it stop printing, and assume it failed.
  const notes = ['Terminal 1 — leave it running', 'Terminal 2 — leave it running'];
  const steps = raw.length
    ? raw.map((cmd, i) => ({ cmd, note: notes[i] }))
    : [{ cmd: 'See the repository README', note: 'This build carries no start command' }];

  const setup = build.setupNeeded && build.setupCommand
    // A fresh clone has no venv, so the uvicorn line cannot work yet. Telling someone
    // who has not run setup to "start the server" sends them to a file that is absent.
    ? '<div class="advice-note">This clone has no Python environment yet — run setup '
      + 'once first.</div>'
      + cmdBlock([{ cmd: build.setupCommand, note: 'Once, then the two below' }])
    : '';

  box.innerHTML = '<b>The reasoning server is not running.</b> It is a local process on '
    + 'your machine, so an extension cannot start it — Chrome does not let any extension '
    + 'launch a program. Paste these into a terminal:'
    + setup + cmdBlock(steps)
    + '<div class="advice-note"><b>Scan this page</b> needs none of this.</div>';
  box.hidden = false;
}

/**
 * A copyable command, one per block.
 *
 * Not one block for both: `ollama serve` and uvicorn each OCCUPY a terminal, and
 * stacking them in a single pre read as one long command with a wrapped path. Each
 * gets its own Copy button and its own caption saying where it runs.
 */
function cmdBlock(cmds: Array<{ cmd: string; note?: string }>): string {
  return cmds.map(({ cmd, note }) =>
    `<div class="cmd">${note ? `<div class="cmd-note">${note}</div>` : ''}`
    + `<pre>${esc(cmd)}</pre>`
    + `<button type="button" class="copy" data-cmd="${esc(cmd)}">Copy</button></div>`).join('');
}

// Delegated, because these blocks are rendered after load.
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement)?.closest?.('.copy') as HTMLButtonElement | null;
  if (!btn) return;
  void navigator.clipboard.writeText(btn.dataset.cmd ?? '').then(() => {
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
  });
});

/**
 * Try the ports the server is realistically on.
 *
 * Teammates start it on whatever is free, and at a hackathon someone will have 8975
 * already taken. Asking a user to guess a port is a worse experience than trying six.
 */
/**
 * ⛔ 11434 was removed. That is ollama's own port, and ollama serves no `/health`, so
 * probing it was guaranteed to fail — a candidate that could never succeed, padding the
 * "no server found" path with an extra timeout and implying we support something we do
 * not. The reasoning server is the only thing this URL can point at.
 */
const CANDIDATE_PORTS = [8975, 8000, 8080, 8976, 5000];
async function autodetect(): Promise<void> {
  const el = $('serverstatus');
  for (const port of CANDIDATE_PORTS) {
    const url = `http://127.0.0.1:${port}`;
    el.innerHTML = `trying ${esc(url)}…`;
    const r = await probe(url);
    if (r.ok) {
      ($('server') as HTMLInputElement).value = url;
      await chrome.storage.local.set({ serverUrl: url });
      await checkServer(url);
      return;
    }
  }
  el.innerHTML = '<span class="deny">no server found</span> on ports '
    + CANDIDATE_PORTS.join(', ');
  setLamp('bad', 'offline');
  showStartAdvice();
}

$('testsrv').addEventListener('click', () => {
  void checkServer(($('server') as HTMLInputElement).value.trim() || DEFAULT_SERVER);
});
$('autodetect').addEventListener('click', () => { void autodetect(); });
$('resetsrv').addEventListener('click', async () => {
  ($('server') as HTMLInputElement).value = DEFAULT_SERVER;
  await chrome.storage.local.set({ serverUrl: DEFAULT_SERVER });
  void checkServer(DEFAULT_SERVER);
});

void (async () => {
  // Build info FIRST. Probing before we know whether a server can exist at all is how
  // a scan-only package ends up being told to start one.
  await loadBuildInfo();
  applyBuildVariant();
  const url = await loadServer();
  ($('server') as HTMLInputElement).value = url;
  if (build.variant === 'scan-only') { setLamp('unknown', 'scan only'); return; }
  void checkServer(url);
})();

$('server').addEventListener('change', async (e) => {
  const url = (e.target as HTMLInputElement).value.trim().replace(/\/$/, '') || DEFAULT_SERVER;
  await chrome.storage.local.set({ serverUrl: url });
  void checkServer(url);
});

/**
 * Say which page will be acted on.
 *
 * The agent acts on the ACTIVE TAB, not on whatever the user was last looking at. With
 * several tabs open there is nothing on screen telling them which one — and this is an
 * agent that clicks buttons.
 */
async function showTarget(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const el = $('target');
    // ONE flex child, always. The row is a flex container (dot + message), so
    // loose text beside a <span> became a second column and the refusal wrapped
    // into two narrow stacks instead of a sentence.
    const say = (html: string) => { el.innerHTML = `<span class="tmsg">${html}</span>`; };
    if (!tab?.url) { say('no page selected'); return; }
    if (/^(chrome|about|edge|moz-extension|chrome-extension):/.test(tab.url)) {
      say('<span class="deny">this page cannot be read</span> '
        + '— browser-internal pages are off-limits to extensions');
      return;
    }
    say(`will act on <b>${esc(new URL(tab.url).host)}</b>`);
  } catch {
    $('target').textContent = '';
  }
}
void showTarget();
chrome.tabs?.onActivated.addListener(() => void showTarget());
chrome.tabs?.onUpdated.addListener(() => void showTarget());

/**
 * A named stepper, not a status string.
 *
 * "reasoning…" tells a user nothing about how far along the work is or how much is
 * left. Showing the five stages with the current one lit makes a 3-second wait legible,
 * and the elapsed counter makes it obvious that something is still happening.
 */
const STAGES = ['observing', 'redacting', 'reasoning', 'validating', 'acting'] as const;
let runStart = 0;
let elapsedTimer: ReturnType<typeof setInterval> | undefined;

function renderProgress(turn: number, phase: string): void {
  const idx = STAGES.indexOf(phase as typeof STAGES[number]);
  const dots = STAGES.map((s, i) => {
    const cls = i < idx ? 'done' : i === idx ? 'now' : 'todo';
    return `<span class="step ${cls}" title="${s}">${s}</span>`;
  }).join('<span class="sep">›</span>');
  const secs = ((Date.now() - runStart) / 1000).toFixed(1);
  $('phase').hidden = false;
  $('phase').className = 'phase working';
  $('phase').innerHTML =
    `<div class="steps">${dots}</div><div class="t">turn ${turn} · ${secs}s elapsed</div>`;
}

$('stop').addEventListener('click', () => {
  void chrome.runtime.sendMessage({ target: 'background', type: 'stop-agent' });
  $('phase').innerHTML = '<span class="deny">stopping after this turn…</span>';
  ($('stop') as HTMLButtonElement).disabled = true;
});

// One click to try it. A blank box with no examples is the commonest reason a new user
// closes a tool without ever running it.
for (const b of Array.from(document.querySelectorAll('.ex'))) {
  b.addEventListener('click', () => {
    ($('goal') as HTMLInputElement).value = (b as HTMLElement).textContent!.trim();
    ($('run') as HTMLButtonElement).click();
  });
}

$('run').addEventListener('click', async () => {
  const btn = $('run') as HTMLButtonElement;
  const stopBtn = $('stop') as HTMLButtonElement;
  const goal = ($('goal') as HTMLInputElement).value.trim();
  if (!goal) return;

  btn.disabled = true;
  stopBtn.hidden = false;
  stopBtn.disabled = false;
  $('ledger').innerHTML = SKELETON;
  $('empty').hidden = true;
  showPhase();
  runStart = Date.now();
  renderProgress(1, 'observing');
  clearInterval(elapsedTimer);
  // Tick the counter even while a single stage is running, so the panel never looks
  // frozen during the model call.
  elapsedTimer = setInterval(() => {
    const el = $('phase').querySelector('.t');
    if (el) el.textContent = el.textContent!.replace(/[\d.]+s elapsed/,
      `${((Date.now() - runStart) / 1000).toFixed(1)}s elapsed`);
  }, 100);

  try {
    const res = await chrome.runtime.sendMessage({ target: 'background', type: 'run-agent', goal });
    if (res?.error) {
      $('phase').innerHTML = `<span class="deny">error:</span> ${esc(res.error)}`;
    } else {
      const previews = new Map<string, Preview>(
        (res.previews ?? []).map((p: Preview) => [p.token, p]));

      // Always say why the run ended. A run that stops with no explanation is
      // indistinguishable from a crash, and that is exactly the wrong impression to
      // give while someone is watching.
      const GOOD = new Set(['goal-complete']);
      const label: Record<string, string> = {
        'goal-complete': 'goal complete',
        'max-turns': 'stopped at the turn limit',
        'nothing-executable': 'stopped — every proposed action was refused',
        'server-unreachable': 'the reasoning server is not running',
        'server-error': 'the reasoning server returned an error',
        'server-timeout': 'the model did not respond in time',
        'page-unavailable': 'this page cannot be read',
        'unstable-viewport': 'the page kept moving while being read',
        'stopped-by-user': 'stopped',
      };
      const reason = res.stopReason as string;
      const cls = GOOD.has(reason) ? 'allow' : 'deny';
      $('phase').innerHTML =
        `<span class="${cls}">${esc(label[reason] ?? reason)}</span>`
        + ` &middot; ${plural(res.records.length, 'turn')}`
        + (res.detail ? `<div class="t">${esc(res.detail)}</div>` : '');
      // Session totals up front. A judge should see the headline number without
      // adding up chips across turns.
      const totalWithheld = res.records.reduce(
        (a: number, r: any) => a + (r.withheld ?? []).reduce((x: number, w: any) => x + w.count, 0), 0);
      const totalFaces = res.records.reduce((a: number, r: any) => a + (r.facesBlurred ?? 0), 0);
      const totalMasked = res.records.reduce((a: number, r: any) => a + (r.piiMasked ?? 0), 0);
      const totalMs = res.records.reduce((a: number, r: any) => a + r.timings.totalMs, 0);
      // "values leaked" is marked hero: it is the one figure the product exists
      // to be able to show, and it was previously the same weight as "total time".
      const cells: Array<[number, string, string, boolean]> = [
        [0, '', 'values leaked', true],
        [totalWithheld, '', 'values withheld', false],
        [totalFaces, '', 'faces blurred', false],
        [totalMasked, '', 'struck out of image', false],
        [totalMs / 1000, 's', 'total time', false],
      ];
      const totals = `<div class="totals">${cells.map(([, sfx, lbl, hero]) =>
        `<div${hero ? ' class="hero"' : ''}><div class="n" data-sfx="${sfx}">0${sfx}</div>`
        + `<div class="lbl">${lbl}</div></div>`).join('')}</div>`;

      $('ledger').innerHTML = totals
        + res.records.map((r: any) => renderTurn(r, previews)).join('');

      const nums = Array.from($('ledger').querySelectorAll('.totals .n'));
      nums.forEach((el, i) => countUp(el, cells[i][0], cells[i][1]));
      enter(Array.from($('ledger').querySelectorAll('.totals > div')), { delay: stagger(0.035) });
      enter(Array.from($('ledger').querySelectorAll('.turn')), { delay: stagger(0.06, { startDelay: 0.1 }) });
    }
  } catch (e) {
    $('phase').innerHTML = `<span class="deny">error:</span> ${esc(String(e))}`;
  } finally {
    clearInterval(elapsedTimer);
    btn.disabled = false;
    stopBtn.hidden = true;
    $('phase').className = 'phase';
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target === 'panel' && msg.type === 'progress') {
    renderProgress(msg.event.turn, msg.event.phase);
  }
});


/**
 * SCAN THIS PAGE: the demonstration that works on a site nobody chose in advance.
 *
 * No model, no server, no download. It observes whatever page is open, redacts it, and
 * shows exactly what WOULD have been transmitted, without transmitting it. The point is
 * that a sceptic can navigate to their own bank, their own government portal, anything
 * at all, press this, and read the answer for that page.
 *
 * It also surfaces the refusals. A page we could not fully read, or one whose PII sits
 * beyond a cap, is a page whose screenshot the agent would decline to send, and saying
 * so is more convincing than a clean result would be.
 */
$('scan').addEventListener('click', async () => {
  const btn = $('scan') as HTMLButtonElement;
  // Write to the LABEL, not the button. Setting textContent on the button erased
  // its icon and its sub-label permanently — the button came back from the first
  // scan as a single run-on line of text and never recovered.
  const label = $('scanlabel');
  btn.disabled = true;
  const prev = label.textContent;
  label.textContent = 'Reading this page…';
  $('ledger').innerHTML = SKELETON;
  $('empty').hidden = true;
  showPhase();

  try {
    const r = await chrome.runtime.sendMessage({ target: 'background', type: 'scan-page' });
    if (r?.error) {
      $('phase').innerHTML = `<span class="deny">cannot scan:</span> ${esc(r.error)}`;
      return;
    }

    const total = (r.withheld ?? []).reduce((n: number, w: { count: number }) => n + w.count, 0);
    const kinds = (r.withheld ?? []).map((w: { kind: string; count: number }) =>
      `${w.count} ${w.kind}`).join(', ') || 'nothing personal found';

    /**
     * A SCAN THAT COULD NOT READ THE PAGE MUST NOT REPORT IT CLEAN.
     *
     * On a GoDaddy parked domain the whole body is inside a frame. The content script
     * runs in the top frame only, so it read ONE element, found nothing, and said
     * "nothing personal found" — a clean bill of health issued while blind. For a
     * privacy tool that is the most dangerous output there is: the user reasonably
     * concludes the page holds nothing sensitive.
     */
    const blind = (r.blindRatio ?? 0) > 0.4 || (r.nodeCount ?? 0) <= 2;

    const warn = [
      r.unreadable?.length
        ? `${plural(r.unreadable.length, 'region')} unreadable, screenshot would be withheld` : '',
      r.piiBeyondTextCap ? 'PII-shaped text beyond the length cap, screenshot would be withheld' : '',
      r.piiBeyondNodeCap ? 'PII-shaped content below the node budget, screenshot would be withheld' : '',
      r.truncated ? `page exceeded the node budget; form controls were rescued` : '',
    ].filter(Boolean);

    $('phase').innerHTML = blind
      ? `<b class="fig">—</b> this page could not be read`
      : `<b class="fig">${num(total)}</b> ${total === 1 ? 'value' : 'values'} would be withheld`
      + ` from <span class="src">${esc(r.title ?? r.url ?? 'this page')}</span>`
      + `<span class="t nums">${num(r.nodeCount)} elements read, `
      + `${num(r.bytes)} bytes would be sent</span>`;

    // These classes had NO rules in the stylesheet at all, so the scan result —
    // the path a sceptic actually presses, on their own bank — rendered as an
    // unstyled browser-default table. Styled now, and the inline style="" strings
    // that were standing in for a stylesheet are gone.
    $('ledger').innerHTML =
      `<div class="entry"><header><b>Scan only</b>`
      + `<span class="t">nothing was transmitted</span></header>`
      // Chips, not "Withheld: 1 PAN, 2 NAME". A colon-separated sentence of counts is
      // a log line; the chips are already the panel's vocabulary for this.
      + `<div class="body">${(r.withheld ?? []).length
          ? (r.withheld as Array<{ kind: string; count: number }>)
              .map((w) => `<span class="chip"><b>${w.count}</b> ${esc(w.kind)}</span>`).join('')
          : blind
            ? '<span class="chip">page unreadable</span>'
            : '<span class="chip">nothing personal found</span>'}`
      + (r.previews?.length
          ? `<table class="fields"><thead><tr><th scope="col">On screen</th><th scope="col">Sent instead</th></tr></thead><tbody>`
            + r.previews.map((p: Preview) =>
                `<tr><td class="mask" translate="no">${maskHtml(p.masked)}</td><td class="tok" translate="no">${esc(p.token)}</td></tr>`).join('')
            + `</tbody></table>`
          // The likeliest first experience is an empty result, because a page holds no
          // personal data until somebody types some. "None found" reads as "broken", so
          // say what to do next — but in two lines, not a paragraph.
          : blind
            ? `<div class="warnbox"><b>This page could not be read, so this is not a `
              + `clean result.</b><br>Its content sits inside a frame or a closed shadow `
              + `root, which an extension cannot see into from the top of the page. `
              + `${num(r.nodeCount ?? 0)} element${(r.nodeCount ?? 0) === 1 ? '' : 's'} `
              + `were readable. Nothing was transmitted, and nothing was judged.</div>`
            : `<div class="hint"><b>Nothing personal on this page yet.</b> Most pages hold `
              + `none until you type something.<br>Put a made-up PAN such as `
              + `<span class="tok" translate="no">ABCPE1234F</span> into a field you can `
              + `see, then scan again.</div>`)
      // A successful scan ends with a table and no idea what it proved. The claim worth
      // making here is the one the reader can check for herself in ten seconds, so make
      // it, and say where to go next rather than leaving the panel a dead end.
      + (r.previews?.length
          // THREE SCANNABLE LINES, not two paragraphs.
          //
          // This was ~7 lines of grey prose, and in a 400px panel a wall of low-contrast
          // body copy is what makes a tool read as documentation. The reader needs three
          // facts, each checkable in seconds, so each gets one line and no more.
          ? `<ul class="verify">`
            + `<li><b>Nothing left this machine.</b> DevTools → Network, press Scan `
            + `again: no request appears.</li>`
            + `<li>Only the tags on the right would be sent.</li>`
            + `<li>Open <span class="tok" translate="no">why.html</span> beside this `
            + `extension for the same page, sent both ways.</li>`
            + `</ul>`
          : '')
      + (warn.length
          ? `<div class="warnbox">${warn.map(esc).join('<br>')}</div>`
          : '')
      + `</div></div>`;

    enter($('ledger').querySelectorAll('.entry')[0]!);
    enter(Array.from($('ledger').querySelectorAll('.fields tbody tr')),
      { delay: stagger(0.04, { startDelay: 0.12 }), ...SPRING_SOFT });
  } catch (e) {
    $('phase').innerHTML = `<span class="deny">cannot scan:</span> ${esc(String(e))}`;
  } finally {
    btn.disabled = false;
    label.textContent = prev;
  }
});

/* ──────────────────────────────────────────────────────────────────────────
   Interaction and mount.

   Kept at the bottom, and entirely additive: every handler above works whether
   or not any of this runs. If Motion were removed tomorrow the panel would lose
   its polish and none of its function.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Press physics on the things you press.
 *
 * Motion's press() is used rather than :active because :active cannot spring
 * back — it snaps, and a snap on a 12px-travel button is what makes a UI feel
 * like a web page instead of an instrument. It also handles pointer, touch and
 * keyboard activation as one gesture.
 */
if (!STILL) {
  for (const sel of ['#run', '#scan', '#stop', '.ex', '#settings button']) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      press(el as HTMLElement, (target) => {
        void animate(target, { scale: 0.972 }, { type: 'spring', stiffness: 900, damping: 42 });
        return () => void animate(target, { scale: 1 }, SPRING);
      });
    }
  }
  // A 1px lift is enough to say "this is liftable". More reads as a toy.
  for (const el of Array.from(document.querySelectorAll('#run'))) {
    hover(el as HTMLElement, (target) => {
      void animate(target, { y: -1 }, SPRING_SOFT);
      return () => void animate(target, { y: 0 }, SPRING_SOFT);
    });
  }
}

/**
 * THE ONE ORCHESTRATED MOMENT: on the launch screen, the wordmark redacts itself.
 *
 * The bar wipes left-to-right across AAVARAN — the product performing its own
 * mechanism on its own name. Aavaran means "veil", and it is literally the
 * operation the redactor runs on a screenshot: a solid fill, swept over a
 * region, before anything is sent.
 *
 * The SPLASH ITSELF is dismissed by CSS (see #splash's animation). This only
 * adds the sweep, so if Motion never loads the launch screen still hands over.
 *
 * scaleX from a left origin, so it composites and never triggers layout.
 *
 * There is deliberately no second mount animation. The whole panel is rendered
 * behind the splash from the first frame, so the fade is the reveal — staggering
 * the sections in on top of that was two effects doing one job, which is how an
 * interface starts to look busy for its own sake.
 */
function sweepRedaction(): void {
  const bar = document.getElementById('markbar');
  if (!bar || STILL) return;   // CSS holds it at scaleX(1) under reduced motion
  bar.style.transformOrigin = 'left center';
  void animate(bar,
    { transform: ['scaleX(0)', 'scaleX(1)'] },
    { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.18 });
}
sweepRedaction();
