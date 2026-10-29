// VS Code color theme (*.json / *-color-theme.json, JSONC). Also reads the old tmTheme-as-JSON
// layout where global colors live in an unscoped `settings` entry.
import { parseColor, toOklch } from '../color.js';
import { ThemeError } from '../schema.js';
import { hexish, isObj, parseJsonc, baseName } from './util.js';

const ANSI = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'];
const ANSI_KEYS = [...ANSI.map((c) => `terminal.ansi${c}`), ...ANSI.map((c) => `terminal.ansiBright${c}`)];

// TextMate scopes per syntax role, most canonical first. Only exact scopes count: a rule for
// "keyword.operator" says nothing about keywords, and descendant selectors are too specific.
const SCOPES = {
  comment: ['comment', 'comment.line', 'comment.block', 'punctuation.definition.comment'],
  string: ['string', 'string.quoted', 'string.quoted.double', 'string.quoted.single', 'string.template'],
  number: ['constant.numeric', 'constant.numeric.integer', 'constant.numeric.decimal', 'constant.numeric.float'],
  keyword: ['keyword', 'keyword.control', 'storage.type', 'storage', 'storage.modifier', 'keyword.other'],
  function: ['entity.name.function', 'support.function', 'meta.function-call', 'variable.function'],
  type: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.name.type.class'],
  tag: ['entity.name.tag'],
  attr: ['entity.other.attribute-name'],
  punct: ['punctuation', 'punctuation.separator', 'punctuation.definition', 'punctuation.section', 'meta.brace'],
  variable: ['variable', 'variable.other', 'variable.other.readwrite', 'variable.parameter'],
  constant: ['constant.language', 'constant', 'support.constant', 'constant.other', 'variable.other.constant'],
};

// Workbench colors that map onto our tokens closely enough to keep the theme's character.
const UI_MAP = {
  'bg-app': ['sideBar.background', 'activityBar.background'],
  'bg-overlay': ['editorWidget.background', 'menu.background', 'quickInput.background'],
  'bg-inset': ['input.background'],
  'text-2': ['descriptionForeground'],
  'accent-text': ['textLink.foreground'],
  danger: ['editorError.foreground', 'errorForeground'],
  warn: ['editorWarning.foreground'],
  info: ['editorInfo.foreground'],
  'diff-add-bg': ['diffEditor.insertedLineBackground'],
  'diff-add-mark': ['diffEditor.insertedTextBackground'],
  'diff-del-bg': ['diffEditor.removedLineBackground'],
  'diff-del-mark': ['diffEditor.removedTextBackground'],
};
const ACCENT_KEYS = ['focusBorder', 'button.background', 'activityBarBadge.background', 'textLink.foreground', 'progressBar.background'];

const KIND = { dark: 'dark', 'vs-dark': 'dark', hc: 'dark', 'hc-black': 'dark', light: 'light', vs: 'light', hclight: 'light', 'hc-light': 'light' };

export function importVscode(obj, { filename, warnings }) {
  if (!isObj(obj)) throw new ThemeError('VS Code 테마 형식이 아니에요');
  const colors = isObj(obj.colors) ? obj.colors : {};
  const pick = (...keys) => {
    for (const k of keys) {
      const c = hexish(colors[k]);
      if (c) return c;
    }
    return undefined;
  };
  const kind = KIND[String(obj.type ?? '').toLowerCase()];
  let bad = Object.values(colors).filter((v) => !hexish(v)).length;
  if (obj.include !== undefined) warnings.push('"include"로 연결된 파일은 따라가지 않아요. 이 파일에 있는 색만 가져왔어요');

  let rules = [];
  if (Array.isArray(obj.tokenColors)) rules = obj.tokenColors;
  else if (Array.isArray(obj.settings)) rules = obj.settings;
  else if (typeof obj.tokenColors === 'string') warnings.push('tokenColors가 다른 파일을 가리켜 문법 색은 가져오지 않았어요');
  rules = rules.slice(0, 5000).filter((r) => isObj(r) && isObj(r.settings));

  const global = rules.find((r) => r.scope === undefined)?.settings ?? {};
  const byScope = new Map();
  for (const r of rules) {
    const fg = hexish(r.settings.foreground);
    if (!fg) {
      if (r.settings.foreground !== undefined) bad++;
      continue;
    }
    const scopes = Array.isArray(r.scope) ? r.scope : typeof r.scope === 'string' ? r.scope.split(',') : [];
    for (const s of scopes) if (typeof s === 'string' && /^[\w.-]+$/.test(s.trim())) byScope.set(s.trim(), fg);
  }
  const syntax = {};
  for (const [key, scopes] of Object.entries(SCOPES)) {
    const hit = scopes.find((s) => byScope.has(s));
    if (hit) syntax[key] = byScope.get(hit);
  }

  const ansi = ANSI_KEYS.map((k) => pick(k));
  let bg = pick('editor.background') ?? hexish(global.background) ?? pick('terminal.background');
  let fg = pick('editor.foreground') ?? hexish(global.foreground) ?? pick('foreground', 'terminal.foreground');
  const hasAny = bg || fg || ansi.some(Boolean) || Object.keys(syntax).length;
  if (!hasAny) {
    throw new ThemeError(obj.include !== undefined
      ? '이 VS Code 테마는 색을 다른 파일(include)에 두고 있어 가져올 수 없어요'
      : '테마 파일에서 색을 찾지 못했어요');
  }
  if (bad) warnings.push(`잘못된 색 값 ${bad}개를 건너뛰었어요`);
  if (!bg || !fg) {
    warnings.push('배경색이나 글자색이 없어 VS Code 기본값으로 채웠어요');
    bg ??= kind === 'light' ? '#ffffff' : '#1e1e1e';
    fg ??= kind === 'light' ? '#000000' : '#d4d4d4';
  }

  // The accent is whichever "brand" color the theme sets that is actually colorful and mostly opaque.
  const accent = ACCENT_KEYS.map((k) => hexish(colors[k])).find((c) => {
    const p = parseColor(c);
    return p && p.a >= 0.5 && toOklch(p).C >= 0.04;
  });

  const ui = {};
  for (const [token, keys] of Object.entries(UI_MAP)) {
    const c = pick(...keys);
    if (c) ui[token] = c;
  }

  return {
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name : baseName(filename) || 'VS Code 테마',
    kind,
    author: typeof obj.author === 'string' ? obj.author : undefined,
    base: {
      bg,
      fg,
      accent,
      selection: pick('editor.selectionBackground', 'terminal.selectionBackground') ?? hexish(global.selection),
      cursor: pick('terminalCursor.foreground', 'editorCursor.foreground') ?? hexish(global.caret),
    },
    ansi: ansi.some(Boolean) ? ansi : [],
    syntax,
    ui,
  };
}

export const importVscodeText = (text, ctx) => importVscode(parseJsonc(text), ctx);
