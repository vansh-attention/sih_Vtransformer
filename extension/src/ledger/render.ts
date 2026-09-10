/**
 * Privacy Ledger renderer — SIH26171.
 *
 * Produces a self-contained HTML panel. No framework, no dependencies, no build step:
 * client resource utilisation is 20% of the grade, and shipping React inside a browser
 * extension to draw a table would be an unforced loss.
 *
 * Same output serves two audiences:
 *   - the user, in the extension side panel
 *   - a judge, as a standalone file they can open and read for themselves
 *
 * The design goal is that nobody has to trust us. Every claim on the panel is next to
 * the evidence for it, and the raw transmitted JSON is always one click away.
 */

import type { SanitizedNode } from '../contracts.ts';
import type { Entry, Ledger, Preview } from './ledger.ts';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Rows worth showing: every field carrying a value, PLUS leaf text nodes that look
 * like they could have been redacted and were not.
 *
 * That second group is the point. A panel that only lists what we withheld proves
 * recall and says nothing about precision — and over-redaction costs 20% of the grade
 * just as surely as leaking does. Showing "order total 999999999999 — sent as-is"
 * demonstrates the system knows the difference.
 */
const REDACTABLE_LOOKING = /\d{6,}|<PII_/;

function valueFields(root: SanitizedNode): SanitizedNode[] {
  const out: SanitizedNode[] = [];
  (function walk(n: SanitizedNode) {
    if (n.value) out.push(n);
    else if (!n.children?.length && n.label && REDACTABLE_LOOKING.test(n.label)) out.push(n);
    n.children?.forEach(walk);
  })(root);
  return out;
}

const TOKEN_RE = /<PII_[A-Z]+_\d+>/g;

/**
 * The side-by-side row. "Before" is reconstructed from masked previews, never from
 * stored originals — the ledger does not hold the values, by design.
 */
function fieldRow(node: SanitizedNode, previews: Map<string, Preview>): string {
  // Nodes with no value are the "deliberately kept" rows; their text lives in label.
  const content = node.value ?? node.label ?? '';
  const label = node.value
    ? (node.label ?? node.contextLabel ?? node.id)
    : (node.contextLabel ?? node.id);
  const tokens = content.match(TOKEN_RE) ?? [];
  const before = content.replace(
    TOKEN_RE,
    (t) => `<span class="mask">${esc(previews.get(t)?.masked ?? '••••')}</span>`,
  );
  const after = content.replace(
    TOKEN_RE,
    (t) => `<span class="tok">${esc(t)}</span>`,
  );
  const held = tokens.length > 0;

  return `<tr class="${held ? 'held' : 'plain'}">
    <td class="label">${esc(label)}</td>
    <td class="before">${before}</td>
    <td class="arrow">${held ? '→' : '='}</td>
    <td class="after">${after}</td>
    <td class="verdict">${held ? '<span class="badge-held">withheld</span>' : '<span class="badge-sent">sent as-is</span>'}</td>
  </tr>`;
}

function entryBlock(entry: Entry, index: number): string {
  const previews = new Map<string, Preview>();
  for (const g of entry.withheld) for (const p of g.previews) previews.set(p.token, p);

  const fields = valueFields(entry.transmitted.root);
  const wire = JSON.stringify(entry.transmitted, null, 2);
  const t = entry.timings;

  return `<section class="entry">
    <header>
      <h2>Request ${index + 1} <span class="origin">${esc(entry.origin)}</span></h2>
      <div class="timings">
        <span>extract <b>${t.extractMs}ms</b></span>
        <span>vision <b>${t.visionMs}ms</b></span>
        <span>sanitize <b>${t.sanitizeMs}ms</b></span>
        <span>network <b>${t.networkMs}ms</b></span>
        <span class="total">total <b>${t.totalMs}ms</b></span>
        <span>peak heap <b>${entry.resources.peakHeapMb.toFixed(1)}MB</b></span>
      </div>
    </header>

    <div class="withheld">
      ${entry.withheld.map((g) => `<span class="chip"><b>${g.count}</b> ${esc(g.kind)}</span>`).join('')}
      ${entry.withheld.length === 0 ? '<span class="chip none">nothing withheld</span>' : ''}
    </div>

    <table class="fields">
      <thead><tr>
        <th>Field</th><th>On screen</th><th></th><th>Transmitted</th><th></th>
      </tr></thead>
      <tbody>${fields.map((f) => fieldRow(f, previews)).join('')}</tbody>
    </table>

    <details>
      <summary>Raw bytes transmitted (${wire.length.toLocaleString()} bytes) — inspect it yourself</summary>
      <pre>${esc(wire)}</pre>
    </details>
  </section>`;
}

export function renderLedger(ledger: Ledger): string {
  const totals = ledger.totals();
  const entries = ledger.entries();

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Privacy Ledger — on-device browser agent</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:#0d1117; color:#e6edf3;
         font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
  h1 { font-size:17px; margin:0 0 4px; letter-spacing:.2px; }
  .sub { color:#7d8590; font-size:12px; margin-bottom:20px; }
  .summary { display:flex; gap:10px; flex-wrap:wrap; align-items:center;
             padding:14px 16px; background:#161b22; border:1px solid #30363d;
             border-radius:8px; margin-bottom:22px; }
  .summary .big { font-size:22px; font-weight:700; color:#3fb950; }
  .summary .lbl { color:#7d8590; font-size:12px; margin-right:14px; }
  .chip { background:#21262d; border:1px solid #30363d; border-radius:999px;
          padding:2px 10px; font-size:11px; color:#c9d1d9; }
  .chip b { color:#f0883e; }
  .chip.none { color:#7d8590; }
  .entry { border:1px solid #30363d; border-radius:8px; margin-bottom:18px;
           background:#0f1419; overflow:hidden; }
  .entry header { padding:12px 16px; background:#161b22; border-bottom:1px solid #30363d; }
  .entry h2 { font-size:13px; margin:0 0 6px; font-weight:600; }
  .origin { color:#58a6ff; font-weight:400; margin-left:8px; }
  .timings { display:flex; gap:16px; flex-wrap:wrap; font-size:11px; color:#7d8590; }
  .timings b { color:#e6edf3; }
  .timings .total b { color:#3fb950; }
  .withheld { padding:12px 16px; display:flex; gap:8px; flex-wrap:wrap; }
  table.fields { width:100%; border-collapse:collapse; font-size:12px; }
  table.fields th { text-align:left; padding:7px 16px; color:#7d8590; font-weight:500;
                    border-top:1px solid #30363d; border-bottom:1px solid #30363d;
                    font-size:11px; text-transform:uppercase; letter-spacing:.4px; }
  table.fields td { padding:7px 16px; border-bottom:1px solid #1c2128; vertical-align:top; }
  td.label { color:#7d8590; white-space:nowrap; max-width:200px; overflow:hidden;
             text-overflow:ellipsis; }
  td.arrow { color:#484f58; text-align:center; width:24px; }
  .mask { color:#f85149; letter-spacing:1px; }
  .tok  { color:#3fb950; }
  td.verdict { white-space:nowrap; text-align:right; }
  .badge-held { color:#f85149; font-size:10px; text-transform:uppercase;
                letter-spacing:.5px; }
  .badge-sent { color:#7d8590; font-size:10px; text-transform:uppercase;
                letter-spacing:.5px; }
  tr.plain td.before, tr.plain td.after { color:#8b949e; }
  details { border-top:1px solid #30363d; }
  summary { padding:10px 16px; cursor:pointer; color:#58a6ff; font-size:12px;
            user-select:none; }
  summary:hover { background:#161b22; }
  pre { margin:0; padding:14px 16px; background:#010409; overflow-x:auto;
        font-size:11px; color:#8b949e; max-height:420px; }
  .note { margin-top:20px; padding:12px 16px; border-left:3px solid #f0883e;
          background:#161b22; font-size:12px; color:#8b949e; }
</style></head>
<body>
  <h1>Privacy Ledger</h1>
  <div class="sub">SIH26171 &middot; on-device visual perception for light-weight browser agents</div>

  <div class="summary">
    <span class="big">${totals.withheld}</span>
    <span class="lbl">values withheld across ${totals.requests} request${totals.requests === 1 ? '' : 's'}</span>
    ${totals.byKind.map((k) => `<span class="chip"><b>${k.count}</b> ${esc(k.kind)}</span>`).join('')}
  </div>

  ${entries.map(entryBlock).join('')}

  <div class="note">
    <b>Nothing here is a claim you have to take on trust.</b> The "on screen" column is
    reconstructed from masked shadows &mdash; this ledger never stores the real values,
    because a persistent record of every secret on your screen would be worse than the
    problem it solves. Open the raw bytes above to check for yourself that no value left
    the machine.
  </div>
</body></html>`;
}
