import { set, get } from './store.js';

// The app's preload hands this window a private channel to the core (window.desk). There is no
// URL to call and no key to keep: nothing else on the machine can reach the core this way.
const desk = () => window.desk;

export async function api(method, path, body) {
  // Every state-changing request carries a JSON body, so "no body" is still "{}".
  if (body === undefined && method !== 'GET' && method !== 'HEAD') body = {};
  let r;
  try {
    r = await desk().api(method, path, body !== undefined ? JSON.stringify(body) : undefined);
  } catch {
    throw new Error('Desk 코어에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
  }
  let j = {};
  try {
    j = JSON.parse(r.body || '{}');
  } catch {}
  if (r.status < 200 || r.status >= 300) {
    const e = new Error(j.error || `요청이 실패했어요 (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return j;
}

/** An image the core serves (project logos): bytes and a type, handed out as a blob URL. */
export async function apiBlobUrl(path) {
  let r;
  try {
    r = await desk().api('GET', path);
  } catch {
    return null;
  }
  if (r.status !== 200 || !r.data) return null;
  return URL.createObjectURL(new Blob([r.data], { type: r.type }));
}

// ------------------------------------------------------------ live channel

const termListeners = new Set();

export function onTerm(fn) {
  termListeners.add(fn);
  return () => termListeners.delete(fn);
}

let pending = [];
export function wsSend(msg) {
  if (get().connected) desk().send(JSON.stringify(msg));
  else pending.push(msg);
}

// One agent terminal and one shell can be attached at a time; both come back after the core restarts.
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
  desk().onConnection((up) => {
    set({ connected: up });
    if (!up) return;
    // Re-attach the terminals after a (re)connect; drop queued attaches (they're stale).
    pending = pending.filter((m) => m.t !== 'attach');
    for (const a of Object.values(lastAttach)) desk().send(JSON.stringify(a));
    for (const m of pending) desk().send(JSON.stringify(m));
    pending = [];
  });
  desk().onPush((data) => {
    let m;
    try {
      m = JSON.parse(data);
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
        platform: m.platform,
        agents: m.agents,
        palette: m.palette,
        icons: m.icons,
        prefs: m.prefs || {},
        projects: m.projects,
        tasks: m.tasks,
      });
    } else for (const l of termListeners) l(m);
  });
}

/** App updates: the state lives in the store as `update`; actions go to the app (desktop/updater.js). */
export function watchUpdates() {
  desk().onUpdate((u) => set({ update: u }));
  desk()
    .update('state')
    .then((u) => u && set({ update: u }))
    .catch(() => {});
}
export const updateAction = (action) => desk().update(action).then((u) => u && set({ update: u }));

/** Bring this window to the front (after a notification click, even when it was closed to the Dock). */
export function focusWindow() {
  desk().focus();
}
