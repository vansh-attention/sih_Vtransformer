/**
 * Build a single-file replay of a real run, for someone who will never install anything.
 *
 * WHY THIS EXISTS
 * Running the system needs Node, Python, Chrome, Ollama and a 6 GB model. That is a
 * reasonable ask of a teammate and an unreasonable one of a professor deciding whether
 * to nominate us. So this produces one HTML file she can double-click.
 *
 * WHY IT IS A REPLAY AND NOT A SIMULATION
 * A simulator would be a program we wrote that produces whatever output we chose, in a
 * project whose entire argument is that nothing here is staged. So this file contains no
 * simulation at all. Every byte in it was recorded by `spikes/e-e2e/run.sh` driving the
 * real extension against a real page with the real model, and it is labelled as a
 * recording on the first screen. The payloads are the actual payloads. The timings are
 * the actual timings, including the slow turn.
 *
 * The one thing a reader cannot do here is change the page and watch it re-derive, which
 * is exactly what the one-command live run is for. The file says so.
 *
 *   node demo/build-demo.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SRC = new URL('../spikes/e-e2e/result.json', import.meta.url);
const OUT = new URL('./replay.html', import.meta.url);

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const run = raw.spikeE ?? raw;
const records = run.records ?? [];
if (!records.length) {
  console.error('no recorded turns in spikes/e-e2e/result.json — run ./spikes/e-e2e/run.sh first');
  process.exit(1);
}

const capturedAt = raw.at ?? new Date().toISOString();
const resources = run.resources ?? {};
const outcome = run.outcome ?? {};

/** Flatten a sanitized tree into the rows a reader can actually scan. */
function rows(node, out = []) {
  if (!node) return out;
  const hasValue = node.value !== undefined;
  const hasLabel = node.label !== undefined;
  if (hasValue || hasLabel) {
    out.push({
      id: node.id,
      role: node.role,
      label: node.label ?? node.contextLabel ?? '',
      value: node.value ?? '',
      redacted: typeof node.value === 'string' && /<PII_[A-Z]+_\d+>/.test(node.value),
    });
  }
  (node.children ?? []).forEach((c) => rows(c, out));
  return out;
}

const turns = records.map((r) => ({
  turn: r.turn,
  origin: r.origin,
  nodeCount: r.nodeCount,
  bytes: r.transmittedBytes,
  timings: r.timings ?? {},
  withheld: r.withheld ?? [],
  previews: r.previews ?? [],
  rows: rows(r.transmitted?.root).slice(0, 40),
  actions: (r.actions ?? []).map((a) => ({
    kind: a.action?.kind, target: a.action?.target,
    value: a.action?.value ?? null,
    reasoning: a.action?.reasoning ?? '',
    allowed: a.allowed === true, reason: a.reason ?? null,
  })),
  raw: JSON.stringify(r.transmitted ?? {}, null, 2),
}));

const totalWithheld = turns.reduce(
  (n, t) => n + t.withheld.reduce((m, w) => m + (w.count ?? 0), 0), 0);

const html = `<!doctype html>
<meta charset="utf-8">
<title>SIH26171 — recorded run</title>
<style>
  :root{--ink:#15181f;--navy:#1b3357;--grey:#5a6270;--rule:#c6ccd6;--soft:#eef2f9;
        --red:#a4341f;--green:#1b5e3a}
  *{box-sizing:border-box}
  body{margin:0;font:16px/1.55 Cambria,Georgia,serif;color:var(--ink);background:#fff}
  .wrap{max-width:1020px;margin:0 auto;padding:34px 26px 80px}
  h1{font-size:27px;margin:0 0 4px}
  .sub{color:var(--navy);font-style:italic;margin:0 0 20px}
  .note{background:var(--soft);border:1px solid var(--rule);border-left:4px solid var(--navy);
        padding:13px 16px;margin:0 0 24px;font-size:14.5px}
  .note b{color:var(--navy)}
  .bar{display:flex;gap:9px;flex-wrap:wrap;margin:22px 0 16px}
  button{font:600 14px/1 Calibri,system-ui,sans-serif;padding:9px 15px;border:1px solid var(--rule);
         background:#fff;border-radius:5px;cursor:pointer;color:var(--ink)}
  button:hover{background:var(--soft)}
  button.on{background:var(--navy);color:#fff;border-color:var(--navy)}
  .stats{display:flex;gap:26px;flex-wrap:wrap;font:14px Calibri,system-ui,sans-serif;
         color:var(--grey);border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);
         padding:11px 0;margin-bottom:20px}
  .stats b{color:var(--ink);font-size:16px}
  h2{font-size:17px;color:var(--navy);margin:26px 0 9px}
  table{width:100%;border-collapse:collapse;font:13.5px Calibri,system-ui,sans-serif}
  th{text-align:left;background:var(--navy);color:#fff;padding:7px 10px;font-weight:600}
  td{padding:6px 10px;border-bottom:1px solid #e6e9ef;vertical-align:top}
  .tok{color:var(--green);font-family:ui-monospace,Menlo,monospace}
  .mask{color:var(--red);font-family:ui-monospace,Menlo,monospace}
  .held{color:var(--red);font:600 11px Calibri,sans-serif;text-transform:uppercase}
  .sent{color:var(--grey);font:600 11px Calibri,sans-serif;text-transform:uppercase}
  pre{background:#0d1117;color:#e6edf3;padding:15px;border-radius:6px;overflow:auto;
      font:12px ui-monospace,Menlo,monospace;max-height:340px}
  .act{border:1px solid var(--rule);border-radius:6px;padding:11px 14px;margin:8px 0;
       font:14px Calibri,system-ui,sans-serif}
  .act.no{border-color:var(--red);background:#fdf3f1}
  .act code{font-family:ui-monospace,Menlo,monospace;background:var(--soft);padding:1px 5px;border-radius:3px}
  details{margin-top:12px}
  summary{cursor:pointer;color:var(--navy);font:14px Calibri,system-ui,sans-serif}
  footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--rule);
         color:var(--grey);font:13.5px Calibri,system-ui,sans-serif}
</style>
<div class="wrap">
  <h1>On-Device Visual Perception for Light-Weight Browser Agents</h1>
  <p class="sub">Problem statement SIH26171 &middot; a recorded run you can step through</p>

  <div class="note">
    <b>This is a recording, not a simulation.</b> Every payload, timing and action below was
    captured by the real extension driving a real page against the real model on
    ${capturedAt.slice(0, 10)}. Nothing here is generated for display, including the slow turn.
    What you cannot do in this file is change the page and watch it re-derive, which is what
    the live run is for: <code>./setup.sh &amp;&amp; ./test-all.sh</code> in the repository.
  </div>

  <div class="stats">
    <div><b>${turns.length}</b> turns</div>
    <div><b>${totalWithheld}</b> values withheld</div>
    <div><b>${resources.taskMs ?? '?'}</b> ms total</div>
    <div><b>${resources.heapDeltaMb ?? '?'}</b> MB browser heap</div>
    <div>task verified on the page: <b>${outcome.verified ? 'yes' : 'no'}</b></div>
  </div>

  <div class="bar" id="bar"></div>
  <div id="panel"></div>

  <footer>
    The left column of any redaction is reconstructed from a masked shadow. This page never
    held the real values, for the same reason the product does not: a permanent record of
    every secret on a screen would be worse than the problem it solves.
  </footer>
</div>
<script>
const TURNS = ${JSON.stringify(turns)};
const bar = document.getElementById('bar');
const panel = document.getElementById('panel');
let cur = 0;

TURNS.forEach((t, i) => {
  const b = document.createElement('button');
  b.textContent = 'Turn ' + t.turn;
  b.onclick = () => { cur = i; render(); };
  bar.appendChild(b);
});

function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

function render() {
  [...bar.children].forEach((b, i) => b.className = i === cur ? 'on' : '');
  const t = TURNS[cur];
  const held = t.withheld.map(w => w.count + ' ' + w.kind).join(', ') || 'nothing';

  panel.innerHTML =
    '<h2>1. What left the machine</h2>' +
    '<p style="font-size:14.5px;color:#5a6270">' + t.nodeCount + ' elements read from ' +
      esc(t.origin) + '. <b>' + t.bytes + ' bytes</b> transmitted. Withheld: <b>' + held + '</b>.</p>' +
    (t.previews.length
      ? '<table><tr><th>On screen</th><th>Kind</th><th>Sent instead</th></tr>' +
        t.previews.map(p => '<tr><td class="mask">' + esc(p.masked) + '</td><td>' +
          esc(p.kind) + '</td><td class="tok">' + esc(p.token) + '</td></tr>').join('') +
        '</table>'
      : '<p style="font-size:14.5px;color:#5a6270">No personal values on this turn.</p>') +

    '<h2>2. What the model was shown</h2>' +
    '<table><tr><th>Element</th><th>Label</th><th>Value as sent</th><th></th></tr>' +
    t.rows.map(r => '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.label) + '</td>' +
      '<td class="' + (r.redacted ? 'tok' : '') + '">' + esc(r.value) + '</td>' +
      '<td class="' + (r.redacted ? 'held' : 'sent') + '">' +
      (r.redacted ? 'withheld' : 'sent as-is') + '</td></tr>').join('') + '</table>' +

    '<h2>3. What it decided</h2>' +
    (t.actions.length
      ? t.actions.map(a => '<div class="act' + (a.allowed ? '' : ' no') + '">' +
          '<code>' + esc(a.kind) + '</code> on <code>' + esc(a.target ?? '-') + '</code>' +
          (a.value ? ' with <code>' + esc(a.value) + '</code>' : '') +
          (a.reasoning ? '<br><span style="color:#5a6270">' + esc(a.reasoning) + '</span>' : '') +
          (a.allowed ? '' : '<br><b style="color:#a4341f">refused: ' + esc(a.reason) + '</b>') +
          '</div>').join('')
      : '<p>No action returned.</p>') +

    '<h2>4. What it cost</h2>' +
    '<p style="font-size:14.5px;color:#5a6270">extract ' + (t.timings.extractMs ?? 0) +
      ' ms &middot; redact ' + (t.timings.sanitizeMs ?? 0) + ' ms &middot; model ' +
      (t.timings.networkMs ?? 0) + ' ms &middot; total <b>' + (t.timings.totalMs ?? 0) + ' ms</b></p>' +

    '<details><summary>Show the exact bytes transmitted on this turn</summary>' +
    '<pre>' + esc(t.raw) + '</pre></details>';
}
render();
</script>
`;

mkdirSync(new URL('./', OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT.pathname}`);
console.log(`  ${turns.length} turns, ${totalWithheld} values withheld, `
          + `${resources.taskMs}ms, verified=${outcome.verified}`);
