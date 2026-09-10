/**
 * Install a temporary add-on into a running Firefox over the Remote Debugging Protocol.
 *
 * Firefox has no `--load-extension` flag. `web-ext` is the usual tool, but it is another
 * dependency and it wraps this same protocol, so we speak it directly: connect to the
 * debugger server, ask the root actor for the addons actor, and call
 * `installTemporaryAddon` with a path.
 *
 * RDP framing is `<byteLength>:<json>` — length in BYTES, not characters.
 */

import net from 'node:net';

const addonPath = process.argv[2];
if (!addonPath) {
  console.error('usage: install.mjs <extension-dir>');
  process.exit(1);
}

const socket = net.connect(6000, '127.0.0.1');
let buffer = Buffer.alloc(0);
const pending = [];

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const colon = buffer.indexOf(0x3a); // ':'
    if (colon === -1) return;
    const len = Number(buffer.subarray(0, colon).toString('ascii'));
    if (!Number.isFinite(len)) return;
    if (buffer.length < colon + 1 + len) return;
    const body = buffer.subarray(colon + 1, colon + 1 + len).toString('utf8');
    buffer = buffer.subarray(colon + 1 + len);
    const msg = JSON.parse(body);
    const handler = pending.shift();
    if (handler) handler(msg);
    else console.log('[rdp] unsolicited:', JSON.stringify(msg).slice(0, 200));
  }
});

function send(payload) {
  return new Promise((resolve) => {
    pending.push(resolve);
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    socket.write(`${json.length}:`);
    socket.write(json);
  });
}

socket.on('connect', async () => {
  try {
    // The first frame is an unsolicited greeting; it only carries protocol traits.
    const greeting = await new Promise((resolve) => pending.push(resolve));
    console.log('[rdp] greeting traits:', Object.keys(greeting).join(', '));

    // Actor IDs come from getRoot, not from the greeting. Older Firefox put
    // `addonsActor` in the greeting directly, which is why the obvious approach fails
    // silently on current builds.
    const root = await send({ to: 'root', type: 'getRoot' });
    const addonsActor = root.addonsActor ?? root.addonsActorID;
    if (!addonsActor) {
      console.error('[rdp] no addons actor from getRoot:', Object.keys(root).join(', '));
      process.exit(2);
    }
    console.log('[rdp] addons actor:', addonsActor);

    const res = await send({
      to: addonsActor,
      type: 'installTemporaryAddon',
      addonPath,
      openDevTools: false,
    });

    if (res.error) {
      console.error('[rdp] install failed:', JSON.stringify(res));
      process.exit(3);
    }
    console.log('[rdp] installed:', JSON.stringify(res).slice(0, 300));
    socket.end();
  } catch (e) {
    console.error('[rdp] error:', e);
    process.exit(4);
  }
});

socket.on('error', (e) => {
  console.error('[rdp] socket error:', e.message);
  process.exit(5);
});
