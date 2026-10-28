// The window's only door to the core. Main sends a MessagePort once the page is loaded (and again
// if the core restarts); everything the page can do goes through the few functions exposed here.
const { contextBridge, ipcRenderer } = require('electron');

let port = null;
let seq = 0;
const waiting = new Map(); // request id -> resolve
const pushListeners = new Set();
const connListeners = new Set();

function setConnected(up) {
  for (const fn of connListeners) fn(up);
}

ipcRenderer.on('desk:port', (event) => {
  const next = event.ports[0];
  if (!next) return;
  if (port) port.close();
  // Requests in flight went to a core that is gone: fail them so the UI can say so.
  for (const resolve of waiting.values()) resolve({ status: 503, body: JSON.stringify({ error: 'Desk 코어가 다시 시작됐어요' }) });
  waiting.clear();
  port = next;
  port.onmessage = ({ data: m }) => {
    if (m?.t === 'push') for (const fn of pushListeners) fn(m.data);
    else if (m?.t === 'res') {
      const resolve = waiting.get(m.id);
      waiting.delete(m.id);
      resolve?.(m.type ? { status: m.status, type: m.type, data: m.data } : { status: m.status, body: m.body });
    }
  };
  port.start();
  setConnected(true);
});
ipcRenderer.on('desk:core-down', () => {
  port = null;
  setConnected(false);
});

contextBridge.exposeInMainWorld('desk', {
  platform: process.platform,
  /** @returns {Promise<{status:number, body?:string, type?:string, data?:Uint8Array}>} */
  api(method, path, bodyText) {
    if (!port) return Promise.reject(new Error('not connected'));
    const id = ++seq;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      port.postMessage({ t: 'api', id, method: String(method), path: String(path), body: typeof bodyText === 'string' ? bodyText : undefined });
    });
  },
  send(text) {
    if (port) port.postMessage({ t: 'msg', data: String(text) });
  },
  onPush(fn) {
    pushListeners.add(fn);
    return () => pushListeners.delete(fn);
  },
  onConnection(fn) {
    connListeners.add(fn);
    if (port) fn(true);
    return () => connListeners.delete(fn);
  },
  focus() {
    ipcRenderer.send('desk:focus');
  },
});
