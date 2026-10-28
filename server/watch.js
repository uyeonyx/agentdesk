// Follow a session that runs somewhere else (VS Code, another terminal, background) without
// touching it: read its transcript as it grows and its status from Claude Code's session list.
import fs from 'node:fs';
import { liveStatus, claudeTranscriptOf } from './sessions.js';

const MAX_BACKLOG = 2_000_000;
const ENTRIES = 300;

const clip = (s, n) => {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const isNoise = (t) => !t || /^\s*</.test(t) || /^\s*\[Request interrupted/.test(t) || /^Caveat:/.test(t);
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x && (x.type === 'text' || x.type === 'input_text')).map((x) => x.text).join('\n') : '');

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export class Watcher {
  /**
   * @param {object} task  the task (task.watch = { agent, sessionId, pid, file? })
   * @param {object} hooks { tracker, onPrompt(text, at), onStatus(status, live), onReply(text) }
   */
  constructor(task, hooks) {
    this.task = task;
    this.h = hooks;
    this.file = null;
    this.offset = 0;
    this.buf = '';
    this.entries = [];
    this.tools = new Map(); // tool_use_id -> { name, input }
    this.status = null;
    this.first = true;
  }

  async poll() {
    const w = this.task.watch;
    if (!w) return;
    // Transcript first, so "went idle" is reported with the reply that ended the turn.
    this.read();
    if (w.agent === 'claude') await this.claudeStatus();
  }

  async claudeStatus() {
    const w = this.task.watch;
    // Follow the process: /clear in that session starts a new conversation id.
    const l = await liveStatus(w.sessionId, w.pid, this.task.cwd);
    if (l && l.sessionId !== w.sessionId) {
      w.sessionId = l.sessionId;
      this.task.sessionId = l.sessionId;
      this.file = null;
      this.offset = 0;
    }
    let status = l ? (/busy|run|work/i.test(l.status) ? 'busy' : /wait|perm|input|block/i.test(l.status) ? 'waiting' : 'idle') : 'gone';
    // "Gone" must be certain before anything acts on it: two readings in a row and a dead process.
    if (status === 'gone') {
      this.goneReads = (this.goneReads || 0) + 1;
      if (this.goneReads < 2 || (w.pid && pidAlive(w.pid))) status = this.status || 'busy';
    } else this.goneReads = 0;
    if (l) {
      w.pid = l.pid;
      w.where = l.where || w.where;
    }
    if (status !== this.status) {
      const prev = this.status;
      this.status = status;
      this.h.onStatus(status, prev);
    }
  }

  read() {
    const w = this.task.watch;
    if (!this.file) {
      this.file = w.agent === 'claude' ? claudeTranscriptOf(w.sessionId) : w.file && fs.existsSync(w.file) ? w.file : null;
      if (!this.file) return;
      try {
        const size = fs.statSync(this.file).size;
        this.offset = Math.max(0, size - MAX_BACKLOG);
        this.skipPartial = this.offset > 0;
      } catch {
        this.file = null;
        return;
      }
    }
    let st;
    try {
      st = fs.statSync(this.file);
    } catch {
      return;
    }
    if (w.agent === 'codex') {
      const status = Date.now() - st.mtimeMs < 15000 ? 'busy' : 'idle';
      if (status !== this.status) {
        const prev = this.status;
        this.status = status;
        this.h.onStatus(status, prev);
      }
    }
    if (st.size <= this.offset) return;
    const len = Math.min(st.size - this.offset, MAX_BACKLOG);
    const b = Buffer.alloc(len);
    const fd = fs.openSync(this.file, 'r');
    fs.readSync(fd, b, 0, len, this.offset);
    fs.closeSync(fd);
    this.offset += len;
    this.buf += b.toString('utf8');
    const lines = this.buf.split('\n');
    this.buf = lines.pop() || '';
    if (this.skipPartial) {
      lines.shift();
      this.skipPartial = false;
    }
    const backlog = this.first;
    this.first = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      // A session with Remote Control on records its claude.ai link in a system entry. Only those
      // count (never user, tool or assistant content, which anything the agent reads can shape),
      // and the first one sticks.
      if (!this.task.remoteUrl && j.type === 'system') {
        const url = line.match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+(?![A-Za-z0-9_\-/?=&.%])/);
        if (url) {
          this.task.remoteUrl = url[0];
          this.h.onLink?.();
        }
      }
      if (w.agent === 'claude') this.claudeLine(j, backlog);
      else this.codexLine(j, backlog);
    }
  }

  push(e) {
    this.entries.push(e);
    if (this.entries.length > ENTRIES) this.entries.splice(0, this.entries.length - ENTRIES);
  }

  claudeLine(j, backlog) {
    if (j.isSidechain) return;
    const at = Date.parse(j.timestamp) || Date.now();
    const tr = this.h.tracker;
    if (j.type === 'user' && !j.isMeta && !j.isCompactSummary && !j.isVisibleInTranscriptOnly) {
      const c = j.message?.content;
      if (Array.isArray(c) && c.some((x) => x?.type === 'tool_result')) {
        for (const r of c.filter((x) => x?.type === 'tool_result')) {
          const t = this.tools.get(r.tool_use_id);
          if (!t) continue;
          this.tools.delete(r.tool_use_id);
          const ev = r.is_error ? 'PostToolUseFailure' : 'PostToolUse';
          if (t.name === 'Agent' || t.name === 'Task') tr.claude({ hook_event_name: 'SubagentStop', agent_id: r.tool_use_id, agent_type: t.input?.subagent_type || 'agent', last_assistant_message: clip(textOf(r.content), 200) });
          tr.claude({ hook_event_name: ev, tool_name: t.name, tool_input: t.input, tool_use_id: r.tool_use_id, tool_response: { is_error: !!r.is_error } });
          const e = this.entries.find((x) => x.id === r.tool_use_id);
          if (e) e.st = r.is_error ? 'err' : 'ok';
        }
        return;
      }
      const text = textOf(c);
      if (isNoise(text)) return;
      this.push({ id: j.uuid || String(at), role: 'user', text: clip(text, 4000), at });
      this.h.onPrompt(text, at, backlog);
      return;
    }
    if (j.type === 'assistant') {
      for (const x of j.message?.content || []) {
        if (x.type === 'text' && x.text?.trim()) {
          this.push({ id: (j.uuid || '') + ':t', role: 'assistant', text: clip(x.text, 6000), at });
          this.h.onReply(x.text);
        } else if (x.type === 'tool_use') {
          this.tools.set(x.id, { name: x.name, input: x.input || {} });
          tr.claude({ hook_event_name: 'PreToolUse', tool_name: x.name, tool_input: x.input || {}, tool_use_id: x.id });
          if (x.name === 'Agent' || x.name === 'Task') tr.claude({ hook_event_name: 'SubagentStart', agent_id: x.id, agent_type: x.input?.subagent_type || 'agent' });
          const last = tr.a.feed[tr.a.feed.length - 1];
          this.push({ id: x.id, role: 'tool', text: last?.id === x.id ? last.text : x.name, kind: last?.kind || 'tool', at, st: 'run' });
        }
      }
    }
  }

  codexLine(j, backlog) {
    const p = j.payload || {};
    const at = Date.parse(j.timestamp) || Date.now();
    this.h.tracker.codexLine(JSON.stringify(j));
    if (j.type === 'event_msg' && p.type === 'user_message' && !isNoise(p.message)) {
      this.push({ id: `u${at}${this.entries.length}`, role: 'user', text: clip(p.message, 4000), at });
      this.h.onPrompt(p.message, at, backlog);
    } else if (j.type === 'event_msg' && p.type === 'agent_message' && p.message) {
      this.push({ id: `a${at}${this.entries.length}`, role: 'assistant', text: clip(p.message, 6000), at });
      this.h.onReply(p.message);
    } else if (j.type === 'response_item' && (p.type === 'function_call' || p.type === 'custom_tool_call')) {
      const last = this.h.tracker.a.feed[this.h.tracker.a.feed.length - 1];
      this.push({ id: String(p.call_id), role: 'tool', text: last?.text || p.name, kind: last?.kind || 'tool', at, st: 'run' });
    } else if (j.type === 'response_item' && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')) {
      const e = this.entries.find((x) => x.id === String(p.call_id));
      if (e) e.st = 'ok';
    }
  }
}
