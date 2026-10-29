// kitty color config (*.conf): `color0 #000000`, `background #...`. kitty-themes files carry
// `## name:` / `## author:` / `## license:` / `## upstream:` metadata comments, which we keep.
import { ThemeError } from '../schema.js';
import { hexish, configLines, baseName } from './util.js';

const BASE = { background: 'bg', foreground: 'fg', cursor: 'cursor', selection_background: 'selection' };

export function importKitty(text, { filename, warnings }) {
  const meta = {};
  for (const m of text.matchAll(/^##\s*(name|author|license|upstream)\s*:\s*(.+)$/gim)) meta[m[1].toLowerCase()] = m[2].trim();
  const ansi = [];
  const base = {};
  let bad = 0;
  for (const [key, value] of configLines(text, ' ')) {
    const slot = /^color(\d{1,3})$/.exec(key);
    const target = slot ? (+slot[1] < 16 ? +slot[1] : null) : BASE[key];
    if (target === null || target === undefined) continue;
    const c = hexish(value.split(/\s+/)[0]);
    if (!c) bad++;
    else if (typeof target === 'number') ansi[target] = c;
    else base[target] = c;
  }
  if (!base.bg && !base.fg && !ansi.some(Boolean)) throw new ThemeError('kitty 테마에서 색을 찾지 못했어요');
  if (bad) warnings.push(`읽을 수 없는 색 ${bad}개를 건너뛰었어요`);
  if (!base.bg || !base.fg) warnings.push('배경색이나 글자색이 없어 kitty 기본값으로 채웠어요');
  return {
    name: meta.name || baseName(filename) || 'kitty 테마',
    author: meta.author,
    license: meta.license,
    source: meta.upstream,
    base: { bg: base.bg ?? '#000000', fg: base.fg ?? '#dddddd', selection: base.selection, cursor: base.cursor },
    ansi: ansi.some(Boolean) ? Array.from({ length: 16 }, (_, i) => ansi[i]) : [],
  };
}
