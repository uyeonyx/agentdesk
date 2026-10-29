// Markdown → plain tree ({ t:'tag'|'text', tag?, props?, kids?, text? }). Agent text is untrusted:
// only tags and props created here ever reach the DOM, links are http(s) only, raw HTML stays text.
import { marked } from 'marked';
import { lru } from './lru.js';

const T = (text) => ({ t: 'text', text });
const E = (tag, props, kids) => {
  const n = { t: 'tag', tag };
  if (props) n.props = props;
  if (kids) n.kids = kids;
  return n;
};

// marked leaves named entities as written; text nodes need the characters.
const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', middot: '·', bull: '•', times: '×', divide: '÷', deg: '°',
  plusmn: '±', le: '≤', ge: '≥', ne: '≠', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};
function decode(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return ENT[name] ?? m;
    const cp = dec ? +dec : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : '�';
  });
}

/** http(s) only, normalized; anything else (javascript:, data:, file:, relative) is not a link. */
function safeUrl(href) {
  try {
    const u = new URL(decode(String(href ?? '').trim()));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// File refs in inline code. Bare names (no slash) need a known extension so `console.log` or
// `process.env` stay code; framework names like `Next.js` are prose, not files.
const REF = /^((?:[A-Za-z]:[\\/]|~?\/|\.{1,2}[\\/])?(?:[\w@$+.()[\]-]+[\\/])*[\w@$+.()[\]-]*[\w@$+()[\]-]\.([A-Za-z0-9]{1,8}))(?::(\d+)(?:-(\d+)|:\d+)?)?$/;
const EXT = new Set(
  ('md mdx txt json jsonc json5 yaml yml toml ini cfg conf lock js mjs cjs jsx ts mts cts tsx py pyi rb go rs java kt kts ' +
    'swift c h cc cpp cxx hpp hh cs php css scss sass less html htm vue svelte astro sh bash zsh fish ps1 bat sql xml ' +
    'svg plist gradle dart lua ex exs scala proto graphql gql tf hcl nix zig ipynb csv tsv').split(' '),
);
const PROSE = /^(node|next|vue|nuxt|express|three|d3|chart|react|deno|bun|solid|ember|backbone|alpine)\.js$/i;
const DOMAIN = /^(?:www\.)?[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|app|ai|co|kr)[\\/]/i;

/** `src/app.ts:12-20` → { path:'src/app.ts', line:12, end:20 }; null when it doesn't look like a file. */
export function fileRefOf(text) {
  const s = String(text ?? '').trim();
  if (!s || s.length > 300 || /^\w+:\/\//.test(s)) return null;
  const m = REF.exec(s);
  if (!m) return null;
  const [, path, ext, line, end] = m;
  if (!/[A-Za-z]/.test(ext)) return null; // `v1.2`, `1/2.5`
  if (/[\\/]/.test(path) ? DOMAIN.test(path) : !EXT.has(ext.toLowerCase()) || PROSE.test(path)) return null;
  return { path, line: line ? +line : null, end: end ? +end : null };
}

// Appends n (node, array, or null) to out, merging adjacent text so the tree stays small.
function push(out, n) {
  if (!n) return out;
  if (Array.isArray(n)) {
    for (const x of n) push(out, x);
    return out;
  }
  const last = out[out.length - 1];
  if (n.t === 'text' && last?.t === 'text') out[out.length - 1] = T(last.text + n.text);
  else out.push(n);
  return out;
}

const checkbox = (tk) => E('input', { type: 'checkbox', checked: !!tk.checked, disabled: true });

function link(href, kids, title) {
  const url = safeUrl(href);
  if (!url) return kids; // label only
  const props = { href: url, rel: 'noopener noreferrer', target: '_blank' };
  if (title) props.title = decode(title);
  return E('a', props, kids);
}

function inline(tokens = [], inLink = false) {
  const out = [];
  for (const tk of tokens) push(out, inl(tk, inLink));
  return out;
}

function inl(tk, inLink) {
  switch (tk.type) {
    case 'text':
      return tk.tokens ? inline(tk.tokens, inLink) : T(decode(tk.text));
    case 'escape':
      return T(tk.text);
    case 'strong':
    case 'em':
    case 'del':
      return E(tk.type, null, inline(tk.tokens, inLink));
    case 'codespan': {
      // No buttons inside links: nested interactive elements misbehave.
      const ref = !inLink && fileRefOf(tk.text);
      return ref ? E('fileref', ref, [T(tk.text)]) : E('code', null, [T(tk.text)]);
    }
    case 'br':
      return E('br');
    case 'link':
      return link(tk.href, inline(tk.tokens, true), tk.title);
    case 'image': {
      // Never load images: remote fetches leak and CSP blocks them anyway.
      const alt = decode(tk.text || '');
      return safeUrl(tk.href) ? link(tk.href, [T(alt || tk.href)]) : alt ? T(alt) : null;
    }
    case 'html':
      return T(tk.text);
    case 'checkbox':
      return checkbox(tk);
    default:
      return tk.raw ? T(tk.raw) : null;
  }
}

function blocks(tokens = []) {
  const out = [];
  for (const tk of tokens) push(out, block(tk));
  return out;
}

function block(tk) {
  switch (tk.type) {
    case 'heading':
      return E('h' + Math.min(Math.max(tk.depth, 1), 4), null, inline(tk.tokens));
    case 'paragraph':
      return E('p', null, inline(tk.tokens));
    case 'text': // tight list items hold bare inline runs
      return tk.tokens ? inline(tk.tokens) : T(decode(tk.text));
    case 'code':
      return E('codeblock', { lang: (tk.lang || '').trim().split(/\s/)[0], code: tk.text });
    case 'blockquote':
      return E('blockquote', null, blocks(tk.tokens));
    case 'hr':
      return E('hr');
    case 'list': {
      const start = tk.ordered && typeof tk.start === 'number' && tk.start !== 1 ? { start: tk.start } : null;
      return E(tk.ordered ? 'ol' : 'ul', start, tk.items.map((it) => E('li', it.task ? { class: 'task' } : null, blocks(it.tokens))));
    }
    case 'table':
      return table(tk);
    case 'html':
      return E('p', null, [T(tk.text.replace(/\n+$/, ''))]);
    case 'checkbox':
      return checkbox(tk);
    case 'space':
    case 'def':
      return null;
    default:
      return tk.raw ? E('p', null, [T(tk.raw)]) : null;
  }
}

function table(tk) {
  const cell = (tag) => (c, i) => {
    const align = c.align ?? tk.align?.[i];
    return E(tag, align ? { align } : null, inline(c.tokens));
  };
  const kids = [E('thead', null, [E('tr', null, tk.header.map(cell('th')))])];
  if (tk.rows.length) kids.push(E('tbody', null, tk.rows.map((r) => E('tr', null, r.map(cell('td'))))));
  // Wide tables scroll inside their own box instead of stretching the conversation.
  return E('div', { class: 'tablewrap' }, [E('table', null, kids)]);
}

const cache = lru(200);

/** Markdown → plain tree, memoized by input. Returned trees are shared: don't mutate them. */
export function mdTree(md) {
  const src = String(md ?? '');
  const hit = cache.get(src);
  if (hit) return hit;
  let tree;
  try {
    tree = blocks(marked.lexer(src, { gfm: true }));
  } catch {
    tree = src ? [E('p', null, [T(src)])] : [];
  }
  return cache.set(src, tree);
}
