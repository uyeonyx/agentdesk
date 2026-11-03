// The 0.7 design standard, enforced. Every stylesheet in ui/src/design speaks in tokens: type sizes,
// weights, radii and colors come from tokens.css and the palette in ui/src/theme/base.js, spacing
// sits on the 4px grid (even pixels), and nothing from before 0.7 (glass, aurora, the old scales)
// comes back. The few places that need a raw value are listed in ALLOW, each with its reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_NAMES } from '../ui/src/theme/schema.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = path.join(root, 'ui/src/design');

// file + selector (exact, as written, or * for the whole file) + check → why it may hold a raw value.
const ALLOW = [
  ['island.css', '*', 'raw color', 'The island is always black, like the camera notch it sits under, on either screen.'],
  ['island.css', '*', 'raw color in a variable', 'Its own black palette, the same on both screens.'],
  ['island.css', '*', 'border-radius', 'A capsule that grows out of the notch: its radii follow its height.'],
  ['layout.css', ':root.os-darwin:not(.fullscreen) .titlebar', 'spacing', 'Room for the macOS traffic lights.'],
  ['layout.css', ':root.os-win32 .titlebar', 'spacing', 'Room for the Windows caption buttons.'],
  ['task.css', '.convo-scroll', 'spacing', 'The last message scrolls clear of the floating dock.'],
];
const allowed = (file, sel, name) => ALLOW.some(([f, s, c]) => f === file && (s === '*' || s === sel) && c === name);

// Icons take their size from font-size (Tabler's icon font): an icon rule may name a pixel size.
const ICON = /(^|[\s>+~])(\.ti\b|svg\b)|\.ti(\.|$|\s|:)|\.(ibtn|send|glyph|chev|scope-all|scope-chev|scope-ok|rrow-x|td-ic|run-icons)(\.|$|\s|:)|\.rrow \.pk$|\.todo \.cb$|\.icons button$|\.tool-h \.(ci|ts)$|\.chip2 \.dn$/;

const LEGACY =
  /var\(--(fs-\d|lh-\d|bg-|line-strong|glass-|s-\d+\)|w-4|r-[45]\)|shadow-\d|amb-|glow|accent\)|accent-ink|focus\)|info-(text|soft|fill|line)|(warn|ok|danger)-(fill|line)|diff-)/;
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

function declarations(file) {
  const css = fs.readFileSync(path.join(DESIGN, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rule.exec(css))) {
    const sel = m[1].trim().split('\n').at(-1).trim().replace(/,$/, '');
    const line = css.slice(0, m.index + m[1].length).split('\n').length;
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const prop = d.slice(0, i).trim();
      const value = d.slice(i + 1).trim().replace(/\s+/g, ' ');
      if (prop && value) out.push({ file, line, sel, prop, value });
    }
  }
  return out;
}

const files = fs.readdirSync(DESIGN).filter((f) => f.endsWith('.css') && f !== 'tokens.css' && f !== 'fonts.css');
const all = files.flatMap(declarations);
const where = (d) => `${d.file}:${d.line} ${d.sel} { ${d.prop}: ${d.value} }`;

function check(name, bad) {
  const found = all.filter((d) => !allowed(d.file, d.sel, name) && bad(d));
  assert.deepEqual(found.map(where), [], `${name}:\n${found.map(where).join('\n')}`);
}

test('design: no names from before 0.7 (glass, aurora, the old type and spacing scales)', () => {
  check('legacy token', (d) => LEGACY.test(d.value));
  check('glass', (d) => /backdrop-filter/.test(d.prop) || /gradient\(/.test(d.value));
});

test('design: every variable a stylesheet reads is defined somewhere', () => {
  const tokens = fs.readFileSync(path.join(DESIGN, 'tokens.css'), 'utf8');
  const defined = new Set([
    ...TOKEN_NAMES,
    ...[...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    ...all.filter((d) => d.prop.startsWith('--')).map((d) => d.prop),
    // Set from code: a project's color and its ink (ui/bits.jsx roomVars), a stagger index.
    '--room', '--room-ink', '--i',
  ]);
  check('undefined variable', (d) => [...d.value.matchAll(/var\((--[a-z0-9-]+)/g)].some((m) => !defined.has(m[1])));
});

test('design: colors come from the palette, never written into a stylesheet', () => {
  check('raw color', (d) => !d.prop.startsWith('--') && RAW_COLOR.test(d.value));
  check('raw color in a variable', (d) => d.prop.startsWith('--') && RAW_COLOR.test(d.value));
});

test('design: type sizes and weights are tokens (icons may name a pixel size)', () => {
  check('font-size', (d) => d.prop === 'font-size' && /\d(px|rem)\b/.test(d.value) && !/var\(--t-/.test(d.value) && !ICON.test(d.sel));
  check('font-weight', (d) => d.prop === 'font-weight' && !/^(var\(--w-[0-3]\)|inherit|normal)$/.test(d.value));
  check('font shorthand', (d) => d.prop === 'font' && d.value !== 'inherit' && !/var\(--t-/.test(d.value));
});

test('design: three radii (4, 6, 10), circles and hairline bars', () => {
  check('border-radius', (d) => d.prop === 'border-radius' && !/^((var\(--r-(1|2|3|full)\)|0|50%|inherit|[12]px)\s*)+$/.test(d.value));
});

test('design: spacing sits on the grid: even pixels (or a 1px nudge), tokens past that', () => {
  check('spacing', (d) => /^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(d.prop) && [...d.value.matchAll(/(-?\d+(?:\.\d+)?)px/g)].some((m) => {
    const n = Math.abs(Number(m[1]));
    return n > 64 || (n !== 1 && n % 2 !== 0);
  }));
});
