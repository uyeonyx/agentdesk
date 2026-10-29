// The conversations the window is looking at, kept live: the core sends a snapshot when a task is
// subscribed and small deltas after that. A few recent ones stay cached so switching is instant.
import { useEffect, useReducer } from 'preact/hooks';
import { api, wsSend, onConvo, onReconnect } from '../api.js';
import { mergeBySeq } from './turns.js';

const MAX_SUBS = 4; // the core keeps at most this many per window
const MAX_CACHE = 8;

/** taskId -> { epoch, list: entries in order (top-level and children), byId, more, ver, users } */
const convos = new Map();
const subs = []; // most recent last

function get(id) {
  let c = convos.get(id);
  if (!c) {
    c = { epoch: 0, list: [], byId: new Map(), more: false, ver: 0, users: 0, listeners: new Set(), loaded: false };
    convos.set(id, c);
  }
  return c;
}

function notify(c) {
  c.ver++;
  for (const fn of c.listeners) fn(c.ver);
}

onConvo((m) => {
  const c = convos.get(m.task);
  if (!c) return;
  if (m.snap) {
    c.epoch = m.snap.epoch;
    c.list = m.snap.entries || [];
    c.byId = new Map(c.list.map((e) => [e.id, e]));
    c.more = !!m.snap.more;
    c.loaded = true;
    return notify(c);
  }
  if (m.delta && m.delta.epoch === c.epoch) {
    const add = [];
    for (const op of m.delta.ops || []) {
      if (op.op === 'add' || op.op === 'upd') {
        const old = c.byId.get(op.e.id);
        c.byId.set(op.e.id, op.e);
        if (old) c.list = c.list.map((x) => (x.id === op.e.id ? op.e : x));
        else add.push(op.e);
      } else if (op.op === 'del') {
        c.byId.delete(op.id);
        c.list = c.list.filter((x) => x.id !== op.id);
      }
    }
    if (add.length) c.list = mergeBySeq(c.list, add);
    notify(c);
  }
});

onReconnect(() => {
  for (const id of subs) wsSend({ t: 'convo', op: 'sub', task: id });
});

function subscribe(id) {
  const i = subs.indexOf(id);
  if (i >= 0) subs.splice(i, 1);
  subs.push(id);
  wsSend({ t: 'convo', op: 'sub', task: id });
  while (subs.length > MAX_SUBS) {
    const old = subs.shift();
    if (get(old).users > 0) {
      subs.unshift(old); // still on screen: keep it
      break;
    }
    wsSend({ t: 'convo', op: 'unsub', task: old });
  }
  // Forget the least recently used ones nobody is looking at.
  if (convos.size > MAX_CACHE) {
    for (const [k, c] of convos) {
      if (convos.size <= MAX_CACHE) break;
      if (!c.users && !subs.includes(k)) convos.delete(k);
    }
  }
}

/**
 * The live conversation of a task: `list` in order (children of subagents carry `parent`).
 * `earlier()` pages in what came before the first loaded entry.
 */
export function useConversation(taskId) {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!taskId) return;
    const c = get(taskId);
    c.users++;
    c.listeners.add(bump);
    subscribe(taskId);
    return () => {
      c.users--;
      c.listeners.delete(bump);
    };
  }, [taskId]);
  const c = taskId ? get(taskId) : null;
  return {
    loaded: !!c?.loaded,
    list: c?.list || [],
    more: !!c?.more,
    ver: c?.ver || 0,
    earlier: () => earlier(taskId),
  };
}

async function earlier(taskId) {
  const c = get(taskId);
  const first = c.list.find((e) => !e.parent);
  if (!first || !c.more) return;
  const r = await api('GET', `/api/tasks/${taskId}/convo?before=${first.seq}&limit=200`);
  if (r.epoch !== c.epoch) return;
  const fresh = (r.entries || []).filter((e) => !c.byId.has(e.id));
  for (const e of fresh) c.byId.set(e.id, e);
  c.list = mergeBySeq(c.list, fresh);
  c.more = !!r.more;
  notify(c);
}

/** Everything about one entry (whole output, whole diff), read again from the transcript. */
export function fullEntry(taskId, id) {
  return api('GET', `/api/tasks/${taskId}/entry?id=${encodeURIComponent(id)}`);
}
