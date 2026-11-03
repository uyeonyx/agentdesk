// Theme definition -> the full token set: the app's palette (palette.js lays the theme onto the roles
// of base.js), the terminal (xterm), the editor (Monaco) and syntax tokens.
import {
  parseColor, toCss, toHex, withAlpha, mix, over, contrast, ensureContrast, toOklch, shiftL, WHITE,
} from './color.js';
import { normalizeTheme, SYNTAX_KEYS, ANSI_NAMES } from './schema.js';
import { uiVars } from './base.js';
import { themePalette } from './palette.js';
import { accentSet } from './accents.js';

const AA = 4.5;
const LARGE = 3;
// Secondary and tertiary text: small labels, times and paths have to read, not just be there.
const SECONDARY = 5.6;
// Aim slightly above each bar so 8-bit rounding and the browser's own blending never dip below it.
const MARGIN = 0.06;

const hueDist = (a, b) => {
  const d = Math.abs(toOklch(a).h - toOklch(b).h) % 360;
  return Math.min(d, 360 - d);
};

// Status colors use the normal ANSI slot, the theme's canonical red/green/...; the bright twin only
// steps in when the normal one is too dim to see on the surface and really is the same hue
// (Solarized, for one, maps "bright green" to a gray).
function statusColor(normal, bright, surface) {
  if (contrast(normal, surface) >= LARGE) return normal;
  const n = toOklch(normal);
  const b = toOklch(bright);
  const sameFamily = b.C >= n.C * 0.6 && b.C > 0.04 && hueDist(normal, bright) < 30;
  return sameFamily && contrast(bright, surface) > contrast(normal, surface) ? bright : normal;
}

export function deriveTokens(input, { accent: accentId = null } = {}) {
  const t = normalizeTheme(input);
  const dark = t.kind === 'dark';
  const P = parseColor;
  const ui = (name, fallback) => (t.ui?.[name] ? P(t.ui[name]) : fallback);
  const solid = (c, under) => (c.a < 1 ? over(c, under) : c);
  const bg = P(t.base.bg);
  const fg = P(t.base.fg);
  const ansi = t.ansi.map(P);

  // The code panel: the theme's own background, lines and text, so the editor matches the terminal.
  const surface = solid(ui('bg-surface', bg), bg);
  const inset = solid(ui('bg-inset', shiftL(surface, dark ? -0.018 : -0.022)), surface);
  const overlay = solid(ui('bg-overlay', dark ? shiftL(surface, 0.055) : mix(surface, WHITE, 0.85)), surface);
  const hover = ui('bg-hover', withAlpha(fg, dark ? 0.065 : 0.05));
  const line = ui('line', withAlpha(fg, dark ? 0.1 : 0.12));
  const lineStrong = ui('line-strong', withAlpha(fg, dark ? 0.17 : 0.2));
  const accent = solid(ui('accent', P(t.base.accent) ?? statusColor(ansi[4], ansi[12], surface)), surface);
  const text0 = solid(ui('text', fg), surface);
  const text2 = ensureContrast(solid(ui('text-2', mix(fg, surface, 0.2)), surface), [surface], SECONDARY + MARGIN);
  const text3 = ensureContrast(solid(ui('text-3', mix(fg, surface, 0.38)), surface), [surface], AA + MARGIN);
  const codeFg = ensureContrast(text0, [surface], AA + MARGIN);
  const accentSoft = ui('accent-soft', withAlpha(accent, dark ? 0.16 : 0.12));
  const focus = ensureContrast(solid(ui('focus', accent), surface), [surface], LARGE + MARGIN);
  const sel0 = ui('selection', P(t.base.selection) ?? withAlpha(accent, dark ? 0.32 : 0.24));
  const selection = sel0.a < 1 ? sel0 : withAlpha(sel0, 0.7);

  const vars = {};
  const set = (name, c) => (vars[`--${name}`] = toCss(c));

  // Diff in the editor: line tint and a stronger word-level mark, in the theme's own red and green.
  const diff = {};
  for (const [kind, i] of [['add', 2], ['del', 1]]) {
    const c = solid(ui(kind === 'add' ? 'ok' : 'danger', statusColor(ansi[i], ansi[i + 8], surface)), surface);
    diff[kind] = { bg: ui(`diff-${kind}-bg`, withAlpha(c, dark ? 0.14 : 0.13)), mark: ui(`diff-${kind}-mark`, withAlpha(c, dark ? 0.32 : 0.28)) };
  }

  // Syntax: the theme's own colors, else the usual ANSI roles. Only a floor is enforced here:
  // real themes keep comments quiet on purpose, but a token that vanishes into the bg is a bug.
  const synFallback = {
    keyword: ansi[5], string: ansi[2], number: ansi[3], comment: ansi[8], function: ansi[4], type: ansi[6],
    tag: ansi[1], attr: ansi[3], punct: mix(fg, surface, 0.25), variable: fg, constant: ansi[11],
  };
  const syn = {};
  for (const k of SYNTAX_KEYS) {
    const c = solid(ui(`syn-${k}`, P(t.syntax?.[k]) ?? synFallback[k]), surface);
    syn[k] = ensureContrast(c, [surface, inset], k === 'comment' ? 2.5 : LARGE);
    set(`syn-${k}`, syn[k]);
  }

  // Terminal: the palette as given; only the default foreground is held to AA.
  const termBg = solid(ui('term-bg', surface), surface);
  const termFg = ensureContrast(solid(ui('term-fg', fg), termBg), [termBg], AA + MARGIN);
  const termCursor = solid(ui('term-cursor', P(t.base.cursor) ?? fg), termBg);
  const termSel = ui('term-selection', P(t.base.selection) ?? withAlpha(accent, 0.3));
  const term = ansi.map((c, i) => solid(ui(`term-${i}`, c), termBg));
  set('term-bg', termBg);
  set('term-fg', termFg);
  set('term-cursor', termCursor);
  set('term-selection', termSel);
  term.forEach((c, i) => set(`term-${i}`, c));

  const hex = toHex;
  const hex6 = (c) => toHex(c).slice(1, 7);
  const xterm = {
    background: hex(termBg),
    foreground: hex(termFg),
    cursor: hex(termCursor),
    cursorAccent: hex(termBg),
    selectionBackground: hex(termSel),
    selectionInactiveBackground: hex(withAlpha(termSel, termSel.a * 0.6)),
  };
  ANSI_NAMES.forEach((n, i) => (xterm[n] = hex(term[i])));

  const rule = (token, c, fontStyle) => (fontStyle ? { token, foreground: hex6(c), fontStyle } : { token, foreground: hex6(c) });
  const monaco = {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: hex6(codeFg), background: hex6(surface) },
      rule('comment', syn.comment, 'italic'),
      rule('string', syn.string),
      rule('string.escape', syn.constant),
      rule('number', syn.number),
      rule('keyword', syn.keyword),
      rule('type', syn.type),
      rule('type.identifier', syn.type),
      rule('function', syn.function),
      rule('predefined', syn.function),
      rule('variable', syn.variable),
      rule('identifier', syn.variable),
      rule('constant', syn.constant),
      rule('tag', syn.tag),
      rule('metatag', syn.tag),
      rule('attribute.name', syn.attr),
      rule('attribute.value', syn.string),
      rule('delimiter', syn.punct),
      rule('operator', syn.punct),
      rule('regexp', syn.constant),
    ],
    colors: {
      'editor.background': hex(surface),
      'editor.foreground': hex(codeFg),
      'editorLineNumber.foreground': hex(text3),
      'editorLineNumber.activeForeground': hex(text2),
      'editorCursor.foreground': hex(termCursor),
      'editor.selectionBackground': hex(selection),
      'editor.inactiveSelectionBackground': hex(withAlpha(selection, selection.a * 0.5)),
      'editor.lineHighlightBackground': hex(hover),
      'editor.lineHighlightBorder': '#00000000',
      'editorGutter.background': hex(surface),
      'editorIndentGuide.background1': hex(line),
      'editorIndentGuide.activeBackground1': hex(lineStrong),
      'editorWhitespace.foreground': hex(lineStrong),
      'editorBracketMatch.background': hex(accentSoft),
      'editorBracketMatch.border': hex(withAlpha(accent, 0.5)),
      'editorWidget.background': hex(overlay),
      'editorWidget.border': hex(lineStrong),
      'editorOverviewRuler.border': '#00000000',
      'diffEditor.insertedTextBackground': hex(diff.add.mark),
      'diffEditor.removedTextBackground': hex(diff.del.mark),
      'diffEditor.insertedLineBackground': hex(diff.add.bg),
      'diffEditor.removedLineBackground': hex(diff.del.bg),
      'diffEditorGutter.insertedLineBackground': hex(diff.add.bg),
      'diffEditorGutter.removedLineBackground': hex(diff.del.bg),
      'scrollbarSlider.background': hex(lineStrong),
      'scrollbarSlider.hoverBackground': hex(withAlpha(fg, dark ? 0.24 : 0.28)),
      'scrollbarSlider.activeBackground': hex(withAlpha(fg, dark ? 0.32 : 0.36)),
      focusBorder: hex(focus),
    },
  };

  // The app's surfaces, lines, text and signals: the theme laid onto the palette's roles.
  const pal = themePalette(t);
  const own = uiVars(t.kind, accentSet(accentId, t.kind, pal), pal);
  Object.assign(vars, own);
  return { kind: t.kind, vars, xterm, monaco, chrome: { bg: own['--chrome'], fg: own['--text'] } };
}
