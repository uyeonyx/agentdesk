// What a Claude session's transcript says about the session itself, for every task at once:
// its permission mode, its model and how full its context is, and the recap Claude Code writes
// when the person has been away. The conversation view (convo.js) parses everything, but only
// for the tasks windows look at; this reads just these few lines, for all of them.
import fs from 'node:fs';
import { claudeTranscriptOf } from './sessions.js';

const BACK = 1024 * 1024; // read back this much on open, for the latest values
const STEP = 512 * 1024; // at most this much per poll
const TEXT_MAX = 600;
// A line can only matter if it holds one of these; the rest aren't parsed at all.
const HINT = /"permission-mode"|"away_summary"|"usage"|"compact_boundary"/;

export const MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

/** Context window of a model id, in tokens. Long-context variants say so in the id. */
export function windowOf(model, used = 0) {
  if (/\[1m\]|-1m\b/i.test(model || '') || used > 200_000) return 1_000_000;
  return 200_000;
}

/** Tokens the last request sent: what the context holds now. */
export function tokensOf(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const n = (k) => (Number.isFinite(usage[k]) ? usage[k] : 0);
  return n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens');
}

/**
 * Read one transcript line. Returns a patch of { mode, model, ctx, recap } (only what it says), or null.
 * @param {object} j
 */
export function metaOfLine(j) {
  if (!j || typeof j !== 'object' || j.isSidechain) return null;
  if (j.type === 'permission-mode' && MODES.includes(j.permissionMode)) return { mode: j.permissionMode };
  if (j.type === 'system' && j.subtype === 'away_summary' && typeof j.content === 'string') {
    const text = j.content.replace(/\s*\(disable recaps in \/config\)\s*$/i, '').trim().slice(0, TEXT_MAX);
    return text ? { recap: { text, at: Date.parse(j.timestamp) || Date.now() } } : null;
  }
  if (j.type === 'system' && j.subtype === 'compact_boundary') return { compacted: Date.parse(j.timestamp) || Date.now() };
  if (j.type === 'assistant' && j.message && typeof j.message === 'object') {
    const used = tokensOf(j.message.usage);
    const model = typeof j.message.model === 'string' && !j.message.model.startsWith('<') ? j.message.model : '';
    if (!used && !model) return null;
    const out = {};
    if (model) out.model = model;
    if (used) out.ctx = { used, limit: windowOf(model, used) };
    return out;
  }
  return null;
}

/** Fold patches in order: later lines win; a recap is kept only if it's newer. */
export function fold(cur, patch) {
  if (!patch) return cur;
  const next = { ...cur };
  if (patch.mode) next.mode = patch.mode;
  if (patch.model) next.model = patch.model;
  if (patch.ctx) next.ctx = { ...patch.ctx, limit: Math.max(patch.ctx.limit, windowOf(patch.model || next.model, patch.ctx.used)) };
  // Right after a compaction the old count is wrong until the next answer: say we don't know.
  if (patch.compacted) next.ctx = next.ctx ? { ...next.ctx, used: 0, stale: true } : next.ctx;
  if (patch.recap && (!cur.recap || patch.recap.at >= cur.recap.at)) next.recap = patch.recap;
  return next;
}

/** Follows one task's transcript. `poll()` returns true when something visible changed. */
export class MetaTail {
  constructor(task) {
    this.task = task;
    this.path = null;
    this.off = 0;
    this.buf = '';
    this.skip = false;
  }

  locate() {
    const t = this.task;
    if (t.agent !== 'claude') return null;
    if (t.transcriptPath && fs.existsSync(t.transcriptPath)) return t.transcriptPath;
    return claudeTranscriptOf(t.watch?.sessionId || t.sessionId) || null;
  }

  poll() {
    const p = this.locate();
    if (!p) return false;
    if (p !== this.path) {
      // A new session file (/clear, a fork, a resume): start from its tail.
      this.path = p;
      this.buf = '';
      let size = 0;
      try {
        size = fs.statSync(p).size;
      } catch {
        return false;
      }
      this.off = Math.max(0, size - BACK);
      this.skip = this.off > 0;
    }
    let size;
    try {
      size = fs.statSync(p).size;
    } catch {
      return false;
    }
    if (size < this.off) {
      this.off = 0;
      this.buf = '';
      this.skip = false;
    }
    if (size === this.off) return false;
    const len = Math.min(size - this.off, STEP);
    const b = Buffer.alloc(len);
    const fd = fs.openSync(p, 'r');
    try {
      fs.readSync(fd, b, 0, len, this.off);
    } finally {
      fs.closeSync(fd);
    }
    this.off += len;
    const lines = (this.buf + b.toString('utf8')).split('\n');
    this.buf = lines.pop() || '';
    if (this.buf.length > STEP) this.buf = ''; // a line this long holds nothing we read
    const before = JSON.stringify(pick(this.task));
    let cur = pick(this.task);
    for (const line of lines) {
      if (this.skip) {
        this.skip = false;
        continue;
      }
      if (!HINT.test(line)) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      cur = fold(cur, metaOfLine(j));
    }
    Object.assign(this.task, cur);
    return JSON.stringify(cur) !== before;
  }
}

const pick = (t) => ({ mode: t.mode, model: t.model, ctx: t.ctx, recap: t.recap });
