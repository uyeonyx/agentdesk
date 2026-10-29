// Transcript → conversation. Turns Claude Code transcript lines (JSONL) and Codex rollout lines
// into the entries the conversation view renders: prompts, markdown replies, tool calls with
// their real details, subagents nested under the call that started them, plans and questions.
//
// Pure and incremental: feed parsed lines in file order, get ops back. Ids come from the
// transcript itself (uuid, tool_use id, call_id, item id) or from the line's byte offset, so a
// line gets the same id whichever window or chunking it was read in. Every string is sanitized
// and clipped to the caps given. A tool entry's `src` points at the lines it came from: feeding
// those lines into a fresh parser with FULL_CAPS gives the same entry with full details.
// Everything here is display data; nothing in it is ever executed.
import os from 'node:os';
import path from 'node:path';
import { capHunks, diffLines, hunksFromStructured, parseApplyPatch, parseUnifiedDiff, stats } from './diff.js';

export const PREVIEW_CAPS = Object.freeze({ outLines: 40, outBytes: 8 * 1024, diffLines: 120, lineChars: 500, md: 60 * 1024, text: 20 * 1024, json: 4 * 1024, items: 20 });
export const FULL_CAPS = Object.freeze({ outLines: 2000, outBytes: 200 * 1024, diffLines: 2000, lineChars: 8 * 1024, md: 2 * 1024 * 1024, text: 2 * 1024 * 1024, json: 256 * 1024, items: 1000 });

const ORPHANS_MAX = 500;
const TOOLS_MAX = 3000;
const RECENT_MAX = 50;

// ---------------------------------------------------------------- text

// Terminal escapes: CSI (colors, cursor), OSC (titles, links), DCS/PM/APC and two-byte ESC
// sequences. OSC and DCS stop at the end of their line, so a stray one can't eat the rest.
const ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b\n]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b\n]*(?:\x1b\\)?|\x1b[@-Z\\-_]|\x9b[0-?]*[ -\/]*[@-~]/g;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/** Display-safe text: no terminal escapes or control characters (\n and \t stay), at most n units. */
export function sanitize(s, n) {
  let t = typeof s === 'string' ? s : s == null ? '' : String(s);
  if (!t) return '';
  // Escapes only ever shrink the text, but not by much: bound the work on huge inputs.
  if (n && t.length > n * 8 + 4096) t = t.slice(0, n * 8 + 4096);
  t = t.replace(ANSI, '');
  // A carriage return redraws its line (progress bars): keep what was drawn last.
  if (t.includes('\r')) t = t.replace(/\r\n/g, '\n').split('\n').map((l) => (l.includes('\r') ? l.split('\r').filter(Boolean).pop() || '' : l)).join('\n');
  t = t.replace(CONTROL, '');
  if (!n || t.length <= n) return t;
  let k = Math.max(0, n - 1);
  const c = t.charCodeAt(k - 1);
  if (c >= 0xd800 && c <= 0xdbff) k--; // never split a surrogate pair
  return t.slice(0, k) + '…';
}

/** One line, whitespace collapsed (the activity feed's clip). */
const clip = (s, n = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const int = (n) => (Number.isFinite(n) ? Math.trunc(n) : null);

/** Text of a message's content: a string, or the text of its blocks (images marked). */
function textOf(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  let out = '';
  for (const b of c) {
    if (!b || typeof b !== 'object') continue;
    const t = typeof b.text === 'string' ? b.text : /image/.test(String(b.type)) ? '[이미지]' : b.type === 'document' ? '[문서]' : null;
    if (t == null) continue;
    out += out && !out.endsWith('\n') ? '\n' + t : t;
  }
  return out;
}

const lineCount = (t) => {
  let n = 1;
  for (let k = t.indexOf('\n'); k >= 0; k = t.indexOf('\n', k + 1)) n++;
  return n;
};

/** The last lines of a command's output, within caps; outLines counts all of them. */
function tailText(s, caps) {
  const t = typeof s === 'string' ? s.replace(/\s+$/, '') : '';
  if (!t) return { out: '', outLines: 0 };
  let cut = t.length;
  for (let n = 0; n < caps.outLines; n++) {
    const k = t.lastIndexOf('\n', cut - 1);
    if (k < 0) {
      cut = -1;
      break;
    }
    cut = k;
  }
  let keep = cut < 0 ? t : t.slice(cut + 1);
  let cutMid = false;
  if (keep.length * 3 > caps.outBytes && Buffer.byteLength(keep) > caps.outBytes) {
    keep = Buffer.from(keep).subarray(-caps.outBytes).toString('utf8').replace(/^�+/, '');
    cutMid = true;
  }
  return { out: (cutMid ? '…' : '') + sanitize(keep), outLines: lineCount(t) };
}

/** The first lines of a result, within caps. */
function headText(s, caps) {
  const t = typeof s === 'string' ? s.replace(/\s+$/, '') : '';
  if (!t) return { out: '', outLines: 0 };
  let cut = -1;
  for (let n = 0; n < caps.outLines; n++) {
    cut = t.indexOf('\n', cut + 1);
    if (cut < 0) break;
  }
  let keep = cut < 0 ? t : t.slice(0, cut);
  let cutMid = false;
  if (keep.length * 3 > caps.outBytes && Buffer.byteLength(keep) > caps.outBytes) {
    keep = Buffer.from(keep).subarray(0, caps.outBytes).toString('utf8').replace(/�+$/, '');
    cutMid = true;
  }
  return { out: sanitize(keep) + (cutMid ? '…' : ''), outLines: lineCount(t) };
}

/** Pretty JSON for display, with blobs (base64, data URLs) and very long strings cut down first. */
function pretty(v, n) {
  if (v == null || v === '') return '';
  let s;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(slim(v, 0), null, 2);
  } catch {
    s = String(v);
  }
  return sanitize(s, n);
}

function slim(v, depth) {
  if (typeof v === 'string') {
    if (v.length <= 2000) return v;
    if (/^data:[^,]{0,100};base64,/.test(v)) return '[이미지]';
    if (/^[A-Za-z0-9+/=_-]{200}/.test(v)) return `[데이터 ${v.length}자]`;
    return v.slice(0, 2000) + '…';
  }
  if (Array.isArray(v)) return depth > 8 ? '[…]' : v.slice(0, 200).map((x) => slim(x, depth + 1));
  if (v && typeof v === 'object') {
    if (depth > 8) return '{…}';
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 200)) o[k] = slim(x, depth + 1);
    return o;
  }
  return v;
}

// ---------------------------------------------------------------- tool names (as in activity.js)

/** Normalize a plan item's status into: pending | active | done. */
function planStatus(s) {
  s = String(s || '').toLowerCase();
  if (/complete|done|finish/.test(s)) return 'done';
  if (/progress|active|running|doing/.test(s)) return 'active';
  return 'pending';
}

export function relTo(cwd, p) {
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
    case 'AskUserQuestion':
      return { kind: 'ask', text: '질문하기' };
    case 'ExitPlanMode':
      return { kind: 'plan', text: '계획 승인 요청' };
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

/** mcp__server__tool (Claude) or server__tool / server.tool (Codex). */
function mcpName(name) {
  const n = String(name || '').replace(/^mcp__/, '');
  const k = n.indexOf('__');
  if (k > 0) return { server: n.slice(0, k), tool: n.slice(k + 2) };
  const d = n.indexOf('.');
  if (d > 0) return { server: n.slice(0, d), tool: n.slice(d + 1) };
  return { server: '', tool: n };
}

function claudeCat(name) {
  switch (name) {
    case 'Bash':
      return 'cmd';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit';
    case 'Read':
      return 'read';
    case 'Grep':
    case 'Glob':
      return 'search';
    case 'WebFetch':
    case 'WebSearch':
      return 'web';
    case 'Agent':
    case 'Task':
      return 'agent';
    case 'AskUserQuestion':
      return 'ask';
    case 'ExitPlanMode':
      return 'plan';
    case 'TodoWrite':
      return 'todo';
    default:
      return name.startsWith('mcp__') ? 'mcp' : 'tool';
  }
}

function codexCat(name) {
  if (/^(shell|local_shell|exec_command|shell_command|unified_exec|container\.exec)$/.test(name)) return 'cmd';
  if (name === 'apply_patch') return 'edit';
  if (name === 'update_plan') return 'todo';
  if (name === 'spawn_agent') return 'agent';
  if (name === 'web_search') return 'web';
  if (name.includes('__') || name.includes('.')) return 'mcp';
  return 'tool';
}

const kindOf = (cat) => (cat === 'agent' ? 'agent' : cat === 'todo' ? 'todo' : 'tool');

/** A command line from Claude's `command`, or Codex's argv / `cmd`. */
function commandOf(i) {
  if (typeof i === 'string') return i;
  if (!i || typeof i !== 'object') return '';
  const c = i.command ?? i.cmd ?? '';
  return Array.isArray(c) ? unshell(c) : String(c);
}

/** ['bash', '-lc', script] is how Codex wraps a command line: show the script. */
function unshell(argv) {
  const a = argv.map(String);
  if (a.length === 3 && /(^|[/\\])(ba|z|da|k|fi)?sh(\.exe)?$/.test(a[0]) && /^-l?c$/.test(a[1])) return a[2];
  if (a.length === 3 && /(^|[/\\])(pwsh|powershell)(\.exe)?$/i.test(a[0]) && /^-(c|command)$/i.test(a[1])) return a[2];
  return a.join(' ');
}

/**
 * Exit code, duration and output out of a tool result's text: Claude Code's "Exit code N\n…",
 * older Codex's {"output", "metadata": {"exit_code", "duration_seconds"}} and newer Codex's
 * header lines ("Exit code: N", "Process exited with code N", "Wall time: …") before "Output:".
 */
function parseOutput(text) {
  let out = typeof text === 'string' ? text : '';
  let exit = null;
  let ms = null;
  let failed = false;
  if (out[0] === '{' && out.includes('"output"')) {
    try {
      const o = JSON.parse(out);
      if (o && typeof o.output === 'string') {
        out = o.output;
        exit = int(o.metadata?.exit_code);
        if (Number.isFinite(o.metadata?.duration_seconds)) ms = Math.round(o.metadata.duration_seconds * 1000);
      }
    } catch {}
  }
  let m;
  if ((m = out.match(/^(?:Error: )?Exit code (-?\d+)(?:\n|$)/))) {
    exit = +m[1];
    out = out.slice(m[0].length);
  } else {
    const k = out.startsWith('Output:\n') ? 0 : out.indexOf('\nOutput:\n');
    const head = k > 0 ? out.slice(0, k) : '';
    if (k === 0 || (k > 0 && k < 1000 && /^(Exit code|Chunk ID|Wall time|Process|Script|Original token|Total output)/m.test(head))) {
      if ((m = head.match(/Exit code:? (-?\d+)|Process exited with code (-?\d+)/))) exit = +(m[1] ?? m[2]);
      if ((m = head.match(/Wall time:? ([\d.]+) ?s/))) ms = Math.round(+m[1] * 1000);
      failed = /^Script (failed|error)/im.test(head);
      out = out.slice(k === 0 ? 8 : k + 9);
    }
  }
  return { out, exit, ms, failed };
}

// ---------------------------------------------------------------- details

/**
 * What a tool card shows, by category. Pure: the parser calls it with PREVIEW_CAPS as calls and
 * results arrive; a full view calls it again (or re-parses the src lines) with FULL_CAPS.
 * `tool` (the tool's name) is optional; MCP cards take their server and tool names from it.
 */
export function detailOf(cat, input, resultText, toolUseResult, caps = PREVIEW_CAPS, tool = '') {
  const i = input && typeof input === 'object' ? input : {};
  const r = toolUseResult && typeof toolUseResult === 'object' && !Array.isArray(toolUseResult) ? toolUseResult : null;
  let text = typeof resultText === 'string' ? resultText : '';
  // MCP results come as a string or content blocks, in the tool_result and again here.
  if (!text && typeof toolUseResult === 'string') text = toolUseResult;
  if (!text && Array.isArray(toolUseResult)) text = textOf(toolUseResult);
  switch (cat) {
    case 'cmd':
      return cmdDetail(input, text, r, caps);
    case 'edit':
      return editDetail(input, r, caps);
    case 'read':
      return readDetail(i, r);
    case 'search':
      return searchDetail(i, text, r, caps);
    case 'web':
      return webDetail(i, text, r, caps);
    case 'mcp': {
      const { server, tool: t } = mcpName(tool);
      return { server: sanitize(server, 200), tool: sanitize(t, 200), input: pretty(input, caps.json), ...headText(text, caps) };
    }
    case 'agent':
      return agentDetail(i, text, r, caps);
    case 'ask':
      return askDetail(i, r);
    case 'plan':
      return { plan: sanitize(String(r?.plan ?? i.plan ?? '').trim(), caps.md) };
    case 'todo':
      return { items: todoItems(i) };
    case 'code':
      return codeDetail(input, text, caps);
    default:
      return { input: pretty(input, caps.json), ...headText(text, caps) };
  }
}

function cmdDetail(input, text, r, caps) {
  const i = input && typeof input === 'object' ? input : {};
  let raw;
  let exit = null;
  if (r && (typeof r.stdout === 'string' || typeof r.stderr === 'string')) {
    // Claude Code keeps no exit code for a command that succeeded.
    raw = [r.stdout, r.stderr].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.replace(/\s+$/, '')).join('\n');
  } else if (r && typeof r.aggregated_output === 'string') {
    raw = r.aggregated_output; // a Codex CommandExecution item
    exit = int(r.exit_code);
  } else ({ out: raw, exit } = parseOutput(text));
  const d = {
    command: sanitize(commandOf(input), caps.text),
    desc: sanitize(i.description ?? i.justification ?? '', 500),
    ...tailText(raw, caps),
    exit,
    bg: r?.backgroundTaskId ? sanitize(String(r.backgroundTaskId), 100) : '',
  };
  if (typeof r?.returnCodeInterpretation === 'string') d.note = sanitize(r.returnCodeInterpretation, 300);
  // Files the command changed (sed -i, a formatter): Claude Code diffs them for us.
  const changed = r?.bashEditDiff?.files;
  if (Array.isArray(changed) && changed.length) d.edits = filesOut(changed.map((f) => ({ path: String(f?.filePath ?? ''), op: 'edit', hunks: hunksFromStructured(f?.hunks) })), caps).files;
  return d;
}

const isPatch = (s) => typeof s === 'string' && /^\*\*\* (Begin Patch|Update File:|Add File:|Delete File:)/m.test(s);

function editDetail(input, r, caps) {
  const i = input && typeof input === 'object' ? input : {};
  const patch = [input, i.input, i.patch, commandOf(i)].find(isPatch);
  let files;
  if (patch) files = parseApplyPatch(patch);
  else if (i.changes && typeof i.changes === 'object') files = changesOf(i.changes);
  else {
    const p = String(i.file_path ?? i.notebook_path ?? r?.filePath ?? '');
    const sp = Array.isArray(r?.structuredPatch) ? r.structuredPatch : null;
    if (sp && (sp.length || r.type === 'update' || typeof r.oldString === 'string')) files = [{ path: p, op: r.type === 'create' ? 'create' : 'edit', hunks: hunksFromStructured(sp) }];
    else if (Array.isArray(i.edits)) files = [{ path: p, op: 'edit', hunks: i.edits.flatMap((x) => snippet(x?.old_string, x?.new_string, null)) }];
    else if (typeof i.old_string === 'string' || typeof i.new_string === 'string') files = [{ path: p, op: 'edit', hunks: snippet(i.old_string, i.new_string, r?.originalFile) }];
    else if (typeof i.new_source === 'string') files = [{ path: p, op: 'edit', hunks: addAll(i.new_source, null) }];
    else {
      // Write: a new file (or, before its result is in, the content it is about to get) reads as all additions.
      const content = typeof r?.content === 'string' ? r.content : typeof i.content === 'string' ? i.content : '';
      files = [{ path: p, op: 'create', hunks: addAll(content, 1) }];
    }
  }
  return filesOut(files, caps);
}

/** An Edit's old/new strings, numbered by where they sit in the original file when that is known. */
function snippet(a, b, original) {
  const hunks = diffLines(a ?? '', b ?? '');
  const k = typeof original === 'string' && a ? original.indexOf(a) : -1;
  const base = k >= 0 ? lineCount(original.slice(0, k)) - 1 : null;
  return hunks.map((h) => ({ a: base == null ? null : h.a + base, b: base == null ? null : h.b + base, lines: h.lines }));
}

function addAll(content, start) {
  if (!content) return [];
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return [{ a: start == null ? null : 0, b: start, lines: lines.map((l) => '+' + l) }];
}

/** Codex file changes: [{ path, kind, diff }] items or a { path: { add | delete | update } } map. */
function changesOf(changes) {
  const list = Array.isArray(changes) ? changes : Object.entries(changes).map(([p, c]) => ({ path: p, ...(c && typeof c === 'object' ? c : {}) }));
  return list
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const kind = String(c.kind?.type ?? c.kind ?? c.type ?? (c.add ? 'add' : c.delete ? 'delete' : 'update'));
      const body = (c.add ?? c.delete ?? c.update ?? c) || {};
      const diff = body.unified_diff ?? body.diff;
      const move = body.move_path ?? c.kind?.move_path ?? c.move_path ?? null;
      const op = /add|create/.test(kind) ? 'create' : /delete|remove/.test(kind) ? 'delete' : move ? 'move' : 'edit';
      const hunks = typeof diff === 'string' ? parseUnifiedDiff(diff) : op === 'create' && typeof body.content === 'string' ? addAll(body.content, 1) : [];
      return move ? { path: String(c.path ?? ''), op, to: String(move), hunks } : { path: String(c.path ?? ''), op, hunks };
    });
}

/** Files with their counts; hunk lines capped across all files, each line sanitized and clipped. */
function filesOut(files, caps) {
  let left = caps.diffLines;
  let clipped = false;
  const out = files.map((f) => {
    const { adds, dels } = stats(f.hunks);
    const cap = capHunks(f.hunks, Math.max(0, left));
    for (const h of cap.hunks) left -= h.lines.length;
    if (cap.clipped) clipped = true;
    const o = { path: sanitize(f.path, 1000), op: f.op, adds, dels, hunks: cap.hunks.map((h) => ({ a: h.a, b: h.b, lines: h.lines.map((l) => l[0] + sanitize(l.slice(1), caps.lineChars)) })) };
    if (f.to) o.to = sanitize(f.to, 1000);
    return o;
  });
  return { files: out, clipped };
}

function readDetail(i, r) {
  const f = r?.file && typeof r.file === 'object' ? r.file : null;
  const from = int(f?.startLine) ?? int(i.offset);
  const n = int(f?.numLines) ?? int(i.limit);
  const d = { path: sanitize(String(i.file_path ?? f?.filePath ?? ''), 1000), from, to: from != null && n != null ? from + Math.max(0, n - 1) : null, total: int(f?.totalLines) };
  if (r?.type === 'image') d.image = true;
  return d;
}

function searchDetail(i, text, r, caps) {
  const files = Array.isArray(r?.filenames) ? r.filenames : [];
  let count = null;
  if (r) count = r.mode === 'content' ? int(r.numLines) : r.mode === 'count' ? (int(r.numMatches) ?? int(r.numFiles)) : (int(r.numFiles) ?? (files.length || null));
  if (count == null && text) {
    const m = text.match(/^Found (\d+)/);
    if (m) count = +m[1];
    else if (/^No (files|matches) found/.test(text)) count = 0;
  }
  return { pattern: sanitize(String(i.pattern ?? i.query ?? ''), 1000), path: sanitize(String(i.path ?? ''), 1000), count, files: files.slice(0, caps.items).map((f) => sanitize(String(f), 1000)) };
}

function webDetail(i, text, r, caps) {
  if (i.url != null || r?.url != null) {
    const url = String(i.url ?? r.url);
    return { url: sanitize(url, 2000), host: sanitize(safeHost(url), 300), code: int(r?.code), ...headText(typeof r?.result === 'string' ? r.result : text, caps) };
  }
  // WebSearch results: [{ tool_use_id, content: [{ title, url }] } | "summary text"]
  const hits = Array.isArray(r?.results) ? r.results.flatMap((x) => (Array.isArray(x?.content) ? x.content : [])).filter((x) => typeof x?.url === 'string') : [];
  return { query: sanitize(String(i.query ?? r?.query ?? i.action?.query ?? ''), 1000), host: '', code: null, results: hits.slice(0, caps.items).map((x) => ({ title: sanitize(x.title ?? '', 300), url: sanitize(x.url, 2000) })) };
}

function agentDetail(i, text, r, caps) {
  // Started in the background: the tool result only says so; the real one comes in a task notification.
  const launched = r?.status === 'async_launched';
  let result = launched ? '' : (Array.isArray(r?.content) && textOf(r.content)) || text;
  let agentId = typeof r?.agentId === 'string' ? r.agentId : '';
  // Codex's spawn_agent answers with JSON that names the agent.
  if (!r && text[0] === '{') {
    try {
      const o = JSON.parse(text);
      agentId = String(o.agent_id ?? o.id ?? '');
      result = '';
    } catch {}
  }
  const d = {
    desc: sanitize(i.description ?? i.task_name ?? clip(i.message ?? i.prompt ?? '', 120), 300),
    type: sanitize(String(i.subagent_type ?? i.agent_type ?? ''), 100),
    result: sanitize(String(result).trim(), caps.md),
    agentId: sanitize(agentId, 100),
  };
  if (launched) d.bg = true;
  return d;
}

function askDetail(i, r) {
  const qs = Array.isArray(i.questions) ? i.questions : Array.isArray(r?.questions) ? r.questions : [];
  const questions = qs.slice(0, 20).map((q) => ({
    header: sanitize(q?.header ?? '', 100),
    question: sanitize(q?.question ?? '', 2000),
    multi: q?.multiSelect === true,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 20).map((o) => ({ label: sanitize(o?.label ?? '', 300), desc: sanitize(o?.description ?? '', 1000) })),
  }));
  const answers = {};
  if (r?.answers && typeof r.answers === 'object') {
    for (const [q, a] of Object.entries(r.answers).slice(0, 50)) answers[sanitize(q, 2000)] = sanitize(Array.isArray(a) ? a.join(', ') : String(a ?? ''), 2000);
  }
  return { questions, answers };
}

function todoItems(i) {
  const list = Array.isArray(i.todos) ? i.todos : Array.isArray(i.plan) ? i.plan : [];
  return list.slice(0, 100).map((t) => ({ text: sanitize(String(t?.content ?? t?.step ?? t?.text ?? t?.activeForm ?? ''), 500), status: planStatus(t?.status) }));
}

function codeDetail(input, text, caps) {
  const code = typeof input === 'string' ? input : String(input?.code ?? input?.input ?? '');
  let { out, exit } = parseOutput(text);
  // exec_command answers inside the script with JSON: show its output.
  if (out.trimStart()[0] === '{') {
    try {
      const o = JSON.parse(out.trim());
      if (typeof o?.output === 'string') {
        out = o.output;
        exit = int(o.exit_code) ?? exit;
      }
    } catch {}
  }
  return { code: sanitize(code, caps.text), ...tailText(out, caps), exit };
}

// ---------------------------------------------------------------- parser

// Tool results that mean "not allowed" rather than "failed".
const DENIED = /^(?:Error: )?(?:The user doesn't want to (?:proceed|take this action)|User rejected tool use|Permission\b[^\n]*\bdenied)/;
const STOPPED = /^(?:Error: )?\[(?:Request|Tool call) interrupted/;

/**
 * @param {{ agent?: 'claude'|'codex', cwd?: string, parent?: string|null, caps?: object }} o
 *   parent: for a subagent's own transcript, the id of the parent's Agent call; every entry
 *   gets it, and the subagent's prompt (already on the parent's card) is skipped.
 * @returns {{ line(j: object, src?: {seg:number, off:number, len:number}): object[], state: object }}
 */
export function createParser({ agent = 'claude', cwd = '', parent = null, caps = PREVIEW_CAPS } = {}) {
  // tools: id -> { e (last emitted entry), input, bg }. orphans: results seen before their call.
  const state = { turn: 0, sessionId: null, tools: new Map(), orphans: new Map() };
  let seq = 0;
  let compact = null; // the newest entry, while it is a compact one: its summary comes next
  let promptSeen = !parent; // a subagent's transcript opens with its prompt
  const legacyPrompted = new Set(); // old in-file subagents whose prompt was skipped
  let wrapper = null; // Codex: the open `exec` call, { id, kids }
  const merged = new Set(); // Codex: items that took over their script's card (and so have no id of their own)
  let turnOpen = false; // Codex: task_started seen, its prompt not yet
  const recent = new Set(); // Codex: texts shown this turn, against the copies some versions write

  const lineId = (j, src, i) => (j.uuid ? `${j.uuid}:${i}` : `${offId(src)}:${i}`);
  const offId = (src) => (Number.isFinite(src?.off) ? `o${src.off}` : `n${seq++}`);
  const timeOf = (j) => Date.parse(j.timestamp) || 0;

  function emit(ops, e) {
    ops.push({ op: 'add', e });
    compact = e.kind === 'compact' ? e : null;
  }

  function entry(id, kind, at, p, fields) {
    return { id, turn: state.turn, parent: p, at, kind, ...fields };
  }

  function remember(e, input) {
    const rec = { e, input, bg: false };
    state.tools.set(e.id, rec);
    if (state.tools.size > TOOLS_MAX) {
      // Finished calls can go; running ones still wait for their result.
      for (const [id, r] of state.tools) {
        if (state.tools.size <= TOOLS_MAX * 0.9) break;
        if (r.e.st !== 'run') state.tools.delete(id);
      }
    }
    return rec;
  }

  function orphan(id, res) {
    if (!id) return;
    state.orphans.delete(id);
    state.orphans.set(id, res);
    if (state.orphans.size > ORPHANS_MAX) state.orphans.delete(state.orphans.keys().next().value);
  }

  function takeOrphan(id) {
    const o = state.orphans.get(id);
    if (o) state.orphans.delete(id);
    return o;
  }

  function notice(ops, id, at, p, text, level = 'info', extra = {}) {
    emit(ops, entry(id, 'notice', at, p, { text: sanitize(text, 2000), level, ...extra }));
  }

  /** Running calls end with the turn (interrupt, abort, completion); background ones run on. */
  function finishRunning(ops, st) {
    for (const rec of state.tools.values()) {
      if (rec.e.st !== 'run' || rec.bg) continue;
      rec.e = { ...rec.e, st };
      ops.push({ op: 'upd', e: rec.e });
    }
  }

  // ---------------------------------------------------------------- Claude Code

  function claudeLine(j, src) {
    const ops = [];
    let p = parent;
    if (!parent && j.isSidechain) {
      // Older Claude Code wrote subagent turns into the main transcript. They belong to the
      // Agent call that is running, if only one is; otherwise there's no telling whose they are.
      const running = [...state.tools.values()].filter((r) => r.e.kind === 'agent' && r.e.st === 'run' && !r.e.parent);
      if (running.length !== 1) return ops;
      p = running[0].e.id;
      if (!legacyPrompted.has(p) && j.type === 'user' && !j.isMeta) {
        legacyPrompted.add(p);
        return ops;
      }
    } else if (parent && !promptSeen) {
      // The parent's card already shows the prompt. A fork's transcript first repeats the
      // parent's Agent call, and its prompt line carries that call's result.
      if (j.type === 'user' && !j.isMeta) {
        promptSeen = true;
        return ops;
      }
      if (j.type === 'assistant' && (j.message?.content || []).every((b) => b?.type === 'tool_use' && b.id === parent)) return ops;
    }
    if (j.type === 'user') claudeUser(j, src, p, ops);
    else if (j.type === 'assistant') claudeAssistant(j, src, p, ops);
    else if (j.type === 'system') claudeSystem(j, src, p, ops);
    else if (j.type === 'attachment') claudeQueued(j, src, p, ops);
    // A task stopped before its notification was delivered only shows in the queue log.
    else if (j.type === 'queue-operation' && j.operation === 'enqueue' && typeof j.content === 'string' && j.content.trim().startsWith('<task-notification>')) {
      taskNotification(j.content.trim(), null, timeOf(j), p, ops);
    }
    return ops;
  }

  /**
   * What reaches the agent mid-turn is written as a queued_command attachment, not a user line:
   * prompts typed while it works, task notifications, and background agents' hand-backs.
   */
  function claudeQueued(j, src, p, ops) {
    const a = j.attachment;
    if (!a || a.type !== 'queued_command') return;
    const o = a.origin && typeof a.origin === 'object' ? a.origin : {};
    if (o.kind === 'peer') {
      if (o.handback) handback(String(o.from ?? ''), o.handbackReportText ?? o.body, timeOf(j), ops);
      return;
    }
    if (a.isMeta) return;
    claudeUser({ uuid: j.uuid, timestamp: j.timestamp, message: { content: a.prompt } }, src, p, ops, true);
  }

  /** A background agent handed its report back: its card is done and shows the report. */
  function handback(agentId, report, at, ops) {
    if (!agentId) return;
    for (const rec of state.tools.values()) {
      if (rec.e.cat !== 'agent' || rec.e.detail?.agentId !== agentId) continue;
      const detail = { ...rec.e.detail };
      if (typeof report === 'string' && report.trim()) detail.result = sanitize(report.replace(/^\[Subagent hand-back\][^\n]*\n+/, '').trim(), caps.md);
      const timed = rec.e.st === 'run' && at && rec.e.at && at >= rec.e.at;
      rec.bg = false;
      rec.e = { ...rec.e, st: rec.e.st === 'run' ? 'ok' : rec.e.st, detail };
      if (timed) rec.e.ms = at - rec.e.at;
      ops.push({ op: 'upd', e: rec.e });
      return;
    }
  }

  function claudeUser(j, src, p, ops, queued = false) {
    const at = timeOf(j);
    if (j.isMeta) {
      // Inside a subagent's transcript a task notification is a meta line (after a
      // "[SYSTEM NOTIFICATION …]" preamble): it still ends that task.
      const t = textOf(j.message?.content);
      const k = t.indexOf('<task-notification>');
      if (j.origin?.kind === 'task-notification' && k >= 0) taskNotification(t.slice(k), null, at, p, ops);
      return;
    }
    const c = j.message?.content;
    if (j.isCompactSummary) {
      // Its first line is boilerplate ("This session is being continued from a previous conversation…").
      const summary = sanitize(textOf(c).replace(/^\s*This session is being continued[^\n]*\n+/, '').trim(), caps.md);
      if (compact) {
        compact = { ...compact, summary };
        ops.push({ op: 'upd', e: compact });
        return;
      }
      // Read without its boundary (a window starting here): its parentUuid is the boundary, so the id is the same.
      emit(ops, entry(j.parentUuid ? `${j.parentUuid}:0` : lineId(j, src, 0), 'compact', at, p, { summary }));
      return;
    }
    const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
    const results = blocks.filter((b) => b?.type === 'tool_result');
    // toolUseResult describes the line's result; it is unambiguous only when there is one.
    const tur = results.length === 1 ? j.toolUseResult : undefined;
    for (const r of results) {
      const id = String(r.tool_use_id || '');
      if (!id || id === parent) continue;
      const res = { text: textOf(r.content), isError: r.is_error === true, tur: slimResult(tur), denial: j.toolDenialKind, feedback: j.userFeedback, at, src };
      const rec = state.tools.get(id);
      if (!rec) orphan(id, res);
      else {
        claudeResult(rec, res);
        ops.push({ op: 'upd', e: rec.e });
      }
    }
    const prompt = [];
    let first = -1;
    let images = 0;
    blocks.forEach((b, i) => {
      if (/image/.test(String(b?.type))) {
        images++;
        if (first < 0) first = i;
        return;
      }
      if (b?.type !== 'text' || typeof b.text !== 'string') return;
      const s = b.text.trim();
      if (!s) return;
      if (s.startsWith('[Request interrupted')) {
        finishRunning(ops, 'stopped');
        return notice(ops, lineId(j, src, i), at, p, '중단됨');
      }
      if (s.startsWith('<command-name>')) return notice(ops, lineId(j, src, i), at, p, commandText(s));
      if (s.startsWith('<task-notification>')) return taskNotification(s, lineId(j, src, i), at, p, ops);
      if (s.startsWith('<bash-input>')) return notice(ops, lineId(j, src, i), at, p, `셸: ${tag(s, 'bash-input')}`);
      // Other markup is Claude Code's own (command output, caveats, injected context); pasted text is the person's.
      if (s.startsWith('<') && !s.startsWith('<pasted_content')) return;
      prompt.push(b.text);
      if (first < 0) first = i;
    });
    if (!prompt.length && !(images && !results.length)) return;
    // A prompt line starts a new turn: a call of the last one still without a result never got one.
    if (!queued && !p) finishRunning(ops, 'stopped');
    if (!p) state.turn++;
    const e = entry(lineId(j, src, first), 'user', at, p, { text: sanitize(prompt.join('\n\n').trim(), caps.text) });
    if (images) e.images = images;
    emit(ops, e);
  }

  function claudeAssistant(j, src, p, ops) {
    const at = timeOf(j);
    const blocks = Array.isArray(j.message?.content) ? j.message.content : [];
    if (j.isApiErrorMessage) return notice(ops, lineId(j, src, 0), at, p, textOf(blocks).trim() || 'API 오류', 'warn');
    blocks.forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) emit(ops, entry(lineId(j, src, i), 'reply', at, p, { md: sanitize(b.text.trim(), caps.md) }));
      else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) emit(ops, entry(lineId(j, src, i), 'thinking', at, p, { md: sanitize(b.thinking.trim(), caps.md) }));
      else if (b.type === 'tool_use') claudeTool(b, at, src, p, ops);
    });
  }

  function claudeTool(b, at, src, p, ops) {
    const id = String(b.id || '');
    // A fork's transcript repeats the parent's Agent call; a line read twice is already known.
    if (!id || id === parent || state.tools.has(id)) return;
    const name = String(b.name || '');
    const input = b.input && typeof b.input === 'object' ? b.input : {};
    const cat = claudeCat(name);
    const e = entry(id, kindOf(cat), at, p, {
      cat,
      tool: name,
      title: sanitize(describeTool(name, input, cwd).text, 300),
      st: 'run',
      src: { use: src ?? null, res: null },
      detail: detailOf(cat, input, '', undefined, caps, name),
    });
    const rec = remember(e, input);
    const o = takeOrphan(id);
    if (o) claudeResult(rec, o);
    emit(ops, rec.e);
  }

  function claudeResult(rec, res) {
    const { e, input } = rec;
    const tur = res.tur;
    let st = res.denial === 'interrupted' ? 'stopped' : res.denial ? 'denied' : DENIED.test(res.text) ? 'denied' : STOPPED.test(res.text) || tur?.interrupted === true ? 'stopped' : res.isError ? 'err' : 'ok';
    // A refused or cut-off call has no result to show (only partial output, if it kept any):
    // its card keeps what was asked, and the reason goes to `error`.
    const bare = st === 'denied' || (st === 'stopped' && !(tur && typeof tur === 'object' && typeof tur.stdout === 'string'));
    const detail = bare ? detailOf(e.cat, input, '', undefined, caps, e.tool) : detailOf(e.cat, input, res.text, tur, caps, e.tool);
    // Started in the background: running until its task notification.
    rec.bg = st === 'ok' && !!tur && typeof tur === 'object' && (tur.status === 'async_launched' || !!tur.backgroundTaskId);
    if (rec.bg) st = 'run';
    const ne = { ...e, st, detail, src: { use: e.src?.use ?? null, res: res.src ?? null } };
    const ms = int(tur?.durationMs) ?? int(tur?.totalDurationMs) ?? (res.at && e.at && res.at >= e.at ? res.at - e.at : null);
    if (ms != null && !rec.bg) ne.ms = ms;
    if (st === 'denied' || st === 'stopped' || (st === 'err' && e.cat !== 'cmd')) {
      const why = res.text.replace(/^Error: /, '').replace(/<\/?tool_use_error>/g, '').trim();
      if (why) ne.error = sanitize(why, 2000);
    }
    if (typeof res.feedback === 'string' && res.feedback.trim()) ne.feedback = sanitize(res.feedback.trim(), caps.text);
    rec.e = ne;
  }

  /**
   * "<task-notification>": a background command or agent is done; its card learns how it went.
   * Without an id (a meta or queue copy) only the card is updated, so the notice shows once.
   */
  function taskNotification(s, id, at, p, ops) {
    const status = tag(s, 'status');
    const summary = tag(s, 'summary');
    const failed = /fail|error/i.test(status);
    if (id) notice(ops, id, at, p, '백그라운드 작업이 끝났어요', failed ? 'warn' : 'info', summary ? { summary: sanitize(summary, 1000) } : {});
    const rec = state.tools.get(tag(s, 'tool-use-id'));
    if (!rec) return;
    let st = /complete/i.test(status) ? 'ok' : failed ? 'err' : /kill|stop|cancel/i.test(status) ? 'stopped' : rec.e.st;
    const detail = { ...rec.e.detail };
    const result = tag(s, 'result');
    if (rec.e.cat === 'agent' && result) detail.result = sanitize(result, caps.md);
    const code = summary.match(/exit code (-?\d+)/i);
    if (rec.e.cat === 'cmd' && code) {
      detail.exit = +code[1];
      if (detail.exit !== 0 && st === 'ok') st = 'err';
    }
    // The first copy to arrive times it; a later copy of the same notification changes nothing.
    const timed = rec.e.st === 'run' && at && rec.e.at && at >= rec.e.at;
    rec.bg = false;
    rec.e = { ...rec.e, st, detail };
    if (timed) rec.e.ms = at - rec.e.at;
    ops.push({ op: 'upd', e: rec.e });
  }

  function claudeSystem(j, src, p, ops) {
    const at = timeOf(j);
    const id = lineId(j, src, 0);
    switch (j.subtype) {
      case 'turn_duration':
        if (p) return;
        // The turn is over: what it started in the foreground and never answered was cut off.
        finishRunning(ops, 'stopped');
        return emit(ops, entry(id, 'turn', at, p, { ms: int(j.durationMs) }));
      case 'compact_boundary': {
        const m = j.compactMetadata || {};
        return emit(ops, entry(id, 'compact', at, p, { trigger: sanitize(m.trigger ?? '', 50), pre: int(m.preTokens) }));
      }
      case 'api_error': {
        const why = j.error?.formatted ?? j.error?.message ?? '';
        const tries = Number.isFinite(j.retryAttempt) ? ` (${j.retryAttempt}/${j.maxRetries ?? '?'})` : '';
        return notice(ops, id, at, p, `API 오류로 다시 시도하는 중${tries}`, 'warn', why ? { summary: sanitize(String(why), 500) } : {});
      }
      case 'local_command':
        if (typeof j.content === 'string' && j.content.trim().startsWith('<command-name>')) notice(ops, id, at, p, commandText(j.content.trim()));
    }
  }

  // ---------------------------------------------------------------- Codex

  function codexLine(j, src) {
    const ops = [];
    const p = j.payload && typeof j.payload === 'object' ? j.payload : {};
    const at = timeOf(j);
    if (j.type === 'session_meta') {
      const m = p.meta && typeof p.meta === 'object' ? p.meta : p;
      if (typeof m.id === 'string' && m.id) {
        state.sessionId = m.id;
        ops.push({ op: 'meta', sessionId: m.id });
      }
    } else if (j.type === 'compacted') codexCompact(offId(src), at, p.message, ops);
    else if (j.type === 'event_msg') codexEvent(p, at, src, ops);
    else if (j.type === 'response_item') codexResponse(p, at, src, ops);
    return ops;
  }

  function codexEvent(p, at, src, ops) {
    switch (p.type) {
      case 'task_started':
        state.turn++;
        turnOpen = true;
        recent.clear();
        return;
      case 'task_complete':
        finishRunning(ops, 'ok');
        wrapper = null;
        return emit(ops, entry(offId(src), 'turn', at, parent, { ms: int(p.duration_ms) }));
      case 'turn_aborted':
        finishRunning(ops, 'stopped');
        wrapper = null;
        return notice(ops, offId(src), at, parent, '중단됨');
      case 'user_message':
        return codexPrompt(p.message, Array.isArray(p.images) ? p.images.length : 0, offId(src), at, ops);
      case 'agent_message':
        return codexReply(p.message, offId(src), at, ops);
      case 'context_compacted':
        return codexCompact(offId(src), at, '', ops);
      case 'item_completed': {
        // The event times the item; an item without a duration of its own (Extension) uses it.
        const took = Number.isFinite(p.started_at_ms) && Number.isFinite(p.completed_at_ms) ? Math.max(0, p.completed_at_ms - p.started_at_ms) : null;
        return codexItem(p.item, at, src, ops, took);
      }
      // agent_reasoning repeats the reasoning item; exec_*/patch_* events repeat calls and outputs.
    }
  }

  function codexPrompt(text, images, id, at, ops) {
    const t = String(text ?? '').trim();
    if ((!t && !images) || t.startsWith('<')) return;
    if (recent.has('u:' + t)) return;
    if (turnOpen) turnOpen = false;
    else state.turn++; // older logs have no task_started
    recent.clear();
    recent.add('u:' + t);
    const e = entry(id, 'user', at, parent, { text: sanitize(t, caps.text) });
    if (images) e.images = images;
    emit(ops, e);
  }

  function codexReply(text, id, at, ops, phase) {
    let t = String(text ?? '');
    // The desktop app wraps some messages in a ":::writing{…}" block.
    const m = t.match(/^:::[\w-]+\{[^}\n]*\}\n([\s\S]*?)\n:::\s*$/);
    if (m) t = m[1];
    t = t.trim();
    if (!t || recent.has('a:' + t)) return;
    for (const k of recent) if (k.startsWith('u:')) recent.delete(k);
    addBounded(recent, 'a:' + t);
    const e = entry(id, 'reply', at, parent, { md: sanitize(t, caps.md) });
    if (typeof phase === 'string' && phase) e.phase = phase;
    emit(ops, e);
  }

  function codexThinking(text, id, at, ops) {
    const t = String(text ?? '').trim();
    if (!t || recent.has('t:' + t)) return;
    addBounded(recent, 't:' + t);
    emit(ops, entry(id, 'thinking', at, parent, { md: sanitize(t, caps.md) }));
  }

  function codexCompact(id, at, message, ops) {
    const summary = message ? sanitize(String(message).trim(), caps.md) : '';
    // `compacted` and `context_compacted` describe the same compaction.
    if (compact) {
      if (summary && !compact.summary) {
        compact = { ...compact, summary };
        ops.push({ op: 'upd', e: compact });
      }
      return;
    }
    emit(ops, entry(id, 'compact', at, parent, summary ? { summary } : {}));
  }

  function codexResponse(p, at, src, ops) {
    switch (p.type) {
      // `message` repeats prompts and replies (they come as events) or is the environment.
      case 'reasoning': {
        const t = (Array.isArray(p.summary) ? p.summary : []).map((s) => (typeof s === 'string' ? s : s?.text)).filter(Boolean).join('\n\n');
        return codexThinking(t, p.id ? String(p.id) : offId(src), at, ops);
      }
      case 'function_call':
      case 'custom_tool_call':
        return codexCall(p, at, src, ops);
      case 'local_shell_call':
        return codexCall({ type: 'function_call', name: 'local_shell', call_id: p.call_id ?? p.id, arguments: { command: p.action?.command, workdir: p.action?.working_directory } }, at, src, ops);
      case 'function_call_output':
      case 'custom_tool_call_output':
      case 'local_shell_call_output':
        return codexOutput(p, at, src, ops);
      case 'web_search_call': {
        const id = String(p.id ?? p.call_id ?? offId(src));
        if (state.tools.has(id)) return;
        const input = { query: p.action?.query ?? p.query ?? '' };
        const st = /fail/.test(p.status) ? 'err' : /progress|search/.test(p.status) ? 'run' : 'ok';
        const e = entry(id, 'tool', at, parent, { cat: 'web', tool: 'web_search', title: sanitize(`검색 "${clip(input.query, 60)}"`, 300), st, src: { use: src ?? null, res: src ?? null }, detail: detailOf('web', input, '', undefined, caps) });
        remember(e, input);
        return emit(ops, e);
      }
    }
  }

  function codexCall(p, at, src, ops) {
    const name = String(p.name ?? '');
    const id = String(p.call_id ?? p.id ?? offId(src));
    if (state.tools.has(id)) return;
    let args = p.type === 'custom_tool_call' ? (p.input ?? '') : (p.arguments ?? {});
    if (typeof args === 'string' && p.type !== 'custom_tool_call') {
      try {
        args = JSON.parse(args);
      } catch {
        args = { raw: args };
      }
    }
    if (name === 'exec') return codexWrapper(id, name, args, at, src, ops);
    let cat = codexCat(name);
    // Older Codex ran apply_patch through the shell.
    if (cat === 'cmd' && /^\s*apply_patch\b/.test(commandOf(args))) cat = 'edit';
    const detail = detailOf(cat, args, '', undefined, caps, name);
    const e = entry(id, kindOf(cat), at, parent, { cat, tool: name, title: sanitize(codexTitle(cat, name, args, detail), 300), st: 'run', src: { use: src ?? null, res: null }, detail });
    const rec = remember(e, args);
    const o = takeOrphan(id);
    if (o) codexResult(rec, o);
    emit(ops, rec.e);
  }

  function codexTitle(cat, name, args, detail) {
    const a = args && typeof args === 'object' ? args : {};
    switch (cat) {
      case 'cmd':
        return `$ ${clip(commandOf(args).split('\n')[0], 110)}`;
      case 'edit':
        return `수정 ${detail.files.slice(0, 3).map((f) => relTo(cwd, f.path)).join(', ') || '파일'}`;
      case 'todo':
        return '할 일 갱신';
      case 'agent':
        return `서브에이전트: ${clip(a.task_name || a.message || a.prompt || '작업', 80)}`;
      case 'mcp': {
        const { server, tool } = mcpName(name);
        return `${server}: ${tool}`;
      }
      case 'web':
        return `검색 "${clip(a.query, 60)}"`;
      default:
        return name;
    }
  }

  /**
   * Newer Codex runs tools from a script (`exec`). The script shows as a card until the first
   * tool it runs arrives; that tool takes the card over (same id), the rest get their own.
   */
  function codexWrapper(id, name, args, at, src, ops) {
    const code = typeof args === 'string' ? args : String(args?.code ?? args?.input ?? '');
    const lines = code.split('\n').map((s) => s.trim());
    const first = lines.find((s) => s && !s.startsWith('//')) || lines[0] || name;
    const e = entry(id, 'tool', at, parent, { cat: 'code', tool: name, title: sanitize(clip(first, 140), 300), st: 'run', src: { use: src ?? null, res: null }, detail: detailOf('code', code, '', undefined, caps) });
    remember(e, code);
    wrapper = { id, kids: 0 };
    emit(ops, e);
  }

  function codexChild(spec, at, src, ops, took = null) {
    if (state.tools.has(spec.id) || merged.has(spec.id)) return;
    if (spec.ms == null) spec.ms = took;
    const w = wrapper && state.tools.get(wrapper.id);
    if (wrapper) wrapper.kids++;
    if (w && wrapper.kids === 1) {
      addBounded(merged, spec.id);
      w.input = spec.input;
      w.e = { ...w.e, kind: spec.kind, cat: spec.cat, tool: spec.tool, title: spec.title, st: spec.st, detail: spec.detail, src: { use: w.e.src?.use ?? null, res: src ?? null } };
      if (spec.ms != null) w.e.ms = spec.ms;
      ops.push({ op: 'upd', e: w.e });
      return;
    }
    const e = entry(spec.id, spec.kind, at, parent, { cat: spec.cat, tool: spec.tool, title: spec.title, st: spec.st, src: { use: src ?? null, res: src ?? null }, detail: spec.detail });
    if (spec.ms != null) e.ms = spec.ms;
    remember(e, spec.input);
    emit(ops, e);
  }

  function codexItem(item, at, src, ops, took = null) {
    if (!item || typeof item !== 'object') return;
    const id = item.id != null ? String(item.id) : offId(src);
    switch (item.type) {
      case 'UserMessage':
        return codexPrompt(textOf(item.content), 0, id, at, ops);
      case 'AgentMessage':
        return codexReply(textOf(item.content), id, at, ops, item.phase);
      case 'Reasoning':
        return codexThinking([].concat(item.summary ?? []).map((s) => (typeof s === 'string' ? s : s?.text)).filter(Boolean).join('\n\n'), id, at, ops);
      case 'ContextCompaction':
        return codexCompact(id, at, '', ops);
      case 'CommandExecution': {
        const command = Array.isArray(item.command) ? unshell(item.command) : String(item.command ?? '');
        const input = { command };
        const st = /declin|reject|denied/i.test(item.status) ? 'denied' : item.exit_code == null && /progress|running/i.test(item.status) ? 'run' : item.exit_code != null && item.exit_code !== 0 ? 'err' : /fail/i.test(item.status) ? 'err' : 'ok';
        const d = item.duration;
        const ms = d && Number.isFinite(d.secs) ? Math.round(d.secs * 1000 + (d.nanos || 0) / 1e6) : null;
        return codexChild({ id, kind: 'tool', cat: 'cmd', tool: 'exec_command', title: sanitize(`$ ${clip(command.split('\n')[0], 110)}`, 300), st, ms, input, detail: detailOf('cmd', input, '', item, caps) }, at, src, ops, took);
      }
      case 'FileChange':
        if (item.changes && typeof item.changes === 'object') {
          const input = { changes: item.changes };
          const detail = detailOf('edit', input, '', undefined, caps);
          const st = /fail|error/i.test(item.status) ? 'err' : /declin|reject/i.test(item.status) ? 'denied' : 'ok';
          return codexChild({ id, kind: 'tool', cat: 'edit', tool: 'apply_patch', title: sanitize(codexTitle('edit', 'apply_patch', input, detail), 300), st, input, detail }, at, src, ops, took);
        }
        break;
      case 'McpToolCall':
        if (item.server && item.tool) {
          const name = `${item.server}__${item.tool}`;
          const out = item.error ? String(item.error?.message ?? item.error) : textOf(item.result?.content ?? item.result);
          const st = item.error || /fail|error/i.test(item.status) ? 'err' : 'ok';
          return codexChild({ id, kind: 'tool', cat: 'mcp', tool: name, title: sanitize(`${item.server}: ${item.tool}`, 300), st, input: item.arguments, detail: detailOf('mcp', item.arguments, out, undefined, caps, name) }, at, src, ops, took);
        }
        break;
      case 'WebSearch':
        if (typeof item.query === 'string') {
          const input = { query: item.query };
          return codexChild({ id, kind: 'tool', cat: 'web', tool: 'web_search', title: sanitize(`검색 "${clip(item.query, 60)}"`, 300), st: 'ok', input, detail: detailOf('web', input, '', undefined, caps) }, at, src, ops, took);
        }
        break;
    }
    // Anything else (image generation, new item types) still shows, as what it is.
    const { type, id: _, status, ...rest } = item;
    const failure = item.failure ? String(item.failure?.message ?? item.failure) : '';
    const st = failure || /fail|error/i.test(status) ? 'err' : /declin|reject/i.test(status) ? 'denied' : /progress|running|pending/i.test(status) ? 'run' : 'ok';
    const name = String(item.kind ?? type ?? 'tool');
    codexChild({ id, kind: 'tool', cat: 'tool', tool: String(type ?? 'tool'), title: sanitize(clip(name, 140), 300), st, input: rest, detail: detailOf('tool', rest, failure || (typeof item.savedPath === 'string' ? item.savedPath : ''), undefined, caps) }, at, src, ops, took);
  }

  function codexOutput(p, at, src, ops) {
    const id = String(p.call_id ?? '');
    const text = outputText(p.output);
    if (wrapper && wrapper.id === id) {
      const kids = wrapper.kids;
      wrapper = null;
      if (kids) return; // the tools it ran already carry their own results
    }
    const rec = state.tools.get(id);
    const res = { text, at, src };
    if (!rec) return orphan(id, res);
    codexResult(rec, res);
    ops.push({ op: 'upd', e: rec.e });
  }

  function codexResult(rec, res) {
    const { e, input } = rec;
    const head = res.text.slice(0, 300);
    const parsed = parseOutput(res.text);
    const st = /rejected by (the )?user|declined by (the )?user|denied by (the )?user/i.test(head) ? 'denied' : /^aborted\b/i.test(head) ? 'stopped' : (parsed.exit != null && parsed.exit !== 0) || parsed.failed ? 'err' : 'ok';
    const detail = st === 'denied' ? e.detail : detailOf(e.cat, input, res.text, undefined, caps, e.tool);
    const ne = { ...e, st, detail, src: { use: e.src?.use ?? null, res: res.src ?? null } };
    const ms = parsed.ms ?? (res.at && e.at && res.at >= e.at ? res.at - e.at : null);
    if (ms != null) ne.ms = ms;
    if (st === 'denied' || st === 'stopped' || (st === 'err' && e.cat !== 'cmd' && e.cat !== 'code')) ne.error = sanitize((parsed.out || res.text).trim(), 2000);
    rec.e = ne;
  }

  function line(j, src) {
    if (!j || typeof j !== 'object') return [];
    try {
      return agent === 'codex' ? codexLine(j, src) : claudeLine(j, src);
    } catch {
      // One odd line must not stop the rest of the conversation from showing.
      return [];
    }
  }

  return { line, state };
}

/** A bounded insertion-ordered set. */
function addBounded(set, k) {
  set.add(k);
  if (set.size > RECENT_MAX) set.delete(set.values().next().value);
}

const tag = (s, name) => {
  const m = s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
};

/** "<command-name>/model</command-name>…<command-args>opus</command-args>" → "명령: /model opus". */
function commandText(s) {
  const name = tag(s, 'command-name');
  const args = tag(s, 'command-args');
  return clip(`명령: ${name.startsWith('/') ? name : '/' + name}${args ? ' ' + args : ''}`, 300);
}

/** Codex tool output: a string, or content items (text kept, images marked). */
function outputText(o) {
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) return textOf(o);
  if (o && typeof o === 'object') {
    try {
      return JSON.stringify(slim(o, 0));
    } catch {}
  }
  return '';
}

/** Drop the parts of a toolUseResult nobody shows (image data, a whole file's old text) before keeping it. */
function slimResult(tur) {
  if (!tur || typeof tur !== 'object' || Array.isArray(tur)) return tur;
  let r = tur;
  if (typeof r.file?.base64 === 'string') r = { ...r, file: { ...r.file, base64: undefined } };
  if (typeof r.originalFile === 'string' && Array.isArray(r.structuredPatch) && r.structuredPatch.length) r = { ...r, originalFile: undefined };
  return r;
}
