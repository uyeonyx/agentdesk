// What an agent is doing right now: its plan, its subagents, and a feed of tool calls.
// Fed by Claude Code hooks (PreToolUse/PostToolUse/Subagent*) and, for Codex, by tailing
// its session log. Everything here is display data; nothing in it is ever executed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realPath } from './util.js';

const FEED_MAX = 120;
const SUB_FEED_MAX = 30;
const clip = (s, n = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

export function emptyActivity() {
  return { plan: [], subagents: [], feed: [], current: '', pending: [] };
}

/** Normalize a plan item's status into: pending | active | done. */
function planStatus(s) {
  s = String(s || '').toLowerCase();
  if (/complete|done|finish/.test(s)) return 'done';
  if (/progress|active|running|doing/.test(s)) return 'active';
  return 'pending';
}

function relTo(cwd, p) {
  if (typeof p !== 'string') return '';
  // Shown like every other repo path in the UI: with "/" (Windows hands us "\\").
  if (cwd && (p === cwd || p.startsWith(cwd + path.sep))) return p.slice(cwd.length + 1).split(path.sep).join('/') || '.';
  return p.replace(os.homedir(), '~');
}

/** Short human line for a tool call. kind drives the icon in the UI. */
export function describeTool(name, input = {}, cwd = '') {
  const n = String(name || '');
  const i = input && typeof input === 'object' ? input : {};
  switch (n) {
    case 'Bash':
      return { kind: 'cmd', text: `$ ${clip(String(i.command || '').split('\n')[0], 110)}` };
    case 'Edit':
    case 'MultiEdit':
      return { kind: 'edit', text: `수정 ${relTo(cwd, i.file_path)}` };
    case 'Write':
      return { kind: 'edit', text: `작성 ${relTo(cwd, i.file_path)}` };
    case 'NotebookEdit':
      return { kind: 'edit', text: `노트북 수정 ${relTo(cwd, i.notebook_path)}` };
    case 'Read':
      return { kind: 'read', text: `읽기 ${relTo(cwd, i.file_path)}` };
    case 'Grep':
      return { kind: 'search', text: `찾기 "${clip(i.pattern, 60)}"` };
    case 'Glob':
      return { kind: 'search', text: `파일 찾기 ${clip(i.pattern, 60)}` };
    case 'WebFetch':
      return { kind: 'web', text: `웹 ${clip(safeHost(i.url), 60)}` };
    case 'WebSearch':
      return { kind: 'web', text: `검색 "${clip(i.query, 60)}"` };
    case 'Agent':
    case 'Task':
      return { kind: 'agent', text: `서브에이전트: ${clip(i.description || i.subagent_type || '작업', 80)}` };
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return { kind: 'plan', text: '할 일 갱신' };
    default:
      if (n.startsWith('mcp__')) {
        const [, server, tool] = n.split('__');
        return { kind: 'tool', text: `${server}: ${tool}` };
      }
      return { kind: 'tool', text: n };
  }
}

function safeHost(u) {
  try {
    return new URL(u).host;
  } catch {
    return String(u || '');
  }
}

function push(list, item, max) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

export class ActivityTracker {
  /**
   * @param {object} task   persisted task; its `activity` field is mutated in place
   * @param {() => void} changed
   */
  constructor(task, changed) {
    this.task = task;
    this.changed = changed;
    if (!task.activity) task.activity = emptyActivity();
    this.a = task.activity;
    this.a.pending ||= [];
    this.codex = null; // { file, offset, startedAt }
    // Tool hooks are async: each runs in its own process, so a PostToolUse can arrive before its
    // PreToolUse (easily on Windows, where starting the hook client takes ~100 ms). id -> 'ok'|'err'.
    this.finished = new Map();
  }

  sub(id) {
    return this.a.subagents.find((s) => s.id === id);
  }

  // ---------------------------------------------------------------- Claude Code hooks

  claude(p) {
    const ev = p.hook_event_name;
    const agentId = typeof p.agent_id === 'string' && p.agent_id ? p.agent_id : null;
    const cwd = this.task.cwd;
    if (ev === 'SubagentStart' && agentId) {
      // The description came from the parent's Agent tool call just before.
      const idx = this.a.pending.findIndex((x) => !p.agent_type || x.type === p.agent_type || !x.type);
      const pend = idx >= 0 ? this.a.pending.splice(idx, 1)[0] : null;
      if (!this.sub(agentId)) {
        this.a.subagents.push({ id: agentId, type: clip(p.agent_type || pend?.type || 'agent', 40), desc: clip(pend?.desc || '', 120), status: 'running', startedAt: Date.now(), endedAt: 0, last: '', tools: 0, feed: [], plan: [] });
      }
      return this.changed();
    }
    if (ev === 'SubagentStop' && agentId) {
      const s = this.sub(agentId);
      if (s) {
        s.status = 'done';
        s.endedAt = Date.now();
        if (p.last_assistant_message) s.result = clip(p.last_assistant_message, 200);
        s.last = s.result || s.last;
      }
      return this.changed();
    }
    if (ev === 'PreToolUse' || ev === 'PostToolUse' || ev === 'PostToolUseFailure') {
      const name = p.tool_name;
      const input = p.tool_input || {};
      const d = describeTool(name, input, cwd);
      const owner = agentId ? this.sub(agentId) : null;
      if (ev === 'PreToolUse') {
        if ((name === 'Agent' || name === 'Task') && !agentId) this.a.pending.push({ type: input.subagent_type || '', desc: input.description || clip(input.prompt, 80) });
        const item = { id: String(p.tool_use_id || Math.random()), at: Date.now(), kind: d.kind, text: d.text, by: agentId || '', st: this.finished.get(String(p.tool_use_id)) || 'run' };
        if (d.kind !== 'plan') {
          if (owner) {
            push(owner.feed, item, SUB_FEED_MAX);
            owner.last = d.text;
            owner.tools++;
          } else if (item.st === 'run') this.a.current = d.text;
          push(this.a.feed, item, FEED_MAX);
        }
      } else {
        const failed = ev === 'PostToolUseFailure' || p.tool_response?.is_error === true || (typeof p.tool_response?.exit_code === 'number' && p.tool_response.exit_code !== 0);
        const id = String(p.tool_use_id || '');
        if (id) {
          this.finished.set(id, failed ? 'err' : 'ok');
          if (this.finished.size > 300) this.finished.delete(this.finished.keys().next().value);
        }
        for (const list of [this.a.feed, owner?.feed || []]) {
          const it = list.find((x) => x.id === id);
          if (it) {
            it.st = failed ? 'err' : 'ok';
            if (p.duration_ms) it.ms = p.duration_ms;
          }
        }
        if (!owner && this.a.current === d.text) this.a.current = '';
        this.plan(name, input, p.tool_response, owner);
      }
      return this.changed();
    }
  }

  /** Plans come from TodoWrite (whole list) or TaskCreate/TaskUpdate (one item at a time). */
  plan(name, input, response, owner) {
    const target = owner ? owner.plan : this.a.plan;
    if (name === 'TodoWrite' && Array.isArray(input.todos)) {
      target.splice(0, target.length, ...input.todos.slice(0, 50).map((t, i) => ({ id: String(i), text: clip(t.content || t.activeForm || '', 100), status: planStatus(t.status) })));
    } else if (name === 'TaskCreate') {
      const m = JSON.stringify(response ?? '').match(/#(\d+)/);
      target.push({ id: m ? m[1] : String(target.length + 1), text: clip(input.subject || input.description || '', 100), status: 'pending' });
      if (target.length > 50) target.shift();
    } else if (name === 'TaskUpdate') {
      const it = target.find((t) => t.id === String(input.taskId));
      if (it) {
        if (input.status === 'deleted') target.splice(target.indexOf(it), 1);
        else if (input.status) it.status = planStatus(input.status);
        if (input.subject) it.text = clip(input.subject, 100);
      }
    }
  }

  /** The turn is over: nothing is "running" any more. */
  turnEnded() {
    this.a.current = '';
    for (const f of this.a.feed) if (f.st === 'run') f.st = 'ok';
    if (this.task.agent === 'codex') for (const s of this.a.subagents) if (s.status === 'running') s.status = 'done';
    this.changed();
  }

  // ---------------------------------------------------------------- Codex session log

  /** Called before the agent is started again: forget the old log, but remember how far it was read. */
  restart() {
    if (this.codex) this.resumeMark = { file: this.codex.file, size: this.codex.offset };
    this.codex = null;
  }

  /** Find and follow this task's Codex session log (~/.codex/sessions/**\/rollout-*.jsonl). */
  pollCodex(startedAt) {
    try {
      if (!this.codex) {
        const f = findRollout(this.task.cwd, startedAt);
        if (!f) return;
        // A resumed session may keep writing to its old log: skip what was already shown.
        const offset = this.resumeMark?.file === f ? this.resumeMark.size : 0;
        this.codex = { file: f, offset, buf: '' };
      }
      const c = this.codex;
      const st = fs.statSync(c.file);
      if (st.size <= c.offset) return;
      const len = Math.min(st.size - c.offset, 2_000_000);
      const fd = fs.openSync(c.file, 'r');
      const b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, c.offset);
      fs.closeSync(fd);
      c.offset += len;
      c.buf += b.toString('utf8');
      const lines = c.buf.split('\n');
      c.buf = lines.pop() || '';
      let touched = false;
      for (const line of lines) if (line.trim() && this.codexLine(line)) touched = true;
      if (touched) this.changed();
    } catch {}
  }

  codexLine(line) {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      return false;
    }
    const p = j.payload || j;
    // The session id is what `codex resume <id>` needs to reopen exactly this conversation.
    if (j.type === 'session_meta' && typeof p.id === 'string' && /^[0-9a-f-]{36}$/i.test(p.id)) {
      if (this.task.sessionId !== p.id) {
        this.task.sessionId = p.id;
        return true;
      }
      return false;
    }
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const name = String(p.name || '');
      let args = {};
      try {
        args = typeof p.arguments === 'string' ? JSON.parse(p.arguments) : p.arguments || p.input || {};
      } catch {
        args = { raw: String(p.arguments || p.input || '') };
      }
      const id = String(p.call_id || Math.random());
      if (name === 'update_plan' && Array.isArray(args.plan)) {
        this.a.plan.splice(0, this.a.plan.length, ...args.plan.slice(0, 50).map((s, i) => ({ id: String(i), text: clip(s.step || s.text || '', 100), status: planStatus(s.status) })));
        return true;
      }
      let d;
      if (name === 'spawn_agent') {
        const desc = clip(args.task_name || args.message || args.prompt || '서브에이전트', 100);
        this.a.subagents.push({ id, type: clip(args.agent_type || 'agent', 40), desc, status: 'running', startedAt: Date.now(), endedAt: 0, last: '', tools: 0, feed: [], plan: [] });
        d = { kind: 'agent', text: `서브에이전트: ${desc}` };
      } else if (/shell|exec_command|local_shell/.test(name)) {
        const cmd = Array.isArray(args.command) ? args.command.join(' ') : args.command || args.cmd || '';
        d = { kind: 'cmd', text: `$ ${clip(String(cmd).replace(/^bash -lc /, ''), 110)}` };
      } else if (name === 'apply_patch') {
        const files = [...String(args.input || args.patch || args.raw || '').matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map((m) => m[1].trim());
        d = { kind: 'edit', text: `수정 ${files.slice(0, 3).map((f) => relTo(this.task.cwd, f)).join(', ') || '파일'}` };
      } else d = { kind: 'tool', text: name };
      push(this.a.feed, { id, at: Date.now(), kind: d.kind, text: d.text, by: '', st: 'run' }, FEED_MAX);
      this.a.current = d.text;
      return true;
    }
    if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
      const it = this.a.feed.find((x) => x.id === String(p.call_id));
      if (it) {
        const out = typeof p.output === 'string' ? p.output : JSON.stringify(p.output || '');
        it.st = /"exit_code":\s*[1-9]|Exit code: [1-9]|error/i.test(out.slice(0, 400)) ? 'err' : 'ok';
        if (this.a.current === it.text) this.a.current = '';
        return true;
      }
    }
    return false;
  }
}

function codexRoot() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
}

/** Newest rollout file started after `since` whose session_meta cwd is this task's folder. */
export function findRollout(cwd, since) {
  const root = codexRoot();
  let realRoot;
  let realCwd;
  try {
    realRoot = realPath(root);
    realCwd = realPath(cwd);
  } catch {
    return null;
  }
  const candidates = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs >= since - 5000) candidates.push([st.mtimeMs, p]);
        } catch {}
      }
    }
  };
  // Only look at recent day folders: sessions/YYYY/MM/DD.
  walk(realRoot, 0);
  candidates.sort((a, b) => b[0] - a[0]);
  for (const [, p] of candidates.slice(0, 20)) {
    try {
      const real = realPath(p);
      if (!real.startsWith(realRoot + path.sep)) continue;
      const fd = fs.openSync(real, 'r');
      const b = Buffer.alloc(16384);
      const n = fs.readSync(fd, b, 0, b.length, 0);
      fs.closeSync(fd);
      const first = b.slice(0, n).toString('utf8').split('\n')[0];
      const j = JSON.parse(first);
      const meta = j.payload?.meta || j.payload || j;
      const c = meta.cwd;
      if (typeof c === 'string') {
        let rc = c;
        try {
          rc = realPath(c);
        } catch {}
        if (rc === realCwd) return real;
      }
    } catch {}
  }
  return null;
}

/** Public, size-limited view for the state broadcast. The full feed is fetched on demand. */
export function activityView(a) {
  if (!a) return { plan: [], subagents: [], current: '', feedTail: [] };
  return {
    plan: a.plan.slice(0, 30),
    subagents: a.subagents.slice(-12).map((s) => ({ id: s.id, type: s.type, desc: s.desc, status: s.status, last: s.last, tools: s.tools, startedAt: s.startedAt, endedAt: s.endedAt, plan: s.plan.slice(0, 12) })),
    current: a.current,
    feedTail: a.feed.slice(-5),
  };
}
