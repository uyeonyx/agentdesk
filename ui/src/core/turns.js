// A conversation as the person reads it: turns that start with what they said, the agent's replies
// in between, and its tool calls folded into runs ("명령 3 · 읽기 5 · 수정 2"). Pure, no DOM.

const CAT_LABEL = { cmd: '명령', read: '읽기', edit: '수정', search: '검색', web: '웹', mcp: 'MCP', code: '실행', tool: '도구', ask: '질문', plan: '계획' };
const CAT_ORDER = ['cmd', 'read', 'edit', 'search', 'web', 'mcp', 'code', 'ask', 'plan', 'tool'];

/**
 * @param entries top-level entries in order (children of subagents are fetched separately)
 * @returns {{ id, user, items, end }[]} items: {type:'reply'|'thinking'|'notice'|'compact'|'recap'|'cmdout'|'agent'|'run', ...}
 */
const hhmm = (at) => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * What the session no longer has: entries inside a rewound range go, with a note where it happened.
 * A fork gets a note where its own part starts. Entries without a time stay.
 */
export function applyCuts(entries, task) {
  const cuts = task?.cuts || [];
  const fork = task?.forkOf;
  if (!cuts.length && !fork) return entries;
  const out = [];
  const notes = cuts.map((c, i) => ({ at: c.to, e: { id: `cut-${i}-${c.to}`, kind: 'notice', at: c.to, text: `${hhmm(c.from + 1500)}에 보낸 지시 전으로 되감았어요 · 그 뒤의 대화와 파일 변경은 지웠어요` } }));
  if (fork) notes.push({ at: task.createdAt || 0, e: { id: `fork-${task.id}`, kind: 'notice', at: task.createdAt || 0, text: `「${fork.title}」에서 ${hhmm(fork.at)} 지시 전 시점으로 갈라졌어요 · 그때까지의 대화와 파일을 이어받았어요` } });
  notes.sort((a, b) => a.at - b.at);
  let n = 0;
  for (const e of entries) {
    const at = e.at || 0;
    while (n < notes.length && at && at > notes[n].at) out.push(notes[n++].e);
    if (at && cuts.some((c) => at >= c.from && at <= c.to)) continue;
    out.push(e);
  }
  while (n < notes.length) out.push(notes[n++].e);
  return out;
}

export function groupTurns(entries) {
  const turns = [];
  let turn = null;
  let run = null;
  const open = (user) => {
    turn = { id: user ? user.id : `t-${entries.length ? entries[0].id : 0}-${turns.length}`, user, items: [], end: null };
    turns.push(turn);
    run = null;
  };
  for (const e of entries) {
    if (e.kind === 'user') {
      open(e);
      continue;
    }
    if (!turn) open(null);
    if (e.kind === 'turn') {
      turn.end = e;
      run = null;
      continue;
    }
    if (e.kind === 'tool' || e.kind === 'todo') {
      if (!run) {
        run = { type: 'run', id: `run-${e.id}`, tools: [] };
        turn.items.push(run);
      }
      run.tools.push(e);
      continue;
    }
    run = null;
    if (e.kind === 'agent') turn.items.push({ type: 'agent', id: e.id, e });
    else if (['reply', 'thinking', 'notice', 'compact', 'recap', 'cmdout'].includes(e.kind)) turn.items.push({ type: e.kind, id: e.id, e });
  }
  return turns;
}

/** One line for a folded run: counts by kind, failures, time, and the files it changed. */
export function runSummary(tools) {
  const n = {};
  let fail = 0;
  let running = null;
  let ms = 0;
  const files = new Map();
  for (const t of tools) {
    if (t.kind === 'todo') continue;
    const cat = CAT_LABEL[t.cat] ? t.cat : 'tool';
    n[cat] = (n[cat] || 0) + 1;
    if (t.st === 'err' || t.st === 'denied') fail++;
    if (t.st === 'run' || t.st === 'wait') running = t;
    if (t.ms) ms += t.ms;
    for (const f of t.detail?.files || []) {
      const cur = files.get(f.path) || { path: f.path, adds: 0, dels: 0 };
      cur.adds += f.adds || 0;
      cur.dels += f.dels || 0;
      files.set(f.path, cur);
    }
  }
  const parts = CAT_ORDER.filter((c) => n[c]).map((c) => `${CAT_LABEL[c]} ${n[c]}`);
  return { parts, fail, running, ms, files: [...files.values()], count: tools.length };
}

/** The newest plan in the conversation (top-level TodoWrite / update_plan), for the strip on top. */
export function latestPlan(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === 'todo' && !e.parent && e.detail?.items?.length) return e.detail.items;
  }
  return null;
}

/** "1분 12초", "8초", "0.4초". */
export function duration(ms) {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}초`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 ${s % 60}초`.replace(/ 0초$/, '');
  return `${Math.floor(m / 60)}시간 ${m % 60}분`.replace(/ 0분$/, '');
}

/** Insert entries keeping order by `seq` (pages of earlier history arrive with lower seqs). */
export function mergeBySeq(list, add) {
  if (!add.length) return list;
  const out = list.slice();
  for (const e of add) {
    let lo = 0;
    let hi = out.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((out[mid].seq ?? 0) < (e.seq ?? 0)) lo = mid + 1;
      else hi = mid;
    }
    out.splice(lo, 0, e);
  }
  return out;
}
