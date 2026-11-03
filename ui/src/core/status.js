// What a task's state means to a person, in one place: which rail group it sits in, how urgent it
// is, its mark and label, and the one line that says why it's there. No DOM (unit-tested in Node).

export const GROUPS = [
  { key: 'yours', title: '내 차례' },
  { key: 'working', title: '작업 중' },
  { key: 'stopped', title: '멈춤' },
  { key: 'done', title: '끝남' },
];

export const isLive = (t) => ['starting', 'working', 'waiting', 'needs_input', 'review', 'exited'].includes(t.state);
/** Busy, or will pick up again by itself once its background work is done. */
export const isBusy = (t) => ['working', 'starting', 'waiting'].includes(t.state);
/** Stuck mid-turn on something only a person can give: a permission, a choice, a plan, an answer. */
export const isBlocked = (t) => t.state === 'needs_input' && !!(t.ask || (t.prompt && t.prompt.kind !== 'menu') || t.prompt?.screen?.ready);

export function groupOf(t) {
  if (t.state === 'needs_input' || t.state === 'review') return 'yours';
  if (isBusy(t)) return 'working';
  if (t.state === 'exited') return 'stopped';
  return 'done';
}

const KIND_RANK = { permission: 0, question: 1, plan: 2, elicitation: 3, menu: 4 };
/** Lower is more urgent: blocked first (permission before question before plan), then replies, then reviews. */
export function urgency(t) {
  if (isBlocked(t)) return KIND_RANK[t.prompt?.kind] ?? (t.ask === 'permission' ? 0 : 3);
  if (t.state === 'needs_input') return 10;
  if (t.state === 'review') return 20;
  return 30;
}

export function compareTasks(a, b) {
  return urgency(a) - urgency(b) || b.updatedAt - a.updatedAt;
}

/** What waits on the person, by kind: the chip on a row, the title of a card. */
export const ASK = {
  permission: { label: '허락 필요', short: '허락', icon: 'shield-question' },
  question: { label: '답 필요', short: '질문', icon: 'message-circle-question' },
  plan: { label: '계획 승인', short: '계획', icon: 'list-check' },
  elicitation: { label: '답 필요', short: '질문', icon: 'message-circle-question' },
  menu: { label: '선택 필요', short: '선택', icon: 'list-numbers' },
  choice: { label: '선택 필요', short: '선택', icon: 'list-numbers' },
  terminal: { label: '터미널에서 답하기', short: '터미널', icon: 'terminal-2' },
};

export function askOf(t) {
  if (!isBlocked(t)) return null;
  return ASK[t.prompt?.kind] || ASK[t.ask] || ASK.menu;
}

/** The mark at the corner of the project glyph. */
export function markOf(t) {
  if (isBlocked(t)) return 'blocked';
  if (t.state === 'needs_input') return 'yours';
  if (t.state === 'review') return 'review';
  if (t.state === 'waiting') return 'waiting';
  if (isBusy(t)) return 'working';
  if (t.state === 'exited') return 'stopped';
  return 'done';
}

/**
 * The word on a rail row or a tile, and its tone: 'warn' (stuck on me, drawn solid), 'info' (my
 * reply), 'ok' (to review), 'muted'. Working tasks have none: the line under them says what's going on.
 */
export function tagOf(t) {
  const ask = askOf(t);
  if (ask) return { label: ask.short, tone: 'warn', solid: true };
  if (t.state === 'needs_input') return { label: '답장', tone: 'info' };
  if (t.state === 'review') return { label: '새 결과', tone: 'ok' };
  if (t.state === 'waiting') return { label: '대기', tone: 'muted' };
  return null;
}

/**
 * A session's one status signal for the 0.7 standard: which lamp (wait · reply · result · work ·
 * bg · stop) and the word beside it.
 */
export function lampOf(t) {
  const ask = askOf(t);
  if (ask) return { s: 'wait', word: `${ask.short} 대기` };
  if (t.state === 'needs_input') return { s: 'reply', word: '답장 차례' };
  if (t.state === 'review') return { s: 'result', word: '새 결과' };
  if (t.state === 'working' || t.state === 'starting') return { s: 'work', word: t.state === 'starting' ? '시작하는 중' : '작업 중' };
  if (t.state === 'waiting') return { s: 'bg', word: '대기 중' };
  if (t.state === 'exited') return { s: 'stop', word: '멈춤' };
  return { s: 'stop', word: STATE_LABEL[t.state] || '끝남' };
}

const pad2 = (n) => String(n).padStart(2, '0');
/** A running clock, m:ss or h:mm:ss. */
export function clockOf(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}` : `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

/** The live timer a lamp carries: how long it has waited on me, or how long this turn has run. */
export function lampTimer(t, now) {
  const s = lampOf(t).s;
  if (s === 'wait') return clockOf(now - stateSince(t));
  if (s === 'work') return clockOf(now - (t.messages?.at(-1)?.at || t.activity?.since || t.updatedAt));
  return null;
}

export const STATE_LABEL = {
  starting: '시작하는 중',
  working: '작업 중',
  waiting: '대기 중',
  needs_input: '답장 차례',
  review: '새 결과',
  exited: '멈춤',
  merged: '머지함',
  discarded: '버림',
};

export function labelOf(t) {
  return askOf(t)?.label || STATE_LABEL[t.state] || t.state;
}

/** Plain first line of some markdown: no markers, no code fences. */
export function firstLine(md, n = 140) {
  const lines = String(md || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
        .replace(/[*_~`]+/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .trim()
    )
    .filter(Boolean);
  const s = lines[0] || '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Why the task is where it is, in one line. */
export function whyOf(t) {
  const p = t.prompt;
  if (isBlocked(t) && p) {
    const ask = askOf(t);
    const what = p.command?.text ? p.command.text.split('\n')[0] : p.edit?.files?.[0]?.path || p.target?.value || p.questions?.[0]?.question || (p.kind === 'plan' ? firstLine(p.plan) : '') || p.title || t.reason;
    return `${ask.short} · ${what || ''}`.replace(/ · $/, '');
  }
  if (isBlocked(t)) return t.reason || '선택을 기다려요';
  if (t.state === 'review') {
    const c = t.changes || {};
    const files = c.files ? `파일 ${c.files}개 +${c.adds} −${c.dels}` : '';
    const sum = firstLine(t.summary || t.reply?.md || '', 100);
    return [files, sum].filter(Boolean).join(' · ') || t.reason || '';
  }
  if (t.state === 'needs_input') return firstLine(t.reply?.md || t.summary || '', 140) || t.reason || '';
  if (t.state === 'working' || t.state === 'starting') return t.activity?.current || t.reason || '생각하는 중';
  if (t.state === 'waiting') return t.reason || '백그라운드 작업을 기다려요';
  if (t.state === 'merged') return t.mergedInto ? `${t.mergedInto}에 머지함` : '머지함';
  if (t.state === 'discarded') return '버림';
  return t.reason || '';
}

/** Rail order: grouped, most urgent first inside "내 차례", newest first elsewhere. */
export function grouped(tasks) {
  const out = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
  for (const t of tasks) out[groupOf(t)].push(t);
  out.yours.sort(compareTasks);
  for (const k of ['working', 'stopped', 'done']) out[k].sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** When the task got into its current state: the last change in its activity strip. */
export const stateSince = (t) => {
  const s = t.strip?.s?.at(-1);
  return s ? t.strip.from + s[0] * 1000 : t.updatedAt;
};

/** How long something has been waiting, in words. */
export function waited(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분째`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분째`;
}
