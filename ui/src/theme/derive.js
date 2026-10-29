// Theme definition -> the full token set the UI, xterm and Monaco consume.
// The theme supplies a handful of colors; everything else is derived here, then text colors are
// nudged (OKLCH lightness only, hue kept) until they pass WCAG against every surface they can land on.
import {
  parseColor, toCss, toHex, toRgba, withAlpha, mix, over, contrast, ensureContrast, toOklch, fromOklch, shiftL, WHITE, BLACK,
} from './color.js';
import { normalizeTheme, SYNTAX_KEYS, ANSI_NAMES } from './schema.js';

const AA = 4.5;
const LARGE = 3;
// Primary text aims higher than the AA floor so it stays visibly above --text-2 even in low-contrast themes.
const PRIMARY = 6;
// Aim slightly above each bar so 8-bit rounding and the browser's own blending never dip below it.
const MARGIN = 0.06;

const GLASS = {
  rich: { lift: 0, blur: 1, sat: 1 },
  light: { lift: 0.16, blur: 0.57, sat: 0.5 },
  off: null,
};

const worst = (c, bgs) => Math.min(...bgs.map((b) => contrast(c, b)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hueDist = (a, b) => {
  const d = Math.abs(toOklch(a).h - toOklch(b).h) % 360;
  return Math.min(d, 360 - d);
};

// Ink for a filled color: the theme's own bg/fg when one reads well on it, else plain black/white.
function inkOn(fill, bg, fg, preferred) {
  if (preferred && contrast(preferred, fill) >= AA + MARGIN) return preferred;
  const own = [bg, fg].filter((c) => contrast(c, fill) >= AA + MARGIN).sort((x, y) => contrast(y, fill) - contrast(x, fill));
  return own[0] ?? (contrast(WHITE, fill) >= contrast(BLACK, fill) ? WHITE : BLACK);
}

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

// Aurora from the accent plus two palette hues that sit near it on the wheel (calm, not clashing).
function autoAmbient(accent, ansi) {
  const picked = [accent];
  const pool = [5, 6, 4, 2, 13, 14, 12, 10].map((i) => ansi[i]).filter((c) => toOklch(c).C >= 0.05);
  while (picked.length < 3) {
    const options = pool.filter((c) => picked.every((p) => hueDist(c, p) >= 30));
    if (!options.length) break;
    options.sort((x, y) => Math.abs(hueDist(x, accent) - 80) - Math.abs(hueDist(y, accent) - 80));
    picked.push(options[0]);
  }
  const o = toOklch(accent);
  // Monochrome palettes: rotate the accent instead.
  while (picked.length < 3) picked.push(fromOklch({ L: o.L, C: Math.max(o.C, 0.09), h: o.h + 70 * picked.length }));
  return picked;
}

// The aurora is a backdrop: muted on dark themes, airy pastel on light ones (a mid-tone wash on a
// light theme only grays it).
function tameAmbient(c, dark) {
  const o = toOklch(c);
  return dark
    ? fromOklch({ ...o, L: clamp(o.L, 0.4, 0.6) })
    : fromOklch({ ...o, L: clamp(o.L, 0.88, 0.95), C: Math.min(o.C, 0.1) });
}

function shadow(layers, color) {
  return layers.map(([y, blur, a]) => `0 ${y ? `${y}px` : 0} ${blur}px ${toRgba(withAlpha(color, a))}`).join(', ');
}

export function deriveTokens(input, { glass = 'rich' } = {}) {
  const t = normalizeTheme(input);
  const dark = t.kind === 'dark';
  const P = parseColor;
  const ui = (name, fallback) => (t.ui?.[name] ? P(t.ui[name]) : fallback);
  const solid = (c, under) => (c.a < 1 ? over(c, under) : c);
  const bg = P(t.base.bg);
  const fg = P(t.base.fg);
  const ansi = t.ansi.map(P);

  // Surfaces. Content panels keep the theme's own background so editor and terminal match it exactly.
  const surface = solid(ui('bg-surface', bg), bg);
  const app = solid(ui('bg-app', shiftL(surface, dark ? -0.03 : -0.035)), surface);
  const raised = solid(ui('bg-raised', dark ? shiftL(surface, 0.035) : mix(surface, WHITE, 0.7)), surface);
  const overlay = solid(ui('bg-overlay', dark ? shiftL(surface, 0.055) : mix(surface, WHITE, 0.85)), surface);
  const inset = solid(ui('bg-inset', shiftL(surface, dark ? -0.018 : -0.022)), surface);
  const hover = ui('bg-hover', withAlpha(fg, dark ? 0.065 : 0.05));
  const active = ui('bg-active', withAlpha(fg, dark ? 0.11 : 0.085));
  const line = ui('line', withAlpha(fg, dark ? 0.1 : 0.12));
  const lineStrong = ui('line-strong', withAlpha(fg, dark ? 0.17 : 0.2));

  const accent = solid(ui('accent', P(t.base.accent) ?? statusColor(ansi[4], ansi[12], surface)), surface);

  // Ambient aurora behind the glass.
  const stops = (t.ambient?.stops.map(P) ?? autoAmbient(accent, ansi)).map((c) => tameAmbient(c, dark));
  const amb = [stops[0], stops[1], stops[2] ?? mix(stops[0], stops[1], 0.5), stops[3] ?? mix(stops[1], stops[2] ?? stops[0], 0.5)]
    .map((c, i) => solid(ui(`amb-${i + 1}`, c), app));

  // Glass. 'off' means opaque bars; 'light' trades blur for a denser tint.
  const g = Object.hasOwn(GLASS, glass) ? GLASS[glass] : GLASS.rich;
  const baseAlpha = g ? Math.min(1, (t.glass?.alpha ?? (dark ? 0.62 : 0.58)) + g.lift) : 1;
  const blur = g ? Math.round((t.glass?.blur ?? 28) * g.blur) : 0;
  const sat = g ? Math.round(100 + ((t.glass?.sat ?? 180) - 100) * g.sat) : 100;

  // Text has to read on panels, cards, menus, hover rows and on glass over the brightest aurora stop.
  const text0 = solid(ui('text', fg), surface);
  // Secondary text stays close to the primary: gray-on-gray is what makes a screen look dull.
  const text20 = solid(ui('text-2', mix(fg, surface, 0.24)), surface);
  const text30 = solid(ui('text-3', mix(fg, surface, 0.44)), surface);
  // Light glass is frosted white, not a veil of the (grayer) window background.
  const glassBase = dark ? app : mix(app, WHITE, 0.6);
  const solve = (alpha) => {
    const tint = withAlpha(glassBase, alpha);
    // Cards floating over the conversation, and menus/sheets/popovers floating over everything:
    // blurred behind, but nearly solid, so what they say reads at once.
    const strong = withAlpha(raised, Math.min(1, Math.max(alpha + 0.24, 0.86)));
    const float = withAlpha(overlay, Math.min(1, Math.max(alpha + 0.3, 0.92)));
    const glassBgs = [app, ...amb].flatMap((b) => [over(tint, b), over(strong, b), over(float, b)]);
    const bgs = [
      surface, raised, overlay, inset, over(hover, surface), over(hover, raised), over(active, surface),
      ...glassBgs, ...glassBgs.map((b) => over(hover, b)),
    ];
    const text = ensureContrast(text0, bgs, PRIMARY);
    const text2 = ensureContrast(text20, bgs, AA + MARGIN);
    const text3 = ensureContrast(text30, bgs, LARGE + MARGIN);
    const ok = worst(text, bgs) >= AA && worst(text2, bgs) >= AA && worst(text3, bgs) >= LARGE;
    return { alpha, tint, strong, float, text, text2, text3, ok };
  };
  // If no text color can win on the aurora, thicken the glass rather than give up readability.
  let s = solve(baseAlpha);
  while (!s.ok && s.alpha < 0.96) s = solve(Math.min(0.96, s.alpha + 0.04));

  // Code keeps the theme's own foreground; it only has to read on the editor panel.
  const codeFg = ensureContrast(text0, [surface], AA + MARGIN);
  const onSurfaces = (extra = []) => [surface, raised, overlay, ...extra];
  const accentSoft = ui('accent-soft', withAlpha(accent, dark ? 0.16 : 0.12));
  const accentText = ensureContrast(solid(ui('accent-text', accent), surface), onSurfaces([over(accentSoft, surface)]), AA + MARGIN);
  const focus = ensureContrast(solid(ui('focus', accent), surface), [surface, raised, app], LARGE + MARGIN);

  const vars = {};
  const set = (name, c) => (vars[`--${name}`] = toCss(c));
  set('bg-app', app);
  set('bg-surface', surface);
  set('bg-raised', raised);
  set('bg-overlay', overlay);
  set('bg-hover', hover);
  set('bg-active', active);
  set('bg-inset', inset);
  set('line', line);
  set('line-strong', lineStrong);
  set('text', s.text);
  set('text-2', s.text2);
  set('text-3', s.text3);
  const sel0 = ui('selection', P(t.base.selection) ?? withAlpha(accent, dark ? 0.32 : 0.24));
  // ::selection over glass and cards: an opaque theme selection would hide what's under it.
  const selection = sel0.a < 1 ? sel0 : withAlpha(sel0, 0.7);
  set('selection', selection);
  set('focus', focus);
  set('accent', accent);
  set('accent-ink', inkOn(accent, bg, fg, ui('accent-ink')));
  set('accent-soft', accentSoft);
  set('accent-line', ui('accent-line', withAlpha(accent, 0.5)));
  set('accent-text', accentText);

  const status = { ok: 2, warn: 3, danger: 1, info: 4 };
  const statusBase = {};
  for (const [name, i] of Object.entries(status)) {
    const c = solid(ui(name, statusColor(ansi[i], ansi[i + 8], surface)), surface);
    const soft = ui(`${name}-soft`, withAlpha(c, dark ? 0.14 : 0.12));
    statusBase[name] = c;
    set(name, c);
    set(`${name}-ink`, inkOn(c, bg, fg, ui(`${name}-ink`)));
    set(`${name}-text`, ensureContrast(solid(ui(`${name}-text`, c), surface), onSurfaces([over(soft, surface)]), AA + MARGIN));
    set(`${name}-soft`, soft);
    set(`${name}-line`, ui(`${name}-line`, withAlpha(c, 0.5)));
    // For a solid tag or badge: the same hue, bright enough on any theme to be seen from across the
    // room (a light theme's amber is dark so that it reads as text, which turns brown as a fill).
    const o = toOklch(c);
    const fill = solid(ui(`${name}-fill`, o.L >= 0.74 ? c : fromOklch({ ...o, L: 0.8, C: o.C < 0.04 ? o.C : Math.max(o.C, 0.16) })), surface);
    set(`${name}-fill`, fill);
    set(`${name}-fill-ink`, inkOn(fill, bg, fg, ui(`${name}-fill-ink`)));
  }

  // Diff: line tint, a stronger word-level mark on top of it, and +/- text that reads on both.
  const diff = {};
  for (const [kind, c] of [['add', statusBase.ok], ['del', statusBase.danger]]) {
    const lineBg = ui(`diff-${kind}-bg`, withAlpha(c, dark ? 0.14 : 0.13));
    const mark = ui(`diff-${kind}-mark`, withAlpha(c, dark ? 0.32 : 0.28));
    diff[kind] = { bg: lineBg, mark };
    const under = over(lineBg, surface);
    set(`diff-${kind}-bg`, lineBg);
    set(`diff-${kind}-text`, ensureContrast(solid(ui(`diff-${kind}-text`, c), surface), [surface, under, over(mark, under)], AA + MARGIN));
    set(`diff-${kind}-mark`, mark);
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

  // Glass layers. The shadow is tinted toward the theme on light backgrounds so it isn't dirty gray.
  const so = toOklch(surface);
  const shade = dark ? BLACK : fromOklch({ L: 0.28, C: Math.min(so.C, 0.05), h: so.h });
  vars['--glass-tint'] = toRgba(s.tint);
  vars['--glass-tint-strong'] = toRgba(s.strong);
  vars['--glass-float'] = toRgba(s.float);
  vars['--glass-blur'] = `${blur}px`;
  vars['--glass-sat'] = `${sat}%`;
  vars['--glass-edge'] = toRgba(withAlpha(WHITE, dark ? (g ? 0.09 : 0.05) : g ? 0.7 : 0.5));
  vars['--glass-shadow'] = toRgba(withAlpha(shade, dark ? 0.45 : 0.14));
  vars['--glow'] = t.glass?.glow ? '1' : '0';
  set('glow-color', ui('glow-color', withAlpha(accent, 0.55)));
  amb.forEach((c, i) => set(`amb-${i + 1}`, c));
  vars['--amb-speed'] = `${t.ambient?.speed ?? 40}s`;

  const k = dark ? 1 : 0.32;
  vars['--shadow-1'] = shadow([[1, 2, 0.3 * k]], shade);
  vars['--shadow-2'] = shadow([[2, 6, 0.24 * k], [8, 24, 0.3 * k]], shade);
  vars['--shadow-3'] = shadow([[4, 12, 0.26 * k], [24, 64, 0.48 * k]], shade);

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
      'editorLineNumber.foreground': hex(s.text3),
      'editorLineNumber.activeForeground': hex(s.text2),
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

  return { kind: t.kind, vars, xterm, monaco, chrome: { bg: hex(app), fg: hex(s.text) } };
}
