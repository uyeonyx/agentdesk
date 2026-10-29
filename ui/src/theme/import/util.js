// Shared bits for the importers. They all hand back a raw theme that normalizeTheme then validates.
import { isColor } from '../color.js';

// Terminal configs often write colors without '#'. Anything that still isn't a strict color is dropped.
export function hexish(v) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/^["']|["']$/g, '');
  const c = /^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? `#${s}` : s;
  return isColor(c) ? c.toLowerCase() : undefined;
}

export function baseName(filename) {
  const file = String(filename ?? '').split(/[\\/]/).pop() ?? '';
  return file.replace(/\.[a-z0-9-]+$/i, '').replace(/[-_.]?color-theme$/i, '').replace(/[-_]+/g, ' ').trim();
}

// JSON with comments and trailing commas (VS Code, Windows Terminal). String-aware, so "//" or "/*"
// inside a value (URLs, names) is left alone.
export function stripJsonc(src) {
  const out = [];
  let i = 0;
  let from = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '"') {
      i++;
      while (i < n && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
      i++;
    } else if (ch === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
      out.push(src.slice(from, i));
      if (src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') i++;
      } else {
        const end = src.indexOf('*/', i + 2);
        i = end < 0 ? n : end + 2;
        out.push(' ');
      }
      from = i;
    } else i++;
  }
  out.push(src.slice(from));
  return out.join('').replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (m, str, tail) => str ?? tail);
}

export const parseJsonc = (text) => JSON.parse(stripJsonc(text));

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Reads `key = value` / `key value` config lines, skipping blanks and # comments.
export function configLines(text, sep) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = sep === '=' ? /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line) : /^([A-Za-z0-9_-]+)\s+(\S.*)$/.exec(line);
    if (m) out.push([m[1].toLowerCase(), m[2].trim()]);
  }
  return out;
}
