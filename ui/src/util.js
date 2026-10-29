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

export const SOURCE_LABEL = { start: '처음 지시', terminal: '터미널', composer: '입력창', remote: '폰', outside: '다른 곳', import: '불러온 세션', answer: '답변', queue: 'Codex 대기열' };
