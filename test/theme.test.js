// Theme system: color math, derivation (complete + readable for every built-in), the CSS
// whitelist, and importers, including hostile input. Pure modules, so no app boot needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseColor, isColor, toHex, toRgba, contrast, over, mix, toOklch, fromOklch, ensureContrast, luminance,
} from '../ui/src/theme/color.js';
import { normalizeTheme, TOKEN_NAMES, COLOR_TOKENS, SHADOW_TOKENS, ThemeError } from '../ui/src/theme/schema.js';
import { deriveTokens } from '../ui/src/theme/derive.js';
import { applyTheme, isSafeValue } from '../ui/src/theme/apply.js';
import { BUILTIN_THEMES, DEFAULT_DARK_ID, DEFAULT_LIGHT_ID } from '../ui/src/theme/builtin/index.js';
import { detectAndImport } from '../ui/src/theme/import/index.js';
import { stripJsonc } from '../ui/src/theme/import/util.js';
import { parsePlist } from '../ui/src/theme/import/iterm.js';
import * as themeApi from '../ui/src/theme/index.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'themes');
const fixture = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const XTERM_KEYS = [
  'background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];
const MONACO_TOKENS = ['comment', 'string', 'number', 'keyword', 'type', 'function', 'variable', 'tag', 'attribute.name', 'delimiter', 'regexp'];

// The whole contract for one derived token set; `label` names the theme/mode in failures.
function assertComplete(d, label) {
  assert.ok(d.kind === 'dark' || d.kind === 'light', `${label}: kind`);
  for (const name of TOKEN_NAMES) {
    const v = d.vars[name];
    assert.equal(typeof v, 'string', `${label}: ${name} missing`);
    assert.ok(isSafeValue(v), `${label}: ${name} = ${v} is not a safe CSS value`);
  }
  for (const n of COLOR_TOKENS) assert.ok(isColor(d.vars[`--${n}`]), `${label}: --${n} not a color`);
  for (const n of SHADOW_TOKENS) assert.match(d.vars[`--${n}`], /rgba\(/);

  const c = (n) => parseColor(d.vars[n]);
  // Every place text sits: white panels, the chrome, the sunken fills, hover and selected rows.
  const all = ['--surface', '--chrome', '--bg', '--surface-2', '--hover', '--pressed', '--accent-soft'].map(c);
  const min = (fg, bgs) => Math.min(...bgs.map((b) => contrast(fg, b)));
  assert.ok(min(c('--text'), all) >= 4.5, `${label}: --text ${min(c('--text'), all).toFixed(2)}`);
  assert.ok(min(c('--text-2'), all) >= 4.5, `${label}: --text-2 ${min(c('--text-2'), all).toFixed(2)}`);
  // Tertiary text is small (times, paths, labels): it gets the AA bar too.
  assert.ok(min(c('--text-3'), all) >= 4.5, `${label}: --text-3 ${min(c('--text-3'), all).toFixed(2)}`);
  const onSurface = (n) => contrast(c(n), c('--surface'));
  assert.ok(onSurface('--text') >= onSurface('--text-2') && onSurface('--text-2') >= onSurface('--text-3'), `${label}: text hierarchy`);
  assert.ok(contrast(c('--accent-fill-ink'), c('--accent-fill')) >= 4.5, `${label}: accent-fill-ink`);
  assert.ok(min(c('--accent-text'), [c('--surface'), c('--accent-soft')]) >= 4.5, `${label}: accent-text`);
  for (const s of ['ok', 'warn', 'danger']) {
    assert.ok(min(c(`--${s}-text`), [c('--surface'), c(`--${s}-soft`)]) >= 4.5, `${label}: ${s}-text`);
    assert.ok(contrast(c(`--${s}-ink`), c(`--${s}`)) >= 4.5, `${label}: ${s}-ink`);
  }
  for (const k of ['add', 'del']) assert.ok(contrast(c(`--${k}`), c(`--${k}-bg`)) >= 4.5, `${label}: diff ${k}`);
  // The readout windows carry big numbers and small labels.
  for (const w of ['--win', '--warn-win', '--info-win']) assert.ok(contrast(c('--text-2'), c(w)) >= 4.5, `${label}: text-2 on ${w}`);
  // Its big numbers (34px and up) are large text: 3:1.
  assert.ok(contrast(c('--warn-text'), c('--warn-win')) >= 3, `${label}: warn-text on warn-win`);
  assert.ok(contrast(c('--accent-line'), c('--surface')) >= 3, `${label}: focus ring`);
  assert.ok(contrast(c('--term-fg'), c('--term-bg')) >= 4.5, `${label}: term-fg`);

  for (const k of XTERM_KEYS) assert.ok(isColor(d.xterm[k]), `${label}: xterm.${k}`);
  assert.ok(d.monaco.base === 'vs' || d.monaco.base === 'vs-dark');
  assert.equal(d.monaco.base, d.kind === 'dark' ? 'vs-dark' : 'vs');
  assert.equal(d.monaco.inherit, true);
  for (const r of d.monaco.rules) {
    assert.equal(typeof r.token, 'string');
    assert.match(r.foreground, /^[0-9a-f]{6}$/, `${label}: monaco rule ${r.token}`);
  }
  const ruleTokens = new Set(d.monaco.rules.map((r) => r.token));
  for (const t of MONACO_TOKENS) assert.ok(ruleTokens.has(t), `${label}: monaco rule ${t}`);
  for (const [k, v] of Object.entries(d.monaco.colors)) assert.match(v, /^#[0-9a-f]{6}([0-9a-f]{2})?$/, `${label}: monaco ${k}`);
  // The editor and terminal keep the code theme's own background; the app around them doesn't.
  assert.equal(d.monaco.colors['editor.background'], d.vars['--term-bg']);
  assert.match(d.chrome.bg, /^#[0-9a-f]{6}$/);
  assert.match(d.chrome.fg, /^#[0-9a-f]{6}$/);
}

test('color: parse, format and round-trip', () => {
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('#11223344'), { r: 17, g: 34, b: 51, a: 0x44 / 255 });
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(10,20,30,.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(parseColor('rgb(10 20 30 / 25%)'), { r: 10, g: 20, b: 30, a: 0.25 });
  assert.equal(toHex('#ABC'), '#aabbcc');
  assert.equal(toHex('rgba(255, 0, 0, 0.5)'), '#ff000080');
  assert.equal(toRgba('#ff000080'), 'rgba(255, 0, 0, 0.502)');
  for (const hex of ['#7c8cff', '#0b0a14', '#fdf6e3', '#ff2bd6', '#00f0ff']) {
    assert.equal(toHex(fromOklch(toOklch(hex))), hex, `OKLCH round trip ${hex}`);
  }
  assert.equal(toHex(mix('#000000', '#ffffff', 0)), '#000000');
  assert.equal(toHex(over('rgba(255, 255, 255, 0.5)', '#000000')), '#808080');
});

test('color: strict validator rejects anything that is not a plain color', () => {
  for (const bad of [
    'red', 'red;}body{background:url(x)', 'expression(alert(1))', 'url(x)', '#ggg', '#12345', ' #fff', '#fff ',
    'rgb(256, 0, 0)', 'rgb(1, 2)', 'rgba(1, 2, 3, 2)', 'rgb(1,2,3);', 'rgba(1, 2, 3, )', 'var(--x)', '#fff\n}', '', null, 42, {},
  ]) assert.equal(isColor(bad), false, String(bad));
});

test('color: WCAG contrast and correction', () => {
  assert.equal(contrast('#000', '#fff').toFixed(1), '21.0');
  assert.equal(contrast('#777', '#777'), 1);
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9);
  const fixed = ensureContrast('#555555', ['#333333', '#3a3a3a'], 4.5);
  assert.ok(contrast(fixed, '#333333') >= 4.5 && contrast(fixed, '#3a3a3a') >= 4.5);
  // Hue is kept while lightness moves.
  const blue = ensureContrast('#3050a0', ['#101010'], 4.5);
  assert.ok(Math.abs(toOklch(blue).h - toOklch('#3050a0').h) < 6);
});

test('built-ins: ids are unique, defaults exist, every definition normalizes cleanly', () => {
  const ids = BUILTIN_THEMES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(DEFAULT_DARK_ID) && ids.includes(DEFAULT_LIGHT_ID) && ids.includes('cyberpunk'));
  assert.ok(BUILTIN_THEMES.length >= 34);
  for (const t of BUILTIN_THEMES) {
    const warnings = [];
    const n = normalizeTheme(t, warnings);
    assert.deepEqual(warnings, [], `${t.id}: ${warnings.join(', ')}`);
    assert.equal(n.kind, t.kind, `${t.id}: declared kind matches its background`);
    assert.equal(t.ansi.length, 16, `${t.id}: 16 ANSI colors`);
    assert.equal(Object.keys(t.syntax).length, 11, `${t.id}: all syntax roles`);
    assert.ok(t.ambient.stops.length >= 2 && t.ambient.stops.length <= 4, `${t.id}: ambient`);
    assert.ok(t.license, `${t.id}: license`);
  }
  assert.ok(BUILTIN_THEMES.some((t) => t.kind === 'light') && BUILTIN_THEMES.some((t) => t.kind === 'dark'));
  assert.equal(themeApi.findTheme('dracula').name, 'Dracula');
});

for (const t of BUILTIN_THEMES) {
  test(`derive: ${t.id} is complete, readable, and leaves the app's own palette alone`, () => {
    const d = deriveTokens(t);
    assertComplete(d, t.id);
    // Surfaces, lines and text are the hand-set palette for this kind of screen, whatever the theme.
    const own = themeApi.BASE[t.kind];
    for (const k of ['bg', 'surface', 'line', 'text', 'text-2', 'text-3', 'accent-fill', 'warn', 'ok']) assert.equal(d.vars[`--${k}`], own[k], `${t.id}: --${k}`);
  });
}

test('accents: every accent keeps the contract on both screens; blue and unknown ids are the standard', () => {
  for (const kind of ['light', 'dark']) {
    const t = BUILTIN_THEMES.find((x) => x.kind === kind);
    for (const a of themeApi.ACCENTS) {
      const d = deriveTokens(t, { accent: a.id });
      assertComplete(d, `${kind}+${a.id}`);
      assert.equal(d.vars['--accent-fill'], kind === 'light' ? a.light : a.dark, `${kind}+${a.id}: accent`);
    }
    const std = deriveTokens(t).vars;
    assert.deepEqual(deriveTokens(t, { accent: 'nope' }).vars, std);
    assert.deepEqual(deriveTokens(t, { accent: 'blue' }).vars, std);
  }
});

test('derive: a theme cannot repaint the app, only its code', () => {
  const base = BUILTIN_THEMES[0];
  const d = deriveTokens({ ...base, ui: { 'syn-keyword': '#ff00aa', 'text-3': '#17181d', accent: '#33cc99', 'bg-raised': '#222233' } });
  assert.equal(d.vars['--syn-keyword'], '#ff00aa');
  assert.equal(d.vars['--accent-fill'], themeApi.BASE[base.kind]['accent-fill']);
  assert.equal(d.vars['--text-3'], themeApi.BASE[base.kind]['text-3']);
  assert.equal(d.vars['--surface'], themeApi.BASE[base.kind].surface);
  assert.equal(d.vars['--bg-raised'], undefined);
});

test('derive: a theme without syntax, ambient or accent still yields everything', () => {
  const d = deriveTokens({ name: 'Bare', base: { bg: '#202020', fg: '#d0d0d0' } });
  assertComplete(d, 'bare');
  const light = deriveTokens({ name: 'Bare light', base: { bg: '#fafafa', fg: '#333333' } });
  assertComplete(light, 'bare-light');
  // Even a theme whose fg is unreadable on its own bg comes out readable.
  assertComplete(deriveTokens({ name: 'Mud', base: { bg: '#555555', fg: '#606060' } }), 'mud');
});

test('normalize: drops invalid values, keeps valid ones, rejects missing essentials', () => {
  const warnings = [];
  const n = normalizeTheme({
    id: 'Bad ID!', name: 'Odd‮\u0000 Name', kind: 'light', source: 'javascript:alert(1)',
    base: { bg: '#101010', fg: '#eeeeee', accent: 'url(x)', selection: '#ffffff33' },
    ansi: ['#000000', 'red;}x{', 'expression(1)'],
    syntax: { keyword: '#ff00ff', string: 'url(x)', bogus: '#ffffff' },
    ui: { text: 'red;}body{background:url(x)', 'bg-hover': '#ffffff10', 'not-a-token': '#ffffff', 'glass-tint': '#000' },
    ambient: { stops: ['#ff0000', 'nope'], speed: 99999 },
    glass: { alpha: 5, blur: 12, glow: 'yes' },
  }, warnings);
  assert.equal(n.kind, 'dark', 'kind follows the background');
  assert.equal(n.id, 'odd-name');
  assert.equal(n.name, 'Odd Name');
  assert.equal(n.source, undefined);
  assert.equal(n.base.accent, undefined);
  assert.equal(n.base.selection, '#ffffff33');
  assert.equal(n.ansi.length, 16);
  assert.ok(n.ansi.every(isColor));
  assert.deepEqual(n.syntax, { keyword: '#ff00ff' });
  assert.deepEqual(n.ui, { 'bg-hover': '#ffffff10' });
  assert.equal(n.ambient, undefined, 'fewer than two valid stops');
  assert.deepEqual(n.glass, { blur: 12 });
  assert.ok(warnings.length >= 2);
  assert.throws(() => normalizeTheme({ name: 'x', base: { bg: '#000' } }), ThemeError);
  assert.throws(() => normalizeTheme(null), ThemeError);
});

test('apply: writes only whitelisted names and values, sets color scheme', () => {
  const calls = [];
  const root = { style: { setProperty: (n, v) => calls.push([n, v]), colorScheme: '' }, dataset: {} };
  const d = deriveTokens(BUILTIN_THEMES[1]);
  const { rejected } = applyTheme(
    {
      ...d,
      vars: {
        ...d.vars,
        '--evil': 'red;}body{background:url(x)',
        '--x': 'expression(alert(1))',
        '--y': 'url(https://x)',
        '--z': '0 1px 2px rgba(0, 0, 0, 0.3); color: red',
        '--a;b': '#ffffff',
        '--Upper': '#ffffff',
        'color': '#ffffff',
      },
    },
    root,
  );
  assert.deepEqual(rejected.sort(), ['--Upper', '--a;b', '--evil', '--x', '--y', '--z', 'color'].sort());
  assert.equal(calls.length, Object.keys(d.vars).length);
  for (const [n, v] of calls) assert.ok(/^--[a-z0-9-]+$/.test(n) && !/[;{}]|url\(|expression/i.test(v), `${n}: ${v}`);
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(root.dataset.themeKind, 'light');
  applyTheme({ kind: 'nonsense', vars: {} }, root);
  assert.equal(root.style.colorScheme, 'dark');
});

test('import: VS Code JSONC theme with comments, trailing commas and tokenColors', () => {
  const { theme, warnings, format } = detectAndImport(fixture('sample-night-color-theme.jsonc'), 'sample-night-color-theme.jsonc');
  assert.equal(format, 'vscode');
  assert.equal(theme.name, 'Sample Night');
  assert.equal(theme.id, 'user-sample-night');
  assert.equal(theme.kind, 'dark');
  assert.equal(theme.base.bg, '#1b1d2b');
  assert.equal(theme.base.fg, '#c8d0e0');
  assert.equal(theme.base.accent, '#7aa2f7');
  assert.equal(theme.base.selection, '#7aa2f733');
  assert.equal(theme.base.cursor, '#ffcc66');
  assert.equal(theme.ansi[9], '#ff899d');
  assert.equal(theme.syntax.keyword, '#bb9af7', 'exact scopes only: not keyword.operator, not "source.js keyword"');
  assert.equal(theme.syntax.comment, '#565f89');
  assert.equal(theme.syntax.string, '#9ece6a');
  assert.equal(theme.syntax.number, '#ff9e64');
  assert.equal(theme.syntax.attr, '#73daca');
  assert.equal(theme.ui['bg-app'], '#161825');
  assert.equal(theme.ui.danger, '#f7768e');
  assert.deepEqual(warnings, []);
  assertComplete(deriveTokens(theme), 'vscode');
});

test('import: JSONC stripping is string-aware', () => {
  const src = '{ "a": "http://x//y", "b": "/* keep */", // drop\n "c": [1, 2,], /* drop */ "d": "x,]" , }';
  assert.deepEqual(JSON.parse(stripJsonc(src)), { a: 'http://x//y', b: '/* keep */', c: [1, 2], d: 'x,]' });
});

test('import: Ghostty theme (terminal palette only) yields a complete token set', () => {
  const { theme, format } = detectAndImport(fixture('sample-ghostty'), 'sample-ghostty');
  assert.equal(format, 'ghostty');
  assert.equal(theme.name, 'sample ghostty');
  assert.equal(theme.base.bg, '#1d1f21');
  assert.equal(theme.base.selection, '#373b41');
  assert.equal(theme.ansi[12], '#7aa6da');
  assert.equal(theme.syntax, undefined);
  assertComplete(deriveTokens(theme), 'ghostty');
});

test('import: iTerm2 .itermcolors via the pure plist reader', () => {
  const { theme, format } = detectAndImport(fixture('sample.itermcolors'), 'Sample Preset.itermcolors');
  assert.equal(format, 'iterm');
  assert.equal(theme.name, 'Sample Preset');
  assert.equal(theme.id, 'user-sample-preset');
  assert.equal(theme.base.bg, '#101421');
  assert.equal(theme.base.fg, '#d0d4e0');
  assert.equal(theme.base.cursor, '#ffb86c');
  assert.equal(theme.ansi[1], '#c91b00');
  assert.equal(theme.ansi[15], '#ffffff');
  assertComplete(deriveTokens(theme), 'iterm');
  const plist = parsePlist(fixture('sample.itermcolors'));
  assert.equal(plist['Note & Credits'], 'R&D <test>');
  assert.equal(plist['Use Bright Bold'], true);
});

test('import: Windows Terminal scheme and settings.json', () => {
  const { theme, format } = detectAndImport(fixture('sample-wterm.json'), 'sample-wterm.json');
  assert.equal(format, 'wterm');
  assert.equal(theme.name, 'Sample Campbell');
  assert.equal(theme.ansi[5], '#881798', 'purple is magenta');
  assert.equal(theme.ansi[13], '#b4009e');
  assert.equal(theme.base.bg, '#0c0c0c');
  assertComplete(deriveTokens(theme), 'wterm');
  const s = detectAndImport(fixture('wterm-settings.json'), 'settings.json');
  assert.equal(s.theme.name, 'First Scheme');
  assert.equal(s.theme.kind, 'light');
  assert.ok(s.warnings.some((w) => w.includes('첫 번째')));
  assertComplete(deriveTokens(s.theme), 'wterm-settings');
});

test('import: kitty conf with metadata, and a bare 16-color palette', () => {
  const { theme, format } = detectAndImport(fixture('sample-kitty.conf'), 'sample.conf');
  assert.equal(format, 'kitty');
  assert.equal(theme.name, 'Sample Kitty');
  assert.equal(theme.author, 'Test Author');
  assert.equal(theme.license, 'MIT');
  assert.equal(theme.source, 'https://example.com/sample-kitty.conf');
  assert.equal(theme.base.selection, '#44475a');
  assert.equal(theme.ansi[10], '#69ff94');
  assertComplete(deriveTokens(theme), 'kitty');

  const bare = detectAndImport(fixture('palette-only.conf'), 'palette-only.conf');
  assert.equal(bare.theme.ansi[4], '#268bd2');
  assert.ok(bare.warnings.length >= 1, 'missing bg/fg is reported');
  assertComplete(deriveTokens(bare.theme), 'kitty-bare');
});

test('import: hostile and broken files are rejected or neutralized', () => {
  // Oversize input.
  assert.throws(() => detectAndImport(`{"name":"x","colors":{}}${' '.repeat(1024 * 1024)}`, 'big.json'), /너무 커요/);
  // Multi-byte text that is under 1M characters but over 1MB.
  assert.throws(() => detectAndImport(`# ${'가'.repeat(400000)}`, 'big-ghostty'), /너무 커요/);
  // include-only VS Code theme: nothing to import.
  assert.throws(() => detectAndImport(fixture('include-only.json'), 'include-only.json'), /include/);
  // Garbage and wrong types.
  assert.throws(() => detectAndImport('{ not json', 'x.json'), (e) => e instanceof ThemeError && e.message === '테마 파일을 읽을 수 없어요');
  assert.throws(() => detectAndImport('hello world', 'notes.txt'), ThemeError);
  assert.throws(() => detectAndImport(null, 'x.json'), ThemeError);
  assert.throws(() => detectAndImport('<plist><dict><key>a</key><real>1</real>< /dict></plist>', 'x.itermcolors'), ThemeError);
  assert.throws(() => detectAndImport(`<plist>${'<array>'.repeat(100)}`, 'deep.itermcolors'), ThemeError);

  // Injection attempts in a VS Code theme: every bad value is dropped, the result is still complete.
  const { theme, warnings } = detectAndImport(fixture('malicious-color-theme.json'), 'malicious-color-theme.json');
  assert.equal(theme.base.bg, '#101010');
  assert.equal(theme.base.fg, '#d4d4d4', 'invalid fg falls back to the VS Code default');
  assert.equal(theme.base.accent, undefined);
  assert.equal(theme.ui, undefined);
  assert.deepEqual(theme.syntax, { string: '#00ff00' });
  assert.ok(!/[‮\u0007]/.test(theme.name));
  assert.match(theme.id, /^user-[a-z0-9-]+$/);
  assert.ok(warnings.length > 0);
  assert.equal({}.polluted, undefined);
  const d = deriveTokens(theme);
  assertComplete(d, 'malicious');
  const css = JSON.stringify([d.vars, d.xterm, d.monaco]);
  for (const bad of ['url(', 'expression', ';}', '!important', 'var(']) assert.ok(!css.includes(bad), bad);
});

test('activity colors: every built-in tells reads, edits, commands and web apart, and each shows on its surface', () => {
  for (const t of BUILTIN_THEMES) {
    const v = deriveTokens(t).vars;
    const surface = parseColor(v['--surface']);
    const hues = ['--act-edit', '--act-cmd', '--act-web'].map((k) => {
      const c = parseColor(v[k]);
      assert.ok(contrast(c, surface) >= 3 - 0.05, `${t.name} ${k} on surface: ${contrast(c, surface).toFixed(2)}`);
      return toOklch(c).h;
    });
    for (let i = 0; i < hues.length; i++)
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.min(Math.abs(hues[i] - hues[j]), 360 - Math.abs(hues[i] - hues[j]));
        assert.ok(d >= 40, `${t.name}: two activity colors look alike (${d.toFixed(0)}°)`);
      }
    assert.ok(contrast(parseColor(v['--act-read']), surface) >= 2 - 0.05, `${t.name} --act-read`);
  }
});
