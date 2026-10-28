// The window's only door to the core. Main sends a MessagePort once the page is loaded (and again
// if the core restarts); everything the page can do goes through the few functions exposed here.
const { contextBridge, ipcRenderer } = require('electron');

let port = null;
let seq = 0;
const waiting = new Map(); // request id -> resolve
const pushListeners = new Set();
const connListeners = new Set();
const updateListeners = new Set();
ipcRenderer.on('desk:update-state', (_e, s) => {
  for (const fn of updateListeners) fn(s);
});

let portWaiters = []; // requests made before the core is connected (app start, core restart)

function setConnected(up) {
  if (up) {
    for (const go of portWaiters) go();
    portWaiters = [];
  }
  for (const fn of connListeners) fn(up);
}

function whenConnected(ms = 15000) {
  if (port) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('not connected')), ms);
    portWaiters.push(() => (clearTimeout(t), resolve()));
  });
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
  async api(method, path, bodyText) {
    await whenConnected();
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
  /** The top bar's colors, so the window's title bar area, background and native menus match. */
  setChrome({ bg, fg, dark }) {
    ipcRenderer.send('desk:chrome', { bg: String(bg), fg: String(fg), dark: !!dark });
  },
  onFullscreen(fn) {
    const h = (_e, on) => fn(!!on);
    ipcRenderer.on('desk:fullscreen', h);
    return () => ipcRenderer.off('desk:fullscreen', h);
  },
  /** 'state' | 'check' | 'download' | 'apply' | 'page' → the update state (see desktop/updater.js). */
  update(action) {
    return ipcRenderer.invoke('desk:update', String(action));
  },
  onUpdate(fn) {
    updateListeners.add(fn);
    return () => updateListeners.delete(fn);
  },
});
