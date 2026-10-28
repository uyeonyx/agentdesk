import { set, get } from './store.js';

// Page key: arrives once in the URL fragment after login, then lives in this origin's storage.
// Other localhost ports receive our cookie but can never read this.
let KEY = '';
export function bootKey() {
  const m = location.hash.match(/(?:^#|&)k=([0-9a-f]{64})/);
  if (m) {
    KEY = m[1];
    try {
      localStorage.setItem('desk.key', KEY);
    } catch {}
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    try {
      KEY = localStorage.getItem('desk.key') || '';
    } catch {}
  }
  return !!KEY;
}

export async function api(method, path, body) {
  let r;
  // Every state-changing request carries a JSON body: the daemon accepts nothing else (a form
  // post from another site can't send application/json), so "no body" must still be "{}".
  if (body === undefined && method !== 'GET' && method !== 'HEAD') body = {};
  try {
    r = await fetch(path, {
      method,
      headers: { 'x-desk-key': KEY, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Desk 서비스에 연결할 수 없어요. 터미널에서 agentdesk 를 실행하세요.');
  }
  if (r.status === 401) {
    throw new Error('로그인이 풀렸어요. 터미널에서 agentdesk 를 실행하면 새 링크가 열려요.');
  }
  let j = {};
  try {
    j = await r.json();
  } catch {}
  if (!r.ok) {
    const e = new Error(j.error || `요청이 실패했어요 (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return j;
}

/** An image the API serves (project logos): fetched with the page key, handed out as a blob URL. */
export async function apiBlobUrl(path) {
  const r = await fetch(path, { headers: { 'x-desk-key': KEY }, credentials: 'same-origin' });
  if (!r.ok) return null;
  return URL.createObjectURL(await r.blob());
}

// ------------------------------------------------------------ websocket

let ws;
let backoff = 400;
let failures = 0;
const termListeners = new Set();

export function onTerm(fn) {
  termListeners.add(fn);
  return () => termListeners.delete(fn);
}

let pending = [];
export function wsSend(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  else pending.push(msg);
}

// One agent terminal and one shell can be attached at a time; both come back after a reconnect.
const lastAttach = {};
export function attachTerm(task, cols, rows) {
  const kind = String(task).startsWith('sh_') ? 'shell' : 'agent';
  lastAttach[kind] = { t: 'attach', task, cols, rows };
  wsSend(lastAttach[kind]);
}
export function detachTerm(task) {
  const kind = String(task).startsWith('sh_') ? 'shell' : 'agent';
  delete lastAttach[kind];
  wsSend({ t: 'detach', task });
}

const stateHandlers = new Set();
export function onState(fn) {
  stateHandlers.add(fn);
  return () => stateHandlers.delete(fn);
}

export function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`, ['desk', 'k.' + KEY]);
  let opened = false;
  ws.onopen = () => {
    opened = true;
    failures = 0;
    set({ authFailed: false });
    backoff = 400;
    set({ connected: true });
    // Re-attach the terminal after a reconnect; drop queued attaches (they're stale).
    pending = pending.filter((m) => m.t !== 'attach');
    for (const a of Object.values(lastAttach)) ws.send(JSON.stringify(a));
    for (const m of pending) ws.send(JSON.stringify(m));
    pending = [];
  };
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.t === 'state') {
      const prev = get();
      for (const h of stateHandlers) h(prev, m);
      set({
        loaded: true,
        version: m.version,
        home: m.home,
        agents: m.agents,
        palette: m.palette,
        icons: m.icons,
        prefs: m.prefs || {},
        projects: m.projects,
        tasks: m.tasks,
      });
    } else for (const l of termListeners) l(m);
  };
  ws.onclose = (ev) => {
    set({ connected: false });
    if (!opened) failures++;
    if (failures >= 3) set({ authFailed: true });
    if (ev.code === 1008 || ev.code === 4401) return;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 1.7, 5000);
  };
}
