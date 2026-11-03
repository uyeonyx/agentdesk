// A theme laid onto the app's palette (base.js): the same roles, the same steps between them and the
// same contrast floors as the hand-set screens, filled with the theme's own colors. So Dracula looks
// like Dracula everywhere, and still reads as cleanly as Desk's own screens. Desk Light and Desk Dark
// are the hand-set screens themselves.
import { parseColor, toHex, toRgba, withAlpha, mix, over, contrast, ensureContrast, toOklch, fromOklch, shiftL, WHITE } from './color.js';
import { BASE } from './base.js';

const OWN = { 'desk-glass-light': 'light', 'desk-glass-dark': 'dark' };
const M = 0.06; // aim a little above each floor: 8-bit rounding never dips below it

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hueDist = (a, b) => {
  const d = Math.abs(toOklch(a).h - toOklch(b).h) % 360;
  return Math.min(d, 360 - d);
};

// The theme's canonical red/green/yellow; the bright twin only when the normal one is too dim to see
// and really is the same hue (Solarized maps "bright green" to a gray).
function statusColor(normal, bright, surface) {
  if (contrast(normal, surface) >= 3) return normal;
  const n = toOklch(normal);
  const b = toOklch(bright);
  const same = b.C >= n.C * 0.6 && b.C > 0.04 && hueDist(normal, bright) < 30;
  return same && contrast(bright, surface) > contrast(normal, surface) ? bright : normal;
}

/** The palette for a normalized theme: every key of BASE.light, as hex or rgba() strings. */
export function themePalette(t) {
  if (OWN[t.id]) return BASE[OWN[t.id]];
  const dark = t.kind === 'dark';
  const P = parseColor;
  const ui = (k) => (t.ui?.[k] ? P(t.ui[k]) : null);
  const solid = (c, under) => (c.a < 1 ? over(c, under) : c);
  const fg = P(t.base.fg);
  const ansi = t.ansi.map(P);

  // Surfaces: the theme's background is the panels; the window behind them sits a step darker on
  // both kinds (light themes: the way white cards sit on a tinted desk), the chrome in between.
  const surface = solid(ui('bg-surface') ?? P(t.base.bg), P(t.base.bg));
  const bg = solid(ui('bg-app') ?? shiftL(surface, dark ? -0.035 : -0.022), surface);
  const chrome = mix(bg, surface, dark ? 0.3 : 0.55);
  const surface2 = dark ? shiftL(surface, 0.03) : shiftL(surface, -0.03);
  const hover = mix(surface, fg, dark ? 0.07 : 0.045);
  const pressed = mix(surface, fg, dark ? 0.11 : 0.08);
  const line = mix(surface, fg, dark ? 0.13 : 0.11);
  const line2 = mix(surface, fg, dark ? 0.24 : 0.22);
  const win = dark ? shiftL(bg, -0.02) : shiftL(surface, -0.04);

  // Accent: the theme's own, filled so its ink (white or near-black) reads on it.
  let fill = solid(ui('accent') ?? (t.base.accent ? P(t.base.accent) : statusColor(ansi[4], ansi[12], surface)), surface);
  const deep = P(dark ? '#0d1424' : '#1a1e26');
  const ink = contrast(WHITE, fill) >= contrast(deep, fill) ? WHITE : deep;
  fill = ensureContrast(fill, [ink], 4.5 + M);
  let soft = mix(surface, fill, dark ? 0.2 : 0.1);
  const mark = dark ? fromOklch({ ...toOklch(fill), L: clamp(toOklch(fill).L, 0.7, 0.85) }) : fill;

  // Signals: the theme's yellow, green and red, brought to one strength (clear dots, not neon).
  const sig = (name, i) => {
    const c0 = solid(ui(name) ?? statusColor(ansi[i], ansi[i + 8], surface), surface);
    const o = toOklch(c0);
    return fromOklch({ ...o, L: dark ? clamp(o.L, 0.68, 0.84) : clamp(o.L, 0.6, 0.78), C: Math.max(o.C, 0.12) });
  };
  const warn = sig('warn', 3);
  const ok = sig('ok', 2);
  const danger = sig('danger', 1);
  const softOf = (c) => mix(surface, c, dark ? 0.16 : 0.12);
  const warnSoft = softOf(warn);
  const okSoft = softOf(ok);
  const dangerSoft = softOf(danger);
  const warnWin = mix(surface, warn, dark ? 0.17 : 0.26);
  // "Working" and "your reply" are the accent, unless the accent is the waiting color's hue (Gruvbox's
  // orange): then the theme's blue, so the two never read alike.
  const info = hueDist(mark, warn) < 40 || hueDist(mark, ok) < 30 ? sig('info', 4) : mark;
  const infoWin = mix(surface, info, dark ? 0.2 : 0.16);

  // Text: primary at 7:1, secondary at 5.6:1, small tertiary at 4.5:1, on every place it can sit.
  const grounds = [surface, chrome, bg, surface2, hover, pressed];
  const text = ensureContrast(ui('text') ?? fg, [...grounds, soft], 7);
  const text2 = ensureContrast(ui('text-2') ?? mix(fg, surface, 0.18), [...grounds, soft, win, warnWin, infoWin], 5.6 + M);
  // A pale accent wash can't hold small gray text: thin it until it does.
  let text3 = ensureContrast(ui('text-3') ?? mix(fg, surface, 0.36), grounds, 4.5 + M);
  for (let r = dark ? 0.2 : 0.1; contrast(text3, soft) < 4.5 + M && r > 0.05; ) soft = mix(surface, fill, (r -= 0.02));
  text3 = ensureContrast(text3, [...grounds, soft], 4.5 + M);
  const readOn = (c, more = []) => ensureContrast(c, [surface, surface2, ...more], 4.5 + M);
  const accentText = readOn(ui('accent-text') ?? fill, [soft]);

  // Activity kinds (edit, command, web) from the theme's blue, magenta and cyan, kept apart in hue.
  const acts = [];
  for (const c of [ansi[4], ansi[5], ansi[6]]) {
    const o = toOklch(c);
    let col = fromOklch({ ...o, L: dark ? 0.72 : 0.6, C: Math.max(o.C, 0.13) });
    for (let k = 0; k < 6 && acts.some((x) => hueDist(x, col) < 50); k++) col = fromOklch({ ...toOklch(col), h: (toOklch(col).h + 60) % 360 });
    acts.push(ensureContrast(col, [surface], 3));
  }

  const so = toOklch(surface);
  const shade = dark ? P('#000000') : fromOklch({ L: 0.28, C: Math.min(so.C, 0.05), h: so.h });
  const ring = dark ? withAlpha(fg, 0.07) : withAlpha(shade, 0.07);
  const sh = (c, a) => toRgba(withAlpha(c, a));
  const H = toHex;
  return {
    bg: H(bg),
    chrome: H(chrome),
    surface: H(surface),
    'surface-2': H(surface2),
    hover: H(hover),
    pressed: H(pressed),
    line: H(line),
    'line-2': H(line2),
    text: H(text),
    'text-2': H(text2),
    'text-3': H(text3),
    'accent-fill': H(fill),
    'accent-fill-ink': H(ink),
    'accent-text': H(accentText),
    'accent-soft': H(soft),
    'accent-line': H(ensureContrast(fill, [surface], 3 + M)),
    'accent-mark': H(mark),
    warn: H(warn),
    'warn-text': H(readOn(warn, [warnSoft, warnWin])),
    'warn-soft': H(warnSoft),
    info: H(info),
    ok: H(ok),
    'ok-text': H(readOn(ok, [okSoft])),
    'ok-soft': H(okSoft),
    danger: H(danger),
    'danger-text': H(readOn(danger, [dangerSoft])),
    'danger-soft': H(dangerSoft),
    idle: H(mix(surface, fg, dark ? 0.4 : 0.26)),
    'code-bg': H(surface2),
    'user-bg': H(soft),
    'add-bg': H(okSoft),
    'add-mark': H(mix(surface, ok, dark ? 0.3 : 0.26)),
    add: H(readOn(ok, [okSoft, mix(surface, ok, dark ? 0.3 : 0.26)])),
    'del-bg': H(dangerSoft),
    'del-mark': H(mix(surface, danger, dark ? 0.3 : 0.26)),
    del: H(readOn(danger, [dangerSoft, mix(surface, danger, dark ? 0.3 : 0.26)])),
    win: H(win),
    'warn-win': H(warnWin),
    'info-win': H(infoWin),
    'act-read': H(ensureContrast(mix(fg, surface, 0.5), [surface], 2)),
    'act-edit': H(acts[0]),
    'act-cmd': H(acts[1]),
    'act-web': H(acts[2]),
    selection: sh(fill, dark ? 0.3 : 0.22),
    scrim: sh(bg, 0.8),
    frame: sh(dark ? fg : shade, dark ? 0.07 : 0.1),
    'e-0': `0 0 0 1px ${toRgba(ring)}, 0 1px 3px -1px ${sh(shade, dark ? 0.3 : 0.07)}`,
    'e-1': `0 0 0 1px ${toRgba(ring)}, 0 4px 12px -2px ${sh(shade, dark ? 0.3 : 0.08)}, 0 12px 32px -12px ${sh(shade, dark ? 0.6 : 0.14)}`,
    'e-2': `0 0 0 1px ${toRgba(ring)}, 0 24px 56px -20px ${sh(shade, dark ? 0.7 : 0.3)}`,
  };
}
