// Theme import: sniff the format, run its importer, then validate through normalizeTheme.
// Every failure surfaces as a ThemeError with a message that can be shown to the user as is.
import { normalizeTheme, slugify, ThemeError } from '../schema.js';
import { parseJsonc } from './util.js';
import { importVscode } from './vscode.js';
import { importWterm, looksLikeWterm } from './wterm.js';
import { importGhostty } from './ghostty.js';
import { importIterm } from './iterm.js';
import { importKitty } from './kitty.js';

export const MAX_THEME_BYTES = 1024 * 1024;

const READ_FAIL = '테마 파일을 읽을 수 없어요';

function detectFormat(text, filename) {
  const ext = (/\.([a-z0-9-]+)$/i.exec(String(filename ?? ''))?.[1] ?? '').toLowerCase();
  const head = text.trimStart();
  if (ext === 'itermcolors' || /^<(\?xml|!DOCTYPE\s+plist|plist)/i.test(head)) return 'iterm';
  if (head.startsWith('{') || ext === 'json' || ext === 'jsonc' || /^\/[/*]/.test(head)) return 'json';
  if (/^\s*(palette|background|foreground)\s*=/m.test(text)) return 'ghostty';
  if (ext === 'conf' || /^\s*(color\d{1,3}|background|foreground)\s+\S/m.test(text)) return 'kitty';
  return null;
}

export function detectAndImport(text, filename = '') {
  if (typeof text !== 'string') throw new ThemeError(READ_FAIL);
  if (text.length > MAX_THEME_BYTES || new TextEncoder().encode(text).length > MAX_THEME_BYTES) {
    throw new ThemeError('테마 파일이 너무 커요. 1MB 이하 파일만 가져올 수 있어요');
  }
  const src = text.replace(/^﻿/, '');
  const warnings = [];
  const ctx = { filename, warnings };
  let format = detectFormat(src, filename);
  if (!format) throw new ThemeError('지원하지 않는 테마 형식이에요. VS Code, Ghostty, iTerm2, Windows Terminal, kitty 테마를 가져올 수 있어요');

  let raw;
  try {
    if (format === 'json') {
      const obj = parseJsonc(src);
      format = looksLikeWterm(obj) ? 'wterm' : 'vscode';
      raw = format === 'wterm' ? importWterm(obj, ctx) : importVscode(obj, ctx);
    } else if (format === 'iterm') raw = importIterm(src, ctx);
    else if (format === 'ghostty') raw = importGhostty(src, ctx);
    else raw = importKitty(src, ctx);
  } catch (e) {
    throw e instanceof ThemeError ? e : new ThemeError(READ_FAIL);
  }

  const theme = normalizeTheme({ ...raw, id: undefined }, warnings);
  theme.id = `user-${slugify(theme.name)}`.slice(0, 64);
  return { theme, warnings, format };
}

export { ThemeError };
