// Finds agent sessions that already exist on this machine, so they can be opened in Desk:
// Claude Code sessions running right now (interactive or background, any terminal) and past
// conversations of both agents, matched to projects by working directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { AGENTS } from './agents.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isSessionId = (s) => typeof s === 'string' && UUID.test(s);

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** First `max` bytes of a file, cut at the last full line. */
function head(file, max = 96 * 1024) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(max);
    const n = fs.readSync(fd, buf, 0, max, 0);
    fs.closeSync(fd);
    const s = buf.toString('utf8', 0, n);
    return n === max ? s.slice(0, s.lastIndexOf('\n') + 1) : s;
  } catch {
    return '';
  }
}
function tail(file, max = 64 * 1024) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, max);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    const s = buf.toString('utf8');
    return len < st.size ? s.slice(s.indexOf('\n') + 1) : s;
  } catch {
    return '';
  }
}
function* jsonLines(text) {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {}
  }
}
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
// Command echoes, system reminders, environment blocks: not something a person typed.
const isNoise = (t) => !t || /^\s*</.test(t) || /^\s*\[Request interrupted/.test(t) || /^Caveat:/.test(t);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => c && (c.type === 'text' || c.type === 'input_text')).map((c) => c.text).join('\n');
  return '';
}

// ---------------------------------------------------------------- Claude: running now

let cli = { at: 0, list: null, running: null };

/** `claude agents --json`, at most one at a time; resolves to the list or null. */
function refreshCli() {
  if (cli.running) return cli.running;
  const bin = AGENTS.claude.bin();
  if (!bin) return Promise.resolve(null);
  cli.running = new Promise((resolve) => {
    execFile(bin, ['agents', '--json'], { timeout: 8000, maxBuffer: 4 * 1024 * 1024, env: cleanEnv() }, (err, stdout) => {
      let list = null;
      if (!err) {
        try {
          const j = JSON.parse(String(stdout).trim() || '[]');
          if (Array.isArray(j)) list = j;
        } catch {}
      }
      cli = { at: Date.now(), list: list || cli.list, running: null };
      resolve(list);
    });
  });
  return cli.running;
}

/**
 * Sessions Claude Code reports as running. Its registry files are read directly (instant);
 * `claude agents --json` (slow to start, seconds on some machines) only adds to that, in the
 * background, unless `wait` asks for a fresh answer (capped at 1.5 s).
 */
export async function liveClaude({ fresh = false, wait = fresh, cliOk = true } = {}) {
  if (cliOk && (Date.now() - cli.at > 10000 || fresh)) {
    const p = refreshCli();
    if (wait) await Promise.race([p, new Promise((r) => setTimeout(r, 1500))]);
  }
  let list = cli.list ? [...cli.list] : null;
  const regList = registry();
  if (!list) list = regList;
  // Either source can miss one (a CLI too old for --json, a session without a registry file).
  else for (const r of regList) if (!list.some((x) => x.sessionId === r.sessionId)) list.push(r);
  const reg = new Map(regList.map((r) => [r.pid, r]));
  const out = [];
  for (const s of list) {
    if (!s || !isSessionId(s.sessionId) || typeof s.cwd !== 'string') continue;
    out.push({
      agent: 'claude',
      sessionId: s.sessionId,
      shortId: typeof s.id === 'string' && /^[\w-]{1,64}$/.test(s.id) ? s.id : undefined,
      cwd: s.cwd,
      name: clip(s.name, 80),
      kind: s.kind === 'background' || s.kind === 'bg' ? 'background' : 'interactive',
      status: clip(s.status, 20),
      pid: Number.isInteger(s.pid) ? s.pid : undefined,
      startedAt: Number(s.startedAt) || undefined,
      where: whereOf(s.entrypoint || reg.get(s.pid)?.entrypoint, s.kind),
    });
  }
  return out;
}

/**
 * Cheap status check for sessions we follow: Claude Code keeps one small JSON file per running
 * session (pid, sessionId, status, entrypoint). Falls back to `claude agents --json` (slower).
 */
export async function liveStatus(sessionId, pid, cwd) {
  // By session id first; by pid only when it's still in the same folder (a /clear changes the id,
  // a reused pid belongs to someone else).
  const same = (x) => pid && x.pid === pid && cwd && typeof x.cwd === 'string' && real(x.cwd) === real(cwd);
  const reg = registry();
  const r = reg.find((x) => x.sessionId === sessionId) || reg.find(same);
  if (r) return { sessionId: r.sessionId, pid: r.pid, status: String(r.status || ''), where: whereOf(r.entrypoint, r.kind), kind: r.kind };
  const l = (await liveClaude()).find((x) => x.sessionId === sessionId || same(x));
  return l || null;
}

/** Where a session runs, in words: the registry's entrypoint says which app started it. */
export function whereOf(entrypoint, kind) {
  const e = String(entrypoint || '').toLowerCase();
  if (kind === 'background' || kind === 'bg') return '백그라운드';
  if (/vscode|vs_code|cursor|windsurf/.test(e)) return 'VS Code';
  if (/jetbrains|intellij/.test(e)) return 'JetBrains';
  if (/desktop|cowork|app/.test(e)) return 'Claude 앱';
  if (/sdk/.test(e)) return 'SDK';
  return '터미널';
}

function registry() {
  const dir = path.join(claudeHome(), 'sessions');
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      // The file is named after its pid; anything inconsistent is ignored.
      if (Number.isInteger(j.pid) && j.pid > 1 && f === `${j.pid}.json` && isSessionId(j.sessionId) && alive(j.pid)) out.push(j);
    } catch {}
  }
  return out;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CODEX_SANDBOX|CODEX_THREAD|AGENTDESK_)/.test(k)) delete env[k];
  return env;
}

/** The transcript file of a Claude Code session, wherever its folder is. */
export function claudeTranscriptOf(sessionId) {
  if (!isSessionId(sessionId)) return null;
  const base = path.join(claudeHome(), 'projects');
  let dirs = [];
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = path.join(base, d.name, `${sessionId}.jsonl`);
    try {
      if (fs.lstatSync(f).isFile()) return f;
    } catch {}
  }
  return null;
}

/** Hand a message to a running Codex session (`codex queue`). */
export function queueCodex(sessionId, text) {
  const bin = AGENTS.codex.bin();
  if (!bin || !isSessionId(sessionId)) return Promise.reject(new Error('codex를 찾을 수 없어요'));
  return new Promise((resolve, reject) =>
    execFile(bin, ['queue', `--thread=${sessionId}`, `--message=${text}`], { timeout: 15000, env: cleanEnv() }, (err, _o, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 300))) : resolve()))
  );
}

/** Stop a background session (its conversation is kept, so it can be resumed here). */
export function stopClaude(id) {
  const bin = AGENTS.claude.bin();
  if (!bin || !/^\w[\w-]{0,63}$/.test(id)) return Promise.resolve(false);
  return new Promise((resolve) => execFile(bin, ['stop', id], { timeout: 10000, env: cleanEnv() }, (err) => resolve(!err)));
}

// ---------------------------------------------------------------- Claude: past conversations

/** Claude Code stores each folder's transcripts under projects/<path with every non-alnum as "-">. */
const encodeDir = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');

function claudeTranscripts(roots, limit) {
  const base = path.join(claudeHome(), 'projects');
  let dirs = [];
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const keys = roots.map(encodeDir);
  const files = [];
  for (const d of dirs) {
    if (roots.length && !keys.some((k) => d === k || d.startsWith(k + '-'))) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(base, d));
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith('.jsonl') || !isSessionId(f.slice(0, -6))) continue;
      const full = path.join(base, d, f);
      try {
        const st = fs.lstatSync(full);
        if (st.isFile() && st.size > 0) files.push({ full, id: f.slice(0, -6), mtime: st.mtimeMs, size: st.size });
      } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, limit);
}

const fileCache = new Map(); // path -> { mtime, size, value }
function cached(f, read) {
  const c = fileCache.get(f.full);
  if (c && c.mtime === f.mtime && c.size === f.size) return c.value;
  const value = read(f);
  fileCache.set(f.full, { mtime: f.mtime, size: f.size, value });
  if (fileCache.size > 3000) fileCache.delete(fileCache.keys().next().value);
  return value;
}

function readClaude(f) {
  let cwd = '';
  let first = '';
  let turns = 0;
  for (const j of jsonLines(head(f.full))) {
    if (!cwd && typeof j.cwd === 'string') cwd = j.cwd;
    if (j.type === 'user' && !j.isMeta && !j.isSidechain) {
      const t = textOf(j.message?.content);
      if (!isNoise(t)) {
        turns++;
        if (!first) first = t;
      }
    }
    if (cwd && first) break;
  }
  if (!cwd) return null;
  // A name set with /rename (or an auto title) is the best label; it can be anywhere, so look at the end too.
  let title = '';
  let auto = '';
  let last = '';
  let lastPrompt = '';
  // Only the lines that can matter are parsed; tool results can be huge.
  const wanted = tail(f.full)
    .split('\n')
    .filter((l) => /"type":"(custom-title|ai-title|summary|last-prompt|assistant)"|[a-z]Title"/.test(l) && l.length < 200000)
    .join('\n');
  for (const j of jsonLines(wanted)) {
    if (j.type === 'custom-title' && (j.customTitle || j.title)) title = j.customTitle || j.title;
    else if (/title/.test(j.type || '') && (j.aiTitle || j.title || j.customTitle)) auto = j.aiTitle || j.title || j.customTitle;
    else if (j.type === 'summary' && j.summary) auto = auto || j.summary;
    else if (j.type === 'last-prompt' && typeof j.lastPrompt === 'string') lastPrompt = j.lastPrompt;
    if (j.type === 'assistant') {
      const t = textOf(j.message?.content);
      if (t.trim()) last = t;
    }
  }
  if (!first && !title && !auto) return null;
  return { agent: 'claude', sessionId: f.id, cwd, title: clip(title || auto || first, 90), first: clip(first, 200), lastPrompt: clip(lastPrompt, 160), last: clip(last, 200), updatedAt: f.mtime, size: f.size, file: f.full };
}

// ---------------------------------------------------------------- Codex: past conversations

function codexRollouts(limit) {
  const base = path.join(codexHome(), 'sessions');
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Folders are YYYY/MM/DD: newest first.
    entries.sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
        try {
          const st = fs.statSync(full);
          out.push({ full, mtime: st.mtimeMs, size: st.size });
        } catch {}
      }
    }
  };
  walk(base, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

function readCodex(f) {
  let id = '';
  let cwd = '';
  let first = '';
  for (const j of jsonLines(head(f.full))) {
    const p = j.payload || {};
    if (j.type === 'session_meta') {
      id = p.id || '';
      cwd = p.cwd || '';
    } else if (!first && j.type === 'event_msg' && p.type === 'user_message') {
      if (!isNoise(p.message)) first = p.message;
    } else if (!first && j.type === 'response_item' && p.type === 'message' && p.role === 'user') {
      const t = textOf(p.content);
      if (!isNoise(t)) first = t;
    }
    if (id && cwd && first) break;
  }
  if (!isSessionId(id) || !cwd) return null;
  let last = '';
  for (const j of jsonLines(tail(f.full))) {
    const p = j.payload || {};
    if (j.type === 'event_msg' && p.type === 'agent_message' && p.message) last = p.message;
    else if (j.type === 'response_item' && p.type === 'message' && p.role === 'assistant') last = textOf(p.content) || last;
  }
  return { agent: 'codex', sessionId: id, cwd, title: clip(first || '(제목 없음)', 90), first: clip(first, 200), last: clip(last, 200), updatedAt: f.mtime, size: f.size, file: f.full };
}

// ---------------------------------------------------------------- per-project listing

let pastCache = { at: 0, key: '', list: [] };

/**
 * Every session we can find, each tagged with the project whose folder contains its cwd.
 * Sessions already open in a Desk task carry `taskId`.
 */
export async function listSessions(store, { fresh = false, cliOk = true } = {}) {
  const projects = store.projects.filter((p) => p.kind !== 'group').map((p) => ({ id: p.id, root: real(p.path) }));
  // Longest root wins, so a nested project claims its own sessions.
  projects.sort((a, b) => b.root.length - a.root.length);
  const owner = (cwd) => {
    const c = real(cwd);
    return projects.find((p) => inside(c, p.root))?.id;
  };
  const owned = new Map();
  for (const t of store.tasks) {
    if (['merged', 'discarded'].includes(t.state)) continue;
    for (const sid of [t.sessionId, ...(t.pastSessionIds || [])]) if (sid) owned.set(sid, t.id);
  }

  const key = projects.map((p) => p.root).join('|');
  if (fresh || Date.now() - pastCache.at > 5000 || pastCache.key !== key) {
    const past = [];
    for (const f of claudeTranscripts([], 400)) {
      const s = cached(f, readClaude);
      if (s) past.push(s);
    }
    for (const f of codexRollouts(300)) {
      const s = cached(f, readCodex);
      if (s) past.push(s);
    }
    pastCache = { at: Date.now(), key, list: past };
  }

  const live = await liveClaude({ fresh, cliOk });
  const liveById = new Map(live.map((s) => [s.sessionId, s]));
  const out = [];
  const seen = new Set();
  for (const s of pastCache.list) {
    const l = liveById.get(s.sessionId);
    seen.add(s.sessionId);
    out.push({ ...s, live: l ? { kind: l.kind, status: l.status, name: l.name, shortId: l.shortId, pid: l.pid, where: l.where } : null, recent: s.agent === 'codex' && Date.now() - s.updatedAt < 120000, projectId: owner(s.cwd), taskId: owned.get(s.sessionId) });
  }
  // Running sessions that haven't written a transcript yet.
  for (const l of live) {
    if (seen.has(l.sessionId)) continue;
    out.push({ agent: 'claude', sessionId: l.sessionId, cwd: l.cwd, title: l.name || '(새 세션)', first: '', last: '', updatedAt: l.startedAt || Date.now(), live: { kind: l.kind, status: l.status, name: l.name, shortId: l.shortId, pid: l.pid, where: l.where }, projectId: owner(l.cwd), taskId: owned.get(l.sessionId) });
  }
  // Our own child processes show up as live sessions too; they're tasks, not imports.
  const ours = new Set();
  for (const t of store.tasks) if (t.pid) ours.add(t.pid);
  return out
    .filter((s) => !(s.live?.pid && ours.has(s.live.pid) && s.taskId))
    .sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || b.updatedAt - a.updatedAt)
    .map((s) => ({ ...s, cwdShort: s.cwd.startsWith(os.homedir()) ? '~' + s.cwd.slice(os.homedir().length) : s.cwd }));
}

export async function findSession(store, agent, sessionId) {
  if (!isSessionId(sessionId)) return null;
  const all = await listSessions(store, { fresh: true });
  return all.find((s) => s.agent === agent && s.sessionId === sessionId) || null;
}
