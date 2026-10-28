// The core process (an Electron utilityProcess): runs server/core.js away from the window's main
// thread, so synchronous scans and a native crash in a terminal never freeze or take down the app.
// Main hands it one MessagePort per window; that port is the window's only way in.
import { startCore, Binary } from '../server/core.js';

const parent = process.parentPort;
const hookClient = JSON.parse(process.env.AGENTDESK_HOOK_CLIENT || 'null') || undefined;
delete process.env.AGENTDESK_HOOK_CLIENT;

let core;
try {
  core = await startCore({ hookClient });
} catch (e) {
  parent.postMessage({ t: 'error', message: e.message });
  process.exit(1);
}

// Waiting tasks for the Dock badge: watch state like a window would.
const WAITING = new Set(['needs_input', 'review']);
let badge = -1;
core.connectPeer({
  readyState: 1,
  send(s) {
    let m;
    try {
      m = JSON.parse(s);
    } catch {
      return;
    }
    if (m.t !== 'state') return;
    const n = m.tasks.filter((t) => !t.archived && WAITING.has(t.state)).length;
    if (n !== badge) parent.postMessage({ t: 'badge', n: (badge = n) });
  },
});

function attach(port) {
  let open = true;
  const peer = {
    get readyState() {
      return open ? 1 : 3;
    },
    send(data) {
      if (!open) return;
      try {
        port.postMessage({ t: 'push', data });
      } catch {
        open = false;
      }
    },
  };
  const conn = core.connectPeer(peer);
  port.on('message', async ({ data: m }) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'msg') {
      let msg;
      try {
        msg = JSON.parse(m.data);
      } catch {
        return;
      }
      return conn.message(msg);
    }
    if (m.t !== 'api') return;
    let res;
    try {
      const r = await core.dispatch(String(m.method), String(m.path), m.body);
      res = r instanceof Binary ? { status: 200, type: r.type, data: new Uint8Array(r.data) } : { status: 200, body: JSON.stringify(r) };
    } catch (e) {
      if (!e.status) console.error(e);
      res = { status: e.status || 500, body: JSON.stringify({ error: e.status ? e.message : 'Desk 코어에서 오류가 났어요' }) };
    }
    if (open) port.postMessage({ t: 'res', id: m.id, ...res });
  });
  port.on('close', () => {
    open = false;
    conn.close();
  });
  port.start();
}

parent.on('message', ({ data: m, ports }) => {
  if (m?.t === 'peer' && ports[0]) attach(ports[0]);
  else if (m?.t === 'status') parent.postMessage({ t: 'status', running: core.running() });
  else if (m?.t === 'shutdown') {
    core.shutdown();
    parent.postMessage({ t: 'bye' });
    setTimeout(() => process.exit(0), 50);
  }
});

parent.postMessage({ t: 'ready', hookPath: core.hookPath });
