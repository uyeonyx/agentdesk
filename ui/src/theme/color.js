// Color math for themes: strict parsing, OKLab/OKLCH, compositing and WCAG contrast. No dependencies.
// A color is { r, g, b, a } with r/g/b as 0-255 integers and a in 0..1.

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const NUM = '(\\d{1,3}(?:\\.\\d+)?)';
const ALPHA = '(\\d{0,3}(?:\\.\\d+)?%?)';
const RGB_COMMA = new RegExp(`^rgba?\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*(?:,\\s*${ALPHA}\\s*)?\\)$`, 'i');
const RGB_SPACE = new RegExp(`^rgba?\\(\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s*(?:\\/\\s*${ALPHA}\\s*)?\\)$`, 'i');

export const WHITE = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });
export const BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const byte = (v) => clamp(Math.round(v), 0, 255);
const rgb = (r, g, b, a = 1) => ({ r: byte(r), g: byte(g), b: byte(b), a: clamp(a, 0, 1) });

// Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space syntax). Anything else is null.
export function parseColor(input) {
  if (input && typeof input === 'object') {
    const { r, g, b, a = 1 } = input;
    return [r, g, b, a].every(Number.isFinite) ? rgb(r, g, b, a) : null;
  }
  if (typeof input !== 'string' || input.length > 64) return null;
  let m = HEX.exec(input);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  m = RGB_COMMA.exec(input) ?? RGB_SPACE.exec(input);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  let a = 1;
  if (m[4] !== undefined) {
    if (!/\d/.test(m[4])) return null;
    a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  }
  if (r > 255 || g > 255 || b > 255 || !(a >= 0 && a <= 1)) return null;
  return rgb(r, g, b, a);
}

export const isColor = (s) => typeof s === 'string' && parseColor(s) !== null;

const col = (c) => {
  const p = parseColor(c);
  if (!p) throw new TypeError(`not a color: ${String(c).slice(0, 40)}`);
  return p;
};
const hex2 = (v) => byte(v).toString(16).padStart(2, '0');
const fmtAlpha = (a) => String(Math.round(clamp(a, 0, 1) * 1000) / 1000);

export function toHex(c) {
  const { r, g, b, a } = col(c);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;
}

export function toRgba(c) {
  const { r, g, b, a } = col(c);
  return `rgba(${r}, ${g}, ${b}, ${fmtAlpha(a)})`;
}

// Opaque colors as hex, translucent ones as rgba() so CSS stays readable.
export const toCss = (c) => (col(c).a < 1 ? toRgba(c) : toHex(c));

export const withAlpha = (c, a) => ({ ...col(c), a: clamp(a, 0, 1) });

// sRGB transfer functions on a 0..1 channel.
export const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function toOklab(c) {
  const p = col(c);
  const [r, g, b] = [p.r, p.g, p.b].map((v) => srgbToLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha: p.a,
  };
}

function labToLinear({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const fromLinear = ([r, g, b], a = 1) => rgb(...[r, g, b].map((v) => linearToSrgb(clamp(v, 0, 1)) * 255), a);
const inGamut = (lin) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export const fromOklab = ({ L, a, b, alpha = 1 }) => fromLinear(labToLinear({ L, a, b }), alpha);

export function toOklch(c) {
  const { L, a, b, alpha } = toOklab(c);
  const C = Math.hypot(a, b);
  const h = C < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { L, C, h, alpha };
}

// Out-of-gamut colors keep lightness and hue and lose chroma, which is what eyes forgive most.
export function fromOklch({ L, C, h, alpha = 1 }) {
  L = clamp(L, 0, 1);
  const rad = (h * Math.PI) / 180;
  const at = (c) => labToLinear({ L, a: c * Math.cos(rad), b: c * Math.sin(rad) });
  let lin = at(Math.max(0, C));
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid;
      else hi = mid;
    }
    lin = at(lo);
  }
  return fromLinear(lin, alpha);
}

export const shiftL = (c, d) => {
  const o = toOklch(c);
  return fromOklch({ ...o, L: o.L + d });
};

// Perceptual mix in OKLab: t=0 gives x, t=1 gives y.
export function mix(x, y, t) {
  const p = toOklab(x);
  const q = toOklab(y);
  const k = (u, v) => u + (v - u) * t;
  return fromOklab({ L: k(p.L, q.L), a: k(p.a, q.a), b: k(p.b, q.b), alpha: k(p.alpha, q.alpha) });
}

// Source-over compositing in gamma space, the way browsers blend layers.
export function over(top, bottom) {
  const t = col(top);
  const b = col(bottom);
  const a = t.a + b.a * (1 - t.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const ch = (x, y) => (x * t.a + y * b.a * (1 - t.a)) / a;
  return rgb(ch(t.r, b.r), ch(t.g, b.g), ch(t.b, b.b), a);
}

export function luminance(c) {
  const { r, g, b } = col(c);
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}

// WCAG 2 contrast ratio. A translucent foreground is judged as composited onto the background.
export function contrast(fg, bg) {
  const b = col(bg);
  const f = col(fg);
  const l1 = luminance(f.a < 1 ? over(f, b) : f);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export const isDark = (c) => contrast(WHITE, c) > contrast(BLACK, c);

const worst = (c, bgs) => Math.min(...bgs.map((b) => contrast(c, b)));

// Smallest OKLCH lightness change (hue kept) that reaches `min` against every background.
// When no lightness can satisfy all of them, returns the candidate with the best worst case.
export function ensureContrast(color, bgs, min) {
  const c = col(color);
  const list = bgs.map(col);
  if (!list.length || worst(c, list) >= min) return c;
  const o = toOklch(c);
  const targets = [1, 0].sort((x, y) => worst(fromOklch({ ...o, L: y }), list) - worst(fromOklch({ ...o, L: x }), list));
  let best = c;
  let bestScore = worst(c, list);
  for (const target of targets) {
    for (let i = 1; i <= 100; i++) {
      const cand = fromOklch({ ...o, L: o.L + ((target - o.L) * i) / 100 });
      const score = worst(cand, list);
      if (score >= min) return cand;
      if (score > bestScore) [best, bestScore] = [cand, score];
    }
  }
  return best;
}
