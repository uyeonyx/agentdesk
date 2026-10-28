// ------------------------------------------------------------ color

export function hexToRgb(hex) {
  const n = parseInt(String(hex || '#888888').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function lum(hex) {
  const c = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** CSS custom properties that paint a "room" in a project's color. */
export function roomVars(color = '#7D8FA3') {
  const ink = lum(color) > 0.42 ? mix(color, '#000000', 0.72) : '#ffffff';
  return {
    '--room': color,
    '--room-ink': ink,
    '--room-text': mix(color, '#ffffff', 0.38),
    '--room-soft': rgba(color, 0.13),
    '--room-softer': rgba(color, 0.07),
    '--room-line': rgba(color, 0.55),
    '--room-glow': rgba(color, 0.28),
  };
}

// ------------------------------------------------------------ tasks

export const LANES = [
  { key: 'needs', title: '답할 것', states: ['needs_input'] },
  { key: 'review', title: '검토할 것', states: ['review'] },
  { key: 'working', title: '작업 중', states: ['working', 'starting', 'waiting'] },
  { key: 'paused', title: '멈춤', states: ['exited'] },
  { key: 'done', title: '끝남', states: ['merged', 'discarded'] },
];
export const laneOf = (t) => LANES.find((l) => l.states.includes(t.state))?.key || 'paused';
export const isLive = (t) => ['starting', 'working', 'waiting', 'needs_input', 'review', 'exited'].includes(t.state);
/** The agent is busy, or will pick up again by itself once its background work is done. */
export const isBusy = (t) => ['working', 'starting', 'waiting'].includes(t.state);

export const STATE_ICON = {
  needs_input: 'message-question',
  review: 'eye-check',
  working: null, // spinner
  starting: null,
  waiting: 'hourglass',
  exited: 'player-pause',
  merged: 'git-merge',
  discarded: 'trash',
};

export function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return '방금';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간`;
  return `${Math.round(h / 24)}일`;
}

// ------------------------------------------------------------ fuzzy

/** Subsequence match with bonuses for word starts and contiguity. Returns score or -1. */
export function fuzzy(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let run = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      const start = i === 0 || /[\s/_\-.]/.test(t[i - 1]);
      score += 1 + (start ? 3 : 0) + run * 2;
      run++;
      qi++;
    } else run = 0;
  }
  if (qi < q.length) return -1;
  return score - t.length * 0.01;
}

export function fuzzyFilter(query, items, key, limit = 60) {
  if (!query) return items.slice(0, limit);
  return items
    .map((it) => [fuzzy(query, key(it)), it])
    .filter(([s]) => s >= 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([, it]) => it);
}

// ------------------------------------------------------------ misc

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const mod = isMac ? '⌘' : 'Ctrl';

export function isTyping(el = document.activeElement) {
  if (!el) return false;
  if (el.closest?.('.xterm')) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable || !!el.closest?.('.monaco-editor .inputarea, .monaco-editor textarea');
}

export function langOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript',
    json: 'javascript', jsonc: 'javascript', py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
    rb: 'ruby', php: 'php', c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', css: 'css', scss: 'scss', less: 'less',
    html: 'html', htm: 'html', vue: 'html', svelte: 'html', md: 'markdown', mdx: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
    sh: 'shell', bash: 'shell', zsh: 'shell', sql: 'sql', graphql: 'graphql', gql: 'graphql', tf: 'hcl', hcl: 'hcl', xml: 'xml', svg: 'xml',
    dockerfile: 'dockerfile', lua: 'lua', dart: 'dart', scala: 'scala', ex: 'elixir', exs: 'elixir', proto: 'protobuf', r: 'r', sol: 'solidity',
  };
  if (/(^|\/)dockerfile$/i.test(path)) return 'dockerfile';
  return map[ext] || 'plaintext';
}

export function buildMessage(text, comments = [], refs = []) {
  const parts = [];
  const body = text.trim();
  if (body) parts.push(body);
  else if (comments.length) parts.push('아래 리뷰 코멘트대로 고쳐줘.');
  if (comments.length) {
    parts.push('리뷰 코멘트:\n' + comments.map((c) => `- \`${c.path}\` ${lines(c)}: ${c.text}`).join('\n'));
  }
  if (refs.length) {
    parts.push('참고 위치:\n' + refs.map((r) => `- \`${r.path}\` ${lines(r)}`).join('\n'));
  }
  return parts.join('\n\n');
}
const lines = (c) => (c.start === c.end ? `${c.start}행` : `${c.start}–${c.end}행`);

export function setFavicon(color, badge) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color || '#7D8FA3';
  const r = 16;
  g.beginPath();
  g.moveTo(r, 4);
  g.arcTo(60, 4, 60, 60, r);
  g.arcTo(60, 60, 4, 60, r);
  g.arcTo(4, 60, 4, 4, r);
  g.arcTo(4, 4, 60, 4, r);
  g.fill();
  if (badge) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(48, 16, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1A1C21';
    g.beginPath();
    g.arc(48, 16, 8, 0, Math.PI * 2);
    g.fill();
  }
  const link = document.getElementById('favicon');
  if (link) link.href = c.toDataURL('image/png');
}

/**
 * vscode://file/<abs path>[:line], each path segment encoded so ? # % in names can't change the URL.
 * Windows paths come out as vscode://file/C:/Users/… (forward slashes, drive letter kept).
 */
export function vscodeLink(abs, line) {
  const p = String(abs)
    .split(/[\\/]/)
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  return `vscode://file${p.startsWith('/') ? '' : '/'}${p}${line ? ':' + (line | 0) : ''}`;
}

/** Undo for the last send: ⌘Z on Mac; Ctrl+Alt+Z elsewhere (plain Ctrl+Z belongs to the shell). */
export const undoKey = isMac ? '⌘Z' : 'Ctrl+Alt+Z';

/** Short progress facts for rows and cards: plan done/total, running subagents, what it's doing now. */
export function progressOf(t) {
  const a = t?.activity || {};
  const plan = a.plan || [];
  const done = plan.filter((p) => p.status === 'done').length;
  const doing = plan.find((p) => p.status === 'active');
  const subs = a.subagents || [];
  const running = subs.filter((s) => s.status === 'running').length;
  return { plan, done, total: plan.length, doing, subs, running, current: a.current || '' };
}

export const SOURCE_LABEL = { start: '처음 지시', terminal: '터미널', composer: '입력창', remote: '폰(Claude 앱)', outside: '다른 곳에서', import: '불러옴' };
