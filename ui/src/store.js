import { useLayoutEffect, useReducer, useRef } from 'preact/hooks';

/** Minimal global store: one state object, shallow-merged updates, selector hooks. */
const listeners = new Set();
let state = {
  connected: false,
  update: null,
  loaded: false,
  version: '',
  home: '',
  agents: {},
  palette: [],
  icons: [],
  prefs: {},
  projects: [],
  tasks: [],
  // UI
  selected: load('selected', null),
  filter: load('filter', null),
  views: load('views', {}),
  collapsed: load('collapsed', { done: true }),
  modal: null, // { kind, ... }
  banner: null, // { kind:'send'|'create', taskId, msgId, text, projectId, at }
  toasts: [],
  comments: load('comments', {}), // taskId -> [{id,path,start,end,text}]
  refs: {}, // taskId -> [{id,path,start,end,code}]
  drafts: {}, // taskId -> text
  openFile: {}, // taskId -> {path, ref, line}
  treeOpen: load('treeOpen', false),
  // On a phone the panel would cover the terminal, so it starts closed there.
  progressOpen: typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches ? false : load('progressOpen', true),
  view: load('view', 'inbox'), // 'inbox' | 'board'
  widgets: load('widgets', {}), // taskId -> { size: 's'|'m'|'l', pinned }
  showDone: load('showDone', false),
  nudge: 0,
  shellOpen: load('shellOpen', false),
  shellH: load('shellH', 260),
};

function load(k, d) {
  try {
    const v = localStorage.getItem('desk.' + k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
}
const PERSIST = ['shellOpen', 'shellH', 'selected', 'filter', 'views', 'collapsed', 'comments', 'treeOpen', 'progressOpen', 'view', 'widgets', 'showDone'];

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
export const taskOf = (s, id) => s.tasks.find((t) => t.id === id);

let toastId = 0;
export function toast(text, opts = {}) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, ...opts }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), opts.ms || 4200);
  return id;
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
