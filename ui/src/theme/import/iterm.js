// iTerm2 .itermcolors: an XML property list of color dicts with 0-1 float components.
// A tiny pure plist reader (no DOMParser, so it runs in Node tests and never touches the DOM).
import { ThemeError } from '../schema.js';
import { baseName } from './util.js';

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z]+)\b[^>]*?(\/?)>|([^<]+)/g;
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

export function parsePlist(xml) {
  const toks = [];
  let pos = 0;
  for (const m of xml.matchAll(TOKEN)) {
    if (m.index !== pos) throw new Error('plist: unexpected character');
    pos = m.index + m[0].length;
    if (m[4] !== undefined) {
      if (m[4].trim()) toks.push({ text: m[4] });
    } else if (m[2]) toks.push({ close: m[1] === '/', name: m[2].toLowerCase(), self: m[3] === '/' });
  }
  if (pos !== xml.length) throw new Error('plist: trailing garbage');

  let i = 0;
  const expectClose = (name) => {
    const t = toks[i++];
    if (!t || !t.close || t.name !== name) throw new Error(`plist: expected </${name}>`);
  };
  const textOf = (name) => {
    const s = toks[i]?.text !== undefined ? toks[i++].text : '';
    expectClose(name);
    return decode(s.trim());
  };
  const value = (depth) => {
    if (depth > 32) throw new Error('plist: too deep');
    const t = toks[i++];
    if (!t || t.close || t.text !== undefined) throw new Error('plist: expected a value');
    if (t.self) return t.name === 'true' ? true : t.name === 'false' ? false : t.name === 'dict' ? {} : t.name === 'array' ? [] : '';
    switch (t.name) {
      case 'dict': {
        const o = Object.create(null);
        while (!(toks[i]?.close && toks[i].name === 'dict')) {
          const k = toks[i++];
          if (!k || k.close || k.name !== 'key') throw new Error('plist: expected <key>');
          const key = textOf('key');
          o[key] = value(depth + 1);
        }
        i++;
        return o;
      }
      case 'array': {
        const a = [];
        while (!(toks[i]?.close && toks[i].name === 'array')) {
          if (i >= toks.length) throw new Error('plist: unclosed <array>');
          a.push(value(depth + 1));
        }
        i++;
        return a;
      }
      case 'real':
      case 'integer':
        return Number(textOf(t.name));
      case 'string':
      case 'date':
      case 'data':
        return textOf(t.name);
      default:
        throw new Error(`plist: unsupported <${t.name}>`);
    }
  };
  if (toks[i]?.name === 'plist' && !toks[i].close) i++;
  return value(0);
}

// { "Red Component": 0.5, ... } -> '#rrggbb' (or #rrggbbaa). Out-of-range components mean a broken file.
function colorOf(d) {
  if (!d || typeof d !== 'object') return undefined;
  const ch = ['Red', 'Green', 'Blue', 'Alpha'].map((n) => d[`${n} Component`]);
  if (ch[3] === undefined) ch[3] = 1;
  if (!ch.every((v) => typeof v === 'number' && v >= -0.001 && v <= 1.001)) return undefined;
  const hex = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${hex(ch[0])}${hex(ch[1])}${hex(ch[2])}${ch[3] < 1 ? hex(ch[3]) : ''}`;
}

export function importIterm(text, { filename, warnings }) {
  const root = parsePlist(text);
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new ThemeError('iTerm2 색 파일 형식이 아니에요');
  // Newer iTerm2 exports carry separate (Dark)/(Light) variants; the plain key wins, then (Dark).
  const get = (key) => colorOf(root[key]) ?? colorOf(root[`${key} (Dark)`]);
  const ansi = Array.from({ length: 16 }, (_, i) => get(`Ansi ${i} Color`));
  const bad = Object.keys(root).filter((k) => / Color( \((Dark|Light)\))?$/.test(k) && !colorOf(root[k])).length;
  if (bad) warnings.push(`읽을 수 없는 색 ${bad}개를 건너뛰었어요`);
  const bg = get('Background Color');
  const fg = get('Foreground Color');
  if (!bg && !fg && !ansi.some(Boolean)) throw new ThemeError('iTerm2 색 파일에서 색을 찾지 못했어요');
  if (!bg || !fg) warnings.push('배경색이나 글자색이 없어 iTerm2 기본값으로 채웠어요');
  return {
    name: baseName(filename) || 'iTerm2 테마',
    base: { bg: bg ?? '#000000', fg: fg ?? '#c7c7c7', selection: get('Selection Color'), cursor: get('Cursor Color') },
    ansi: ansi.some(Boolean) ? ansi : [],
  };
}
