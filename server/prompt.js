// What an agent is waiting on, in a shape a card can show and answer: the exact command, the diff
// of the edit it wants to make, its questions with their options, the plan it wants approved.
// Built once, when the agent blocks; the screen part (which key is which button) is read live.
import fs from 'node:fs';
import path from 'node:path';
import { diffLines, parseApplyPatch, stats } from './diff.js';
import { sanitize, relTo } from './transcript.js';
import { randomId, resolveInside, realPath } from './util.js';
import { menuActions, planChoices } from './screen.js';

const CAP = { diffLines: 120, line: 200, questions: 4, options: 6, plan: 6000, command: 4000, file: 1_000_000 };

/**
 * @param {{task, kind:'permission'|'question'|'plan'|'elicitation', tool?, input?, message?, by?, running?}} o
 *   running: the activity feed's last running item, for prompts that come without their tool call
 *   (Claude's bare permission notification, Codex approvals).
 */
export function buildPrompt({ task, kind, tool = '', input, message = '', by, running }) {
  const i = input && typeof input === 'object' ? input : {};
  const p = { id: randomId('q'), kind, tool: sanitize(tool, 80), at: Date.now(), title: '', message: sanitize(message, 600) };
  if (by?.agentId) p.by = { agentId: String(by.agentId), type: sanitize(by.type || '', 40) };
  if (kind === 'question') {
    p.title = '질문에 답해 주세요';
    p.questions = (Array.isArray(i.questions) ? i.questions : []).slice(0, CAP.questions).map((q) => ({
      header: sanitize(q?.header || '', 40),
      question: sanitize(q?.question || '', 400),
      multi: !!q?.multiSelect,
      options: (Array.isArray(q?.options) ? q.options : []).slice(0, CAP.options).map((o) => ({ label: sanitize(o?.label || '', 120), desc: sanitize(o?.description || '', 300) })),
    }));
    return p;
  }
  if (kind === 'plan') {
    p.title = '이 계획대로 진행할까요?';
    p.plan = sanitize(String(i.plan || ''), CAP.plan);
    return p;
  }
  if (kind === 'elicitation') {
    p.title = p.message || '답을 기다려요';
    return p;
  }
  // permission
  Object.assign(p, permissionDetail(task, tool, i, running));
  return p;
}

function permissionDetail(task, tool, i, running) {
  const cwd = task.cwd || '';
  if (tool === 'Bash') return { title: '이 명령을 실행할까요?', command: { text: sanitize(String(i.command || ''), CAP.command), desc: sanitize(i.description || '', 200) } };
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') {
    const file = String(i.file_path || i.notebook_path || '');
    const before = readInside(cwd, file);
    const title = tool === 'Write' ? (before == null ? '새 파일을 만들까요?' : '이 파일을 덮어쓸까요?') : '이 파일을 고칠까요?';
    if (tool === 'NotebookEdit') return { title, target: { label: '노트북', value: relTo(cwd, file) } };
    return { title, edit: editOf(tool, i, before, relTo(cwd, file)) };
  }
  if (tool === 'WebFetch') return { title: '이 주소를 열까요?', target: { label: '주소', value: sanitize(i.url || '', 400) } };
  if (tool === 'WebSearch') return { title: '웹을 검색할까요?', target: { label: '검색어', value: sanitize(i.query || '', 200) } };
  if (tool === 'Read') return { title: '이 파일을 읽을까요?', target: { label: '파일', value: relTo(cwd, String(i.file_path || '')) } };
  if (tool === 'Grep' || tool === 'Glob') return { title: '파일을 찾아볼까요?', target: { label: '찾을 것', value: sanitize(i.pattern || '', 200) } };
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__');
    return { title: `${sanitize(server, 40)} 도구를 쓸까요? · ${sanitize(name || '', 60)}`, target: { label: '입력', value: sanitize(JSON.stringify(i, null, 2), 1200) } };
  }
  if (tool) return { title: `${sanitize(tool, 60)} 도구를 쓸까요?`, target: Object.keys(i).length ? { label: '입력', value: sanitize(JSON.stringify(i, null, 2), 1200) } : undefined };
  // No tool call came with it (Claude's bare notification, a Codex approval): say what was running.
  if (running?.kind === 'cmd') return { title: '이 명령을 실행할까요?', command: { text: sanitize(running.text.replace(/^\$\s*/, ''), CAP.command), desc: '' } };
  if (running?.patch) return { title: '이 파일을 고칠까요?', edit: capFiles(parseApplyPatch(running.patch)) };
  if (running?.text) return { title: '허락을 기다려요', target: { label: '하려는 일', value: sanitize(running.text, 400) } };
  return { title: '허락을 기다려요' };
}

/** A file inside the task folder, as text, if it's small and not binary; null when it isn't there. */
function readInside(cwd, file) {
  if (!cwd || !file) return null;
  let rel = file;
  if (path.isAbsolute(file)) {
    try {
      rel = path.relative(realPath(cwd), file);
    } catch {
      return null;
    }
  }
  const abs = resolveInside(cwd, rel);
  if (!abs) return null;
  try {
    const st = fs.lstatSync(abs);
    if (!st.isFile() || st.size > CAP.file) return null;
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function editOf(tool, i, before, rel) {
  if (tool === 'Write') {
    const after = String(i.content ?? '');
    const hunks = before == null ? [{ a: null, b: 1, lines: after.split('\n').map((l) => '+' + l) }] : diffLines(before, after, { context: 3, maxLines: CAP.diffLines });
    return capFiles([{ path: rel, op: before == null ? 'create' : 'edit', hunks }]);
  }
  const edits = tool === 'MultiEdit' ? (Array.isArray(i.edits) ? i.edits : []) : [i];
  if (before != null) {
    // Applied to the real file, so the numbers on the left are the file's own line numbers.
    let after = before;
    for (const e of edits) {
      const o = String(e?.old_string ?? '');
      const n = String(e?.new_string ?? '');
      if (!o) continue;
      after = e.replace_all ? after.split(o).join(n) : after.replace(o, () => n);
    }
    if (after !== before) return capFiles([{ path: rel, op: 'edit', hunks: diffLines(before, after, { context: 3, maxLines: CAP.diffLines }) }]);
  }
  // The file isn't readable from here (outside the task folder, or not there yet): the snippets alone.
  const hunks = edits.flatMap((e) => diffLines(String(e?.old_string ?? ''), String(e?.new_string ?? ''), { context: 3, maxLines: CAP.diffLines }).map((h) => ({ ...h, a: null, b: null })));
  return capFiles([{ path: rel, op: 'edit', hunks }]);
}

/** At most CAP.diffLines lines in all, each at most CAP.line long. */
function capFiles(files) {
  let left = CAP.diffLines;
  let clipped = false;
  const out = [];
  for (const f of files.slice(0, 10)) {
    const st = stats(f.hunks);
    const hunks = [];
    for (const h of f.hunks) {
      if (left <= 0) {
        clipped = true;
        break;
      }
      const lines = h.lines.slice(0, left).map((l) => sanitize(l, CAP.line));
      if (lines.length < h.lines.length) clipped = true;
      left -= lines.length;
      hunks.push({ a: h.a ?? null, b: h.b ?? null, lines });
    }
    out.push({ path: sanitize(f.path, 300), op: f.op || 'edit', adds: st.adds, dels: st.dels, hunks });
  }
  return { files: out, clipped };
}

/**
 * The prompt as the window gets it: what was built when the agent blocked, plus what each button
 * means on the screen right now. A menu with no prompt behind it (read off the screen only) still
 * becomes a card, with an id that stays the same while that menu is up.
 */
export function promptView(prompt, menu, { careful = false } = {}) {
  if (!prompt && !menu) return null;
  const p = prompt ? { ...prompt } : { id: 'm' + hash(menu.question + '|' + menu.options.map((o) => o.label).join('|')), kind: 'menu', tool: '', at: 0, title: menu.question || '선택을 기다려요', message: '' };
  p.screen = { ready: !!menu, actions: menuActions(menu) || {}, plan: planChoices(menu, { careful }), q: menu ? { question: menu.question, count: menu.tabs ? menu.tabs.filter((t) => !/^submit$/i.test(t.label)).length : 1, review: !!menu.review } : null };
  return p;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The start of the last reply, for tiles and the rail: about `n` characters, never an open code fence. */
export function replyExcerpt(text, n = 700) {
  const s = sanitize(String(text || ''), 60_000).trim();
  if (!s) return null;
  let md = s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
  if ((md.match(/^```/gm) || []).length % 2) md += '\n```';
  return { md, more: s.length > n };
}
