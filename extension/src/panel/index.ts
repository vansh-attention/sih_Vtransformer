/**
 * Side panel — SIH26171.
 *
 * Two jobs: take a goal, and make the privacy claim CHECKABLE while the agent runs.
 *
 * The ledger is not a status readout. Every team will say their pipeline is private;
 * this is what lets a judge verify it in the room — withheld counts, masked shadows of
 * what was destroyed, and the exact bytes transmitted, one click away.
 */

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

interface Preview { token: string; kind: string; masked: string }

function renderTurn(rec: any, previews: Map<string, Preview>): string {
  const t = rec.timings;
  const chips = (rec.withheld ?? [])
    .map((w: any) => `<span class="chip"><b>${w.count}</b> ${esc(w.kind)}</span>`).join('')
    || '<span class="chip">nothing withheld</span>';

  const faces = rec.facesBlurred
    ? `<span class="chip"><b>${rec.facesBlurred}</b> FACE blurred</span>` : '';

  const actions = (rec.actions ?? []).map((a: any) => `
    <div class="row">
      <span class="${a.allowed ? 'allow' : 'deny'}">${a.allowed ? 'ALLOW' : 'DENY '}</span>
      <b>${esc(a.action.kind)}</b> ${esc(a.action.target ?? '')}
      ${a.action.value ? `<span class="tok">${esc(a.action.value)}</span>` : ''}
      ${a.allowed && a.executed === false ? '<span class="deny">(not executed)</span>' : ''}
      <div class="t">${esc(a.action.reasoning ?? '')}</div>
      ${a.reason ? `<div class="deny t">refused: ${esc(a.reason)}</div>` : ''}
    </div>`).join('');

  const masked = [...previews.values()].slice(0, 8).map((p) =>
    `<div class="row"><span class="mask">${esc(p.masked)}</span> &rarr; <span class="tok">${esc(p.token)}</span></div>`
  ).join('');

  return `<div class="turn">
    <h2>Turn ${rec.turn} &middot; ${esc(rec.origin)}</h2>
    <div class="row">${chips}${faces}</div>
    ${masked}
    ${actions}
    <div class="row t">
      extract <b>${t.extractMs}ms</b> &middot; sanitize <b>${t.sanitizeMs}ms</b> &middot;
      vision <b>${t.visionMs}ms</b> &middot; model <b>${t.networkMs}ms</b> &middot;
      total <b>${t.totalMs}ms</b> &middot; ${rec.nodeCount} nodes &middot;
      ${(rec.transmittedBytes / 1024).toFixed(1)}KB sent
    </div>
  </div>`;
}

const DEFAULT_SERVER = 'http://127.0.0.1:8975';

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

async function checkServer(url: string): Promise<void> {
  const el = $('serverstatus');
  el.innerHTML = 'checking…';
  try {
    const r = await fetch(`${url}/health`).then((x) => x.json());
    el.innerHTML = r.ok
      ? `<span class="allow">ready</span> · ${esc(r.model)}`
      : `<span class="deny">not ready</span> · ${esc(JSON.stringify(r.available ?? r.error))}`;
  } catch {
    el.innerHTML = '<span class="deny">unreachable</span> · '
      + 'cd server &amp;&amp; .venv/bin/uvicorn main:app --port 8975';
  }
}

void (async () => {
  const url = await loadServer();
  ($('server') as HTMLInputElement).value = url;
  void checkServer(url);
})();

$('server').addEventListener('change', async (e) => {
  const url = (e.target as HTMLInputElement).value.trim().replace(/\/$/, '') || DEFAULT_SERVER;
  await chrome.storage.local.set({ serverUrl: url });
  void checkServer(url);
});

$('run').addEventListener('click', async () => {
  const btn = $('run') as HTMLButtonElement;
  const goal = ($('goal') as HTMLInputElement).value.trim();
  if (!goal) return;

  btn.disabled = true;
  $('ledger').innerHTML = '';
  $('phase').textContent = 'starting…';

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
      };
      const reason = res.stopReason as string;
      const cls = GOOD.has(reason) ? 'allow' : 'deny';
      $('phase').innerHTML =
        `<span class="${cls}">${esc(label[reason] ?? reason)}</span>`
        + ` &middot; ${res.records.length} turn(s)`
        + (res.detail ? `<div class="t">${esc(res.detail)}</div>` : '');
      $('ledger').innerHTML = res.records.map((r: any) => renderTurn(r, previews)).join('')
        + `<details><summary>Raw bytes transmitted — inspect it yourself</summary>
             <pre>${esc(JSON.stringify(res.lastPayload, null, 2))}</pre></details>`;
    }
  } catch (e) {
    $('phase').innerHTML = `<span class="deny">error:</span> ${esc(String(e))}`;
  } finally {
    btn.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target === 'panel' && msg.type === 'progress') {
    $('phase').textContent = `turn ${msg.event.turn}: ${msg.event.phase}…`;
  }
});
