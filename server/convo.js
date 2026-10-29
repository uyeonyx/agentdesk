// A task's conversation, kept live from the agent's own transcript files: the main one, and for
// Claude each subagent's own file under <session>/subagents/. Windows subscribe to the task they
// show; they get a snapshot, then small deltas as the files grow.
import fs from 'node:fs';
import path from 'node:path';
import { createParser, FULL_CAPS, relTo } from './transcript.js';
import { claudeTranscriptOf } from './sessions.js';
import { findRollout } from './activity.js';
import { realPath } from './util.js';

const WINDOW = Number(process.env.AGENTDESK_CONVO_WINDOW) || 4 * 1024 * 1024; // bytes read back on open
const KEEP = 3000; // entries in memory per conversation
const SNAP = 800; // entries in a snapshot; earlier ones come by paging
const IDLE_KEEP = 6; // conversations kept while nobody looks at them
const MAX_SUBS = 4; // per window
const FLUSH_MS = 100;
const POLL_MS = 1000;

/** The folder as the agent sees it (symlinks resolved), so its absolute paths come out relative. */
function cwdOf(task) {
  try {
    return realPath(task.cwd);
  } catch {
    return task.cwd || '';
  }
}

/** File paths in an entry's details, relative to the task folder: that's how the views open files. */
function relative(e, task) {
  const d = e.detail;
  if (!d || !task.cwd) return e;
  const cwds = [...new Set([cwdOf(task), task.cwd])];
  const rel = (p) => {
    if (typeof p !== 'string' || !p.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(p)) return p;
    for (const c of cwds) {
      const r = relTo(c, p);
      if (r !== p && !r.startsWith('~')) return r;
    }
    return p;
  };
  const fix = (files) => files?.map((f) => ({ ...f, path: rel(f.path), ...(f.to ? { to: rel(f.to) } : {}) }));
  return { ...e, detail: { ...d, ...(d.files ? { files: fix(d.files) } : {}), ...(d.edits ? { edits: fix(d.edits) } : {}), ...(typeof d.path === 'string' ? { path: rel(d.path) } : {}) } };
}

/** Display copy of an entry: `src` (file offsets) stays on the server. */
const out = ({ src, ...e }) => e;

class Convo {
  constructor(task) {
    this.task = task;
    this.epoch = 0;
    this.reset();
  }

  reset() {
    this.epoch++;
    this.files = []; // { path, off, buf, parser, parent, seg }
    this.byId = new Map();
    this.order = []; // ids in arrival order
    this.seq = 0;
    this.loaded = false;
    this.mainPath = null;
    this.subDir = null;
    this.subSeen = new Set();
  }

  /** The main transcript: from the hook when we have it, else found by session id (Codex: by folder). */
  locate() {
    const t = this.task;
    if (t.agent === 'claude') return t.transcriptPath && fs.existsSync(t.transcriptPath) ? t.transcriptPath : claudeTranscriptOf(t.watch?.sessionId || t.sessionId);
    if (t.watch?.file && fs.existsSync(t.watch.file)) return t.watch.file;
    return t.cwd ? findRollout(t.cwd, (t.createdAt || 0) - 60_000) : null;
  }

  ensure() {
    const p = this.locate();
    if (p && p !== this.mainPath) {
      // A new session (/clear, a fork): start over on the new file.
      if (this.mainPath) this.reset();
      this.mainPath = p;
      this.addFile(p, null);
      if (this.task.agent === 'claude') this.subDir = path.join(path.dirname(p), path.basename(p, '.jsonl'), 'subagents');
    }
    return !!this.mainPath;
  }

  addFile(p, parent) {
    let size = 0;
    try {
      size = fs.statSync(p).size;
    } catch {
      return;
    }
    const off = parent ? Math.max(0, size - WINDOW / 2) : Math.max(0, size - WINDOW);
    this.files.push({ path: p, off, skip: off > 0, buf: '', parent, seg: this.files.length, parser: createParser({ agent: this.task.agent, cwd: cwdOf(this.task), parent }) });
  }

  /** Subagents write their own files; each belongs to the Agent call it names in its meta file. */
  scanSubagents() {
    if (!this.subDir) return;
    let names;
    try {
      names = fs.readdirSync(this.subDir);
    } catch {
      return;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl') || this.subSeen.has(n)) continue;
      const file = path.join(this.subDir, n);
      try {
        if (fs.lstatSync(file).isSymbolicLink() || !realPath(file).startsWith(realPath(this.subDir))) continue;
      } catch {
        continue;
      }
      let parent = null;
      try {
        parent = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).toolUseId || null;
      } catch {}
      if (!parent) parent = this.parentByPrompt(file);
      if (!parent) continue; // its Agent call isn't in what we've read yet; try again later
      this.subSeen.add(n);
      this.addFile(file, parent);
    }
  }

  /** No meta file (yet): the subagent's first line is the prompt its Agent call was given. */
  parentByPrompt(file) {
    try {
      const fd = fs.openSync(file, 'r');
      const b = Buffer.alloc(64 * 1024);
      const n = fs.readSync(fd, b, 0, b.length, 0);
      fs.closeSync(fd);
      const first = JSON.parse(b.subarray(0, n).toString('utf8').split('\n')[0]);
      const c = first?.message?.content;
      const prompt = (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x?.text || '').join('') : '').trim().slice(0, 300);
      if (!prompt) return null;
      for (const id of this.order) {
        const e = this.byId.get(id);
        if (e?.kind === 'agent' && (e.detail?.prompt || '').trim().slice(0, 300) === prompt) return e.id;
      }
    } catch {}
    return null;
  }

  /** Read whatever the files gained since last time. Returns the ops for subscribers. */
  tail() {
    if (!this.ensure()) return [];
    if (this.task.agent === 'claude') this.scanSubagents();
    const ops = [];
    for (const f of this.files) {
      let st;
      try {
        st = fs.statSync(f.path);
      } catch {
        continue;
      }
      if (st.size < f.off) {
        // Rewritten from scratch: read it again.
        f.off = 0;
        f.buf = '';
      }
      if (st.size === f.off) continue;
      const len = Math.min(st.size - f.off, WINDOW);
      const b = Buffer.alloc(len);
      const fd = fs.openSync(f.path, 'r');
      fs.readSync(fd, b, 0, len, f.off);
      fs.closeSync(fd);
      let start = f.off - Buffer.byteLength(f.buf);
      f.off += len;
      const text = f.buf + b.toString('utf8');
      const lines = text.split('\n');
      f.buf = lines.pop() || '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLen = Buffer.byteLength(line) + 1;
        const at = start;
        start += lineLen;
        // The first line of a window started mid-file is a fragment.
        if (f.skip) {
          f.skip = false;
          continue;
        }
        if (!line.trim()) continue;
        let j;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        for (const op of f.parser.line(j, { seg: f.seg, off: at, len: lineLen - 1 })) this.apply(op, ops);
      }
    }
    this.loaded = true;
    return ops;
  }

  apply(op, ops) {
    if (op.op === 'add' || op.op === 'upd') {
      const old = this.byId.get(op.e.id);
      const e = { ...relative(op.e, this.task), seq: old?.seq ?? ++this.seq };
      this.byId.set(e.id, e);
      if (!old) this.order.push(e.id);
      ops.push({ op: old ? 'upd' : 'add', e: out(e) });
      if (this.order.length > KEEP) {
        for (const id of this.order.splice(0, this.order.length - KEEP)) this.byId.delete(id);
      }
    } else if (op.op === 'del') {
      if (this.byId.delete(op.id)) {
        this.order = this.order.filter((x) => x !== op.id);
        ops.push(op);
      }
    } else if (op.op === 'meta' && op.sessionId && this.task.agent === 'codex' && !this.task.sessionId) {
      this.task.sessionId = op.sessionId;
    }
  }

  list() {
    return this.order.map((id) => this.byId.get(id)).filter(Boolean);
  }

  snapshot() {
    const all = this.list();
    // The newest SNAP entries, plus the children of any subagent among them.
    const recent = all.slice(-SNAP);
    const keep = new Set(recent.map((e) => e.id));
    const tops = new Set(recent.filter((e) => e.kind === 'agent').map((e) => e.id));
    const entries = all.filter((e) => keep.has(e.id) || tops.has(e.parent)).map(out);
    return { epoch: this.epoch, entries, more: all.length > entries.length };
  }

  page({ before, limit = 200 }) {
    const all = this.list().filter((e) => (before == null || e.seq < before) && !e.parent);
    const top = all.slice(-limit);
    const ids = new Set(top.map((e) => e.id));
    const kids = this.list().filter((e) => ids.has(e.parent));
    return { epoch: this.epoch, entries: [...top, ...kids].map(out), more: all.length > top.length };
  }

  /** One entry with everything in it (whole output, whole diff), parsed again from its lines. */
  full(id) {
    const e = this.byId.get(id);
    if (!e) return null;
    if (!e.src) return out(e);
    const p = createParser({ agent: this.task.agent, cwd: cwdOf(this.task), parent: e.parent, caps: FULL_CAPS });
    let got = null;
    for (const ref of [e.src.use, e.src.res]) {
      if (!ref) continue;
      const f = this.files[ref.seg];
      if (!f) continue;
      try {
        const b = Buffer.alloc(ref.len);
        const fd = fs.openSync(f.path, 'r');
        fs.readSync(fd, b, 0, ref.len, ref.off);
        fs.closeSync(fd);
        // A subagent's first lines are skipped as its prompt; a lone re-read must not be.
        for (const op of p.line(JSON.parse(b.toString('utf8')), ref)) if ((op.op === 'add' || op.op === 'upd') && op.e.id === id) got = op.e;
      } catch {
        return null;
      }
    }
    if (!got) return null;
    // A background agent's ending (its hand-back, its notification) lives on other lines: the call
    // and its first result alone would show it still running, without a report.
    if (got.cat === 'agent') got = { ...got, st: e.st, ms: e.ms ?? got.ms, detail: { ...got.detail, result: got.detail?.result || e.detail?.result || '' } };
    return out({ ...relative(got, this.task), seq: e.seq });
  }
}

/**
 * All conversations, and which window watches which. Hooks and PTY output poke a task; a light
 * poll covers the rest while someone is looking.
 */
export class ConvoHub {
  constructor(tasks) {
    this.tasks = tasks;
    this.convos = new Map(); // taskId -> Convo, most recently used last
    this.subs = new Map(); // peer -> taskIds (most recent last)
    this.queue = new Map(); // `${peer id}|${task}` -> ops waiting for the next flush
    this.pokes = new Map();
    this.poll = setInterval(() => this.pollAll(), POLL_MS);
    this.poll.unref?.();
    this.flushTimer = null;
  }

  get(task) {
    let c = this.convos.get(task.id);
    if (c) {
      this.convos.delete(task.id);
      this.convos.set(task.id, c);
      c.task = task;
    } else {
      c = new Convo(task);
      this.convos.set(task.id, c);
      this.trim();
    }
    return c;
  }

  watched(id) {
    for (const ids of this.subs.values()) if (ids.includes(id)) return true;
    return false;
  }

  trim() {
    const idle = [...this.convos.keys()].filter((id) => !this.watched(id) && !this.tasks.rt.has(id));
    while (idle.length > IDLE_KEEP) this.convos.delete(idle.shift());
  }

  drop(id) {
    this.convos.delete(id);
  }

  sub(peer, id) {
    const task = this.tasks.store.task(id);
    if (!task) return;
    const ids = (this.subs.get(peer) || []).filter((x) => x !== id);
    ids.push(id);
    while (ids.length > MAX_SUBS) ids.shift();
    this.subs.set(peer, ids);
    const c = this.get(task);
    c.tail();
    send(peer, { t: 'convo', task: id, snap: c.snapshot() });
  }

  unsub(peer, id) {
    const ids = this.subs.get(peer);
    if (ids) this.subs.set(peer, ids.filter((x) => x !== id));
  }

  dropPeer(peer) {
    this.subs.delete(peer);
  }

  /** Something happened in this task (a hook, output): read its files soon. */
  poke(id, ms = 40) {
    if (!this.watched(id) || this.pokes.has(id)) return;
    this.pokes.set(
      id,
      setTimeout(() => {
        this.pokes.delete(id);
        this.read(id);
      }, ms)
    );
  }

  read(id) {
    const task = this.tasks.store.task(id);
    if (!task) return;
    const c = this.get(task);
    const epoch = c.epoch;
    const ops = c.tail();
    if (c.epoch !== epoch) {
      // The session changed under us: everyone gets a fresh snapshot.
      for (const [peer, ids] of this.subs) if (ids.includes(id)) send(peer, { t: 'convo', task: id, snap: c.snapshot() });
      return;
    }
    if (!ops.length) return;
    for (const [peer, ids] of this.subs) {
      if (!ids.includes(id)) continue;
      const k = peer;
      const q = this.queue.get(k) || new Map();
      const list = q.get(id) || [];
      list.push(...ops);
      q.set(id, list);
      this.queue.set(k, q);
    }
    this.flushTimer ||= setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush() {
    this.flushTimer = null;
    for (const [peer, q] of this.queue) {
      for (const [id, ops] of q) {
        // Unsubscribed while this was waiting: nothing more goes out for it.
        if (!this.subs.get(peer)?.includes(id)) continue;
        // Many updates to one entry become its last state.
        const merged = new Map();
        for (const op of ops) merged.set(op.op === 'del' ? 'del:' + op.id : op.e.id, op.op === 'upd' && merged.get(op.e.id)?.op === 'add' ? { op: 'add', e: op.e } : op);
        const list = [...merged.values()];
        const size = JSON.stringify(list).length;
        const c = this.convos.get(id);
        // Too much at once (a big catch-up): a fresh snapshot is cheaper for everyone.
        if (c && (list.length > 300 || size > 512 * 1024)) send(peer, { t: 'convo', task: id, snap: c.snapshot() });
        else send(peer, { t: 'convo', task: id, delta: { epoch: c?.epoch, ops: list } });
      }
    }
    this.queue.clear();
  }

  pollAll() {
    const seen = new Set();
    for (const ids of this.subs.values()) for (const id of ids) seen.add(id);
    for (const id of seen) {
      const t = this.tasks.store.task(id);
      if (t && (this.tasks.rt.has(id) || t.watch)) this.read(id);
    }
  }

  stop() {
    clearInterval(this.poll);
    clearTimeout(this.flushTimer);
    for (const t of this.pokes.values()) clearTimeout(t);
  }
}

function send(peer, msg) {
  try {
    if (peer.readyState === 1) peer.send(JSON.stringify(msg));
  } catch {}
}

/** The old /transcript shape (user / assistant / tool lines), for callers that still want it. */
export function legacyEntries(list, n = 150) {
  const out = [];
  for (const e of list) {
    if (e.parent) continue;
    if (e.kind === 'user') out.push({ id: e.id, role: 'user', text: e.text, at: e.at });
    else if (e.kind === 'reply') out.push({ id: e.id, role: 'assistant', text: e.md, at: e.at });
    else if (e.kind === 'tool' || e.kind === 'agent') out.push({ id: e.id, role: 'tool', text: e.title || e.tool || '', kind: e.cat || 'tool', at: e.at, st: e.st });
  }
  return out.slice(-n);
}
