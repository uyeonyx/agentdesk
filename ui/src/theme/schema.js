// Theme definition shape and its validator. Everything that comes in (built-in, imported, saved)
// passes through normalizeTheme, so later stages only ever see clean hex colors and bounded numbers.
import { parseColor, toHex, over, isDark, WHITE, BLACK } from './color.js';

export class ThemeError extends Error {
  name = 'ThemeError';
}

export const ANSI_NAMES = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];
export const SYNTAX_KEYS = ['keyword', 'string', 'number', 'comment', 'function', 'type', 'tag', 'attr', 'punct', 'variable', 'constant'];
export const SEMANTIC = ['ok', 'warn', 'danger', 'info'];

// Every CSS variable deriveTokens emits, without the leading "--".
export const COLOR_TOKENS = [
  'bg-app', 'bg-surface', 'bg-raised', 'bg-overlay', 'bg-hover', 'bg-active', 'bg-inset',
  'line', 'line-strong', 'text', 'text-2', 'text-3', 'selection', 'focus',
  'accent', 'accent-ink', 'accent-soft', 'accent-line', 'accent-text',
  ...SEMANTIC.flatMap((s) => [s, `${s}-ink`, `${s}-text`, `${s}-soft`, `${s}-line`]),
  'diff-add-bg', 'diff-add-text', 'diff-add-mark', 'diff-del-bg', 'diff-del-text', 'diff-del-mark',
  ...SYNTAX_KEYS.map((k) => `syn-${k}`),
  'term-bg', 'term-fg', 'term-cursor', 'term-selection', ...ANSI_NAMES.map((_, i) => `term-${i}`),
  'glass-tint', 'glass-tint-strong', 'glass-edge', 'glass-shadow', 'glow-color',
  'amb-1', 'amb-2', 'amb-3', 'amb-4',
];
export const VALUE_TOKENS = ['glass-blur', 'glass-sat', 'glow', 'amb-speed'];
export const SHADOW_TOKENS = ['shadow-1', 'shadow-2', 'shadow-3'];
export const TOKEN_NAMES = [...COLOR_TOKENS, ...VALUE_TOKENS, ...SHADOW_TOKENS].map((n) => `--${n}`);

// Glass layers are computed together with text contrast, so they can't be pinned from outside.
export const UI_KEYS = COLOR_TOKENS.filter((n) => !n.startsWith('glass-'));

// VS Code's default terminal palettes: what a terminal shows when a theme leaves a slot empty.
const DEFAULT_ANSI = {
  dark: ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
    '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'],
  light: ['#000000', '#cd3131', '#00bc00', '#949800', '#0451a5', '#bc05bc', '#0598bc', '#555555',
    '#666666', '#cd3131', '#14ce14', '#b5ba00', '#0451a5', '#bc05bc', '#0598bc', '#a5a5a5'],
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);

// Plain single-line text: no control or bidi-override characters.
export function cleanText(v, max) {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(36);
}

export function slugify(name) {
  const s = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  // Names in Korean (or any non-Latin script) still need a stable id.
  return s || `theme-${hash(name)}`;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const URL_RE = /^https?:\/\/[^\s"'<>\\]{1,300}$/;

export function normalizeTheme(input, warnings = []) {
  if (!isObj(input)) throw new ThemeError('테마 형식이 올바르지 않아요');
  const base = isObj(input.base) ? input.base : {};
  const bg0 = parseColor(base.bg);
  const fg0 = parseColor(base.fg);
  if (!bg0 || !fg0) throw new ThemeError('테마에 배경색과 글자색이 있어야 해요');

  // A see-through background means nothing on its own; flatten it the way a window would.
  const bgC = bg0.a < 1 ? over(bg0, input.kind === 'light' ? WHITE : BLACK) : bg0;
  const kind = isDark(bgC) ? 'dark' : 'light';
  if ((input.kind === 'dark' || input.kind === 'light') && input.kind !== kind) {
    warnings.push(`배경 밝기에 맞춰 ${kind === 'dark' ? '어두운' : '밝은'} 테마로 처리했어요`);
  }
  const solid = (v) => {
    const c = parseColor(v);
    return c ? toHex(c.a < 1 ? over(c, bgC) : c) : undefined;
  };
  let dropped = 0;
  const opt = (v, fn = solid) => {
    if (v === undefined || v === null) return undefined;
    const out = fn(v);
    if (!out) dropped++;
    return out;
  };

  const name = cleanText(input.name, 60) ?? '이름 없는 테마';
  const theme = {
    id: typeof input.id === 'string' && ID.test(input.id) ? input.id : slugify(name),
    name,
    kind,
    base: { bg: toHex(bgC), fg: solid(fg0) },
  };
  const author = cleanText(input.author, 80);
  const license = cleanText(input.license, 40);
  const source = typeof input.source === 'string' && URL_RE.test(input.source) ? input.source : undefined;
  if (author) theme.author = author;
  if (license) theme.license = license;
  if (source) theme.source = source;

  const accent = opt(base.accent);
  const cursor = opt(base.cursor);
  // Selection keeps its alpha: it is painted under text.
  const selection = opt(base.selection, (v) => (parseColor(v) ? toHex(parseColor(v)) : undefined));
  if (accent) theme.base.accent = accent;
  if (selection) theme.base.selection = selection;
  if (cursor) theme.base.cursor = cursor;

  const src = Array.isArray(input.ansi) ? input.ansi.slice(0, 16) : [];
  const given = Array.from({ length: 16 }, (_, i) => opt(src[i]));
  const fallback = DEFAULT_ANSI[kind];
  // A missing bright slot copies its normal twin, which is what many 8-color palettes intend.
  theme.ansi = given.map((c, i) => c ?? (i >= 8 ? given[i - 8] : undefined) ?? fallback[i]);
  const missing = given.filter((c) => !c).length;
  if (!src.length) warnings.push('터미널 색이 없어 기본 팔레트를 썼어요');
  else if (missing) warnings.push(`터미널 색 ${missing}개가 비어 있어 채워 넣었어요`);

  if (isObj(input.syntax)) {
    const syntax = {};
    for (const k of SYNTAX_KEYS) if (own(input.syntax, k)) syntax[k] = opt(input.syntax[k]);
    for (const k of Object.keys(syntax)) if (!syntax[k]) delete syntax[k];
    if (Object.keys(syntax).length) theme.syntax = syntax;
  }

  if (isObj(input.ui)) {
    const ui = {};
    for (const k of UI_KEYS) {
      if (!own(input.ui, k)) continue;
      const c = parseColor(input.ui[k]);
      if (c) ui[k] = toHex(c);
      else dropped++;
    }
    if (Object.keys(ui).length) theme.ui = ui;
  }

  if (isObj(input.ambient) && Array.isArray(input.ambient.stops)) {
    const stops = input.ambient.stops.slice(0, 4).map((v) => opt(v)).filter(Boolean);
    if (stops.length >= 2) {
      theme.ambient = { stops };
      const speed = num(input.ambient.speed, 4, 240);
      if (speed) theme.ambient.speed = Math.round(speed * 10) / 10;
    }
  }

  if (isObj(input.glass)) {
    const g = {};
    const alpha = num(input.glass.alpha, 0.3, 1);
    const blur = num(input.glass.blur, 0, 60);
    const sat = num(input.glass.sat, 100, 300);
    if (alpha !== undefined) g.alpha = alpha;
    if (blur !== undefined) g.blur = blur;
    if (sat !== undefined) g.sat = sat;
    if (typeof input.glass.glow === 'boolean') g.glow = input.glass.glow;
    if (Object.keys(g).length) theme.glass = g;
  }

  if (dropped) warnings.push(`잘못된 색 값 ${dropped}개를 건너뛰었어요`);
  return theme;
}
