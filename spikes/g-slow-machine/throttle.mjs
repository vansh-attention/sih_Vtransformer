/**
 * Drive Chrome's CPU throttling over the DevTools protocol.
 *
 * The page runs its benchmark once per rate. `Emulation.setCPUThrottlingRate` slows the
 * main thread by a multiplier — the same control the DevTools Performance panel exposes
 * as "4x slowdown".
 */
const rates = [1, 4, 6];

async function cdp() {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('no debuggable page');
  return page.webSocketDebuggerUrl;
}

const url = await cdp();
const ws = new WebSocket(url);
let id = 0;
const pending = new Map();

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const resolve = pending.get(msg.id);
  if (resolve) { pending.delete(msg.id); resolve(msg); }
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

await new Promise((r) => ws.addEventListener('open', r));
console.log('CDP connected');

/**
 * Runtime.evaluate reports failures in `exceptionDetails`, NOT by rejecting. Ignoring
 * that field made every call look successful while `window.__runBench` did not yet
 * exist, and the benchmark posted an empty result set with no error anywhere.
 */
async function evaluate(expression, opts = {}) {
  const res = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, ...opts,
  });
  const ex = res.result?.exceptionDetails;
  if (ex) throw new Error(`page threw: ${ex.exception?.description ?? ex.text}`);
  return res.result?.result?.value;
}

// The page loads ONNX Runtime and two models before it defines __runBench, so a fixed
// sleep is a race. Wait for the function to actually exist.
process.stdout.write('waiting for the page to be ready');
for (let i = 0; i < 120; i++) {
  const ready = await evaluate("typeof window.__runBench === 'function'");
  if (ready) { console.log(' — ready'); break; }
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 1000));
  if (i === 119) throw new Error('page never became ready');
}

for (const rate of rates) {
  await send('Emulation.setCPUThrottlingRate', { rate });
  await evaluate(`window.__runBench(${rate})`);
  const count = await evaluate('window.__count()');
  console.log(`  ${rate}x done (${count} run(s) recorded)`);
}

await evaluate('window.__report()');
ws.close();
