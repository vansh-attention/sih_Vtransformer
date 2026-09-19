/**
 * Capture a real page's RENDERED DOM into the corpus.
 *
 * `bench/realpages/` is the only corpus in this project that we did not write, and
 * growing it has found a real bug every single time — three on the first Wikipedia
 * capture alone. It has nonetheless grown to eleven pages in a month, because every
 * page in it was saved by hand.
 *
 * ⛔ `curl` IS NOT A CAPTURE. Every page that matters here is a rendered one: the
 * portals are React and Angular shells whose pre-JavaScript HTML contains no form
 * fields at all. Probed on six real portals, curl returned three redirects, two
 * JavaScript shells with a single input between them, and one 403. The extractor runs
 * against a live DOM, so the corpus has to be live DOM too or it proves nothing.
 *
 * So this drives headed Chrome, waits for the page to settle, and writes
 * `document.documentElement.outerHTML` — what the extractor would actually see.
 *
 *   node scripts/capture-page.mjs <url> <name> [--wait 4000] [--headed]
 *   node scripts/capture-page.mjs --list urls.txt
 *
 * `urls.txt` is one `name<TAB>url` per line, so a teammate can be handed a list and a
 * command rather than a technique. Output lands in `bench/realpages/<name>.html` and is
 * picked up by `bench/realpages-drill.ts` with no further wiring.
 *
 * ⚠ CAPTURE ONLY PAGES YOU MAY CAPTURE, AND NEVER WHILE LOGGED IN. Every file in
 * realpages/ is a public, logged-out page, which is what makes it safe for the drill to
 * print every value it withheld. A capture taken while signed in would put someone's
 * real data in the repository.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT_DIR = `${ROOT}/bench/realpages`;
const CDP_PORT = 9337;

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const WAIT = Number(arg('--wait', 4000));
const HEADED = args.includes('--headed');

/** One `name<TAB>url` per line; `#` comments and blanks ignored. */
function targets() {
  const listFile = arg('--list', null);
  if (listFile) {
    return readFileSync(listFile, 'utf8').split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => { const [name, url] = l.split(/\s+/); return { name, url }; });
  }
  const [url, name] = args.filter((a) => !a.startsWith('--'));
  if (!url || !name) {
    console.error('usage: node scripts/capture-page.mjs <url> <name> [--wait ms] [--headed]');
    console.error('   or: node scripts/capture-page.mjs --list urls.txt');
    process.exit(2);
  }
  return [{ name, url }];
}

function findChrome() {
  try {
    return execFileSync('bash', ['-lc',
      `. "${ROOT}/scripts/find-browser.sh" && find_chrome`], { encoding: 'utf8' }).trim();
  } catch { return ''; }
}

const CHROME = findChrome();
if (!CHROME) {
  console.error('no Chrome — run scripts/get-chrome-for-testing.sh');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const chrome = spawn(CHROME, [
  ...(HEADED ? [] : ['--headless=new']),
  `--remote-debugging-port=${CDP_PORT}`,
  '--user-data-dir=/tmp/capture-page-profile',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' });

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

let failures = 0;
for (const { name, url } of targets()) {
  const dest = `${OUT_DIR}/${name}.html`;
  if (existsSync(dest) && !args.includes('--force')) {
    console.log(`  skip   ${name}  (already captured; --force to overwrite)`);
    continue;
  }
  try {
    await send('Page.navigate', { url });
    // Settle rather than race. A capture taken at DOMContentLoaded on a React portal
    // catches the empty shell, which is the exact failure `curl` has.
    await new Promise((r) => setTimeout(r, WAIT));

    const res = await send('Runtime.evaluate', {
      expression: `(() => ({
        html: document.documentElement.outerHTML,
        url: location.href,
        title: document.title,
        inputs: document.querySelectorAll('input,select,textarea').length,
        nodes: document.querySelectorAll('*').length,
      }))()`,
      returnByValue: true,
    });
    const r = res.result?.result?.value;
    if (!r?.html) throw new Error('no HTML returned');

    /**
     * A shell is not a capture. A rendered portal has controls and a few hundred nodes;
     * an un-hydrated one has neither, and saving it would quietly add a page to the
     * corpus that tests nothing. Better to refuse and say why.
     */
    if (r.nodes < 100) {
      console.log(`  REJECT ${name}  only ${r.nodes} nodes — page did not render, `
        + `try --wait ${WAIT * 2}`);
      failures++;
      continue;
    }

    // Provenance in the file itself, because a corpus you cannot re-derive is one you
    // cannot trust a year later.
    const header = `<!-- captured ${new Date().toISOString().slice(0, 10)} from ${r.url}\n`
      + `     ${r.nodes} nodes, ${r.inputs} form controls, rendered DOM via `
      + `scripts/capture-page.mjs\n`
      + `     PUBLIC PAGE, CAPTURED LOGGED OUT. -->\n`;
    writeFileSync(dest, header + r.html);
    console.log(`  ok     ${name.padEnd(18)} ${String(r.nodes).padStart(5)} nodes, `
      + `${String(r.inputs).padStart(3)} controls  ${r.title.slice(0, 40)}`);
  } catch (e) {
    console.log(`  FAIL   ${name}  ${e instanceof Error ? e.message : String(e)}`);
    failures++;
  }
}

ws.close();
chrome.kill();
console.log(failures ? `\n${failures} capture(s) failed` : '\nall captures written');
console.log('Next: node --experimental-strip-types bench/realpages-drill.ts --list');
process.exit(failures ? 1 : 0);
