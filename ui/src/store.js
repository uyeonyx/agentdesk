import { useLayoutEffect, useReducer, useRef } from 'preact/hooks';

/** Minimal global store: one state object, shallow-merged updates, selector hooks. */
const listeners = new Set();

export const DEFAULT_SETTINGS = {
  sounds: true,
  volume: 0.55,
  // When to notify: 'blocked' (only when an agent is stuck on me) | 'yours' (every time it's my turn) | 'off'
  notify: 'yours',
  quickReplies: ['계속해 줘', '테스트 돌려 줘', '커밋해 줘'],
};

let state = {
  connected: false,
  update: null,
  loaded: false,
  version: '',
  home: '',
  platform: '',
  agents: {},
  palette: [],
  icons: [],
  prefs: {},
  projects: [],
  tasks: [],
  // Where the person is.
  screen: load('screen', 'task'), // 'task' | 'overview' | 'settings'
  settingsTab: 'theme',
  selected: load('selected', null),
  filter: load('filter', null),
  views: load('views', {}), // taskId -> 'chat' | 'review' | 'files'
  collapsed: load('collapsed', { done: true }),
  railView: 'list', // 'list' | 'shelf'
  railW: load('railW', 300),
  railHidden: load('railHidden', false),
  drawer: load('drawer', { open: false, tab: 'agent', h: 280 }),
  treeOpen: load('treeOpen', false),
  // Layers on top.
  modal: null, // { kind, ... }
  command: null, // the command bar: { mode: 'all'|'new'|'files'|'theme', query }
  ctx: null, // the open right-click menu: { x, y, items }
  cheat: false,
  toasts: [],
  // Work in progress.
  drafts: load('drafts', {}), // taskId -> text
  comments: load('comments', {}), // taskId -> [{id,path,start,end,text}]
  refs: {}, // taskId -> [{id,path,start,end}]
  attachments: {}, // taskId -> [{id, path, name}]
  openFile: {}, // taskId -> {path, ref, line}
  picked: [], // rows picked with ⌘/Ctrl or Shift, for acting on several at once
  pickAnchor: null,
  triage: null, // { queue, at, tally, from }
  pending: {}, // taskId -> optimistic patch until the core confirms
  lastSend: null, // { taskId, msgId, at, restore } — ⌘Z takes it back for a few seconds
  settings: { ...DEFAULT_SETTINGS, ...load('settings', {}) },
  theme: null, // the person's theme choice, owned by the main process
  userThemes: [],
};

function load(k, d) {
  try {
    const v = localStorage.getItem('desk.' + k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
}
const PERSIST = ['screen', 'selected', 'filter', 'views', 'collapsed', 'railW', 'railHidden', 'drawer', 'treeOpen', 'drafts', 'comments', 'settings'];

export function get() {
  return state;
}

export function set(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const k of PERSIST) {
    if (k in next) {
      try {
        localStorage.setItem('desk.' + k, JSON.stringify(state[k]));
      } catch {}
    }
  }
  for (const l of listeners) l(state);
}

export function useStore(sel = (s) => s) {
  // The value is computed from the selector on every render, so a selector that changes
  // (e.g. a different task id) can never return the previous task's data.
  const [, force] = useReducer((x) => x + 1, 0);
  const selRef = useRef(sel);
  selRef.current = sel;
  const valRef = useRef();
  const nv = sel(state);
  if (!shallowEq(valRef.current, nv)) valRef.current = nv;
  // Subscribe before paint, then catch up: an update that landed between this render and the
  // subscription (the first live state often does) would otherwise be missed until the next one.
  useLayoutEffect(() => {
    const l = (s) => {
      const v = selRef.current(s);
      if (!shallowEq(valRef.current, v)) {
        valRef.current = v;
        force();
      }
    };
    listeners.add(l);
    l(state);
    return () => listeners.delete(l);
  }, []);
  return valRef.current;
}

function shallowEq(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

// ------------------------------------------------------------ derived helpers

export const projectOf = (s, id) => s.projects.find((p) => p.id === id);
/** A task with whatever the window has done to it and the core hasn't confirmed yet. */
export const taskOf = (s, id) => {
  const t = s.tasks.find((x) => x.id === id);
  const p = t && s.pending?.[id];
  return p ? { ...t, ...p.patch } : t;
};

let toastId = 0;
export function toast(text, opts = {}) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, ...opts }] }));
  setTimeout(() => dismissToast(id), opts.ms || 4200);
  return id;
}
export function dismissToast(id) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function setView(taskId, view) {
  set((s) => ({ views: { ...s.views, [taskId]: view } }));
}

export function openModal(kind, extra = {}) {
  set({ modal: { kind, ...extra } });
}
export function closeModal() {
  set({ modal: null });
}

export function setSettings(patch) {
  set((s) => ({ settings: { ...s.settings, ...patch } }));
}

/** Optimistic: show the change now; the core's next push confirms it, or it reverts after a while. */
export function optimistic(taskId, patch, ms = 8000) {
  const at = Date.now();
  set((s) => ({ pending: { ...s.pending, [taskId]: { patch, at } } }));
  setTimeout(() => {
    if (get().pending[taskId]?.at === at) clearPending(taskId);
  }, ms);
}
export function clearPending(taskId) {
  if (!get().pending[taskId]) return;
  set((s) => {
    const p = { ...s.pending };
    delete p[taskId];
    return { pending: p };
  });
}
