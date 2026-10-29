// Ghostty theme file: `key = value` lines, `palette = N=#rrggbb`. The file name is the theme name.
import { ThemeError } from '../schema.js';
import { hexish, configLines, baseName } from './util.js';

const BASE = { background: 'bg', foreground: 'fg', 'cursor-color': 'cursor', 'selection-background': 'selection' };

export function importGhostty(text, { filename, warnings }) {
  const ansi = [];
  const base = {};
  let bad = 0;
  for (const [key, value] of configLines(text, '=')) {
    if (key === 'palette') {
      const m = /^(\d{1,3})\s*=\s*(\S+)$/.exec(value);
      const c = m && hexish(m[2]);
      if (!c) bad++;
      else if (+m[1] < 16) ansi[+m[1]] = c;
    } else if (BASE[key]) {
      const c = hexish(value);
      if (c) base[BASE[key]] = c;
      else bad++;
    }
  }
  if (!base.bg && !base.fg && !ansi.some(Boolean)) throw new ThemeError('Ghostty 테마에서 색을 찾지 못했어요');
  if (bad) warnings.push(`읽을 수 없는 색 ${bad}개를 건너뛰었어요`);
  // Ghostty's own defaults for anything the file leaves out.
  if (!base.bg || !base.fg) warnings.push('배경색이나 글자색이 없어 Ghostty 기본값으로 채웠어요');
  return {
    name: baseName(filename) || 'Ghostty 테마',
    base: { bg: base.bg ?? '#282c34', fg: base.fg ?? '#ffffff', selection: base.selection, cursor: base.cursor },
    ansi: ansi.some(Boolean) ? Array.from({ length: 16 }, (_, i) => ansi[i]) : [],
  };
}
