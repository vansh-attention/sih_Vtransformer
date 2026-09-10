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
      $('phase').textContent = `${res.records.length} turn(s) complete`;
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
