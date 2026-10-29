// Windows Terminal color scheme: a single scheme object, or a settings.json with a `schemes` array
// (first scheme wins). Windows Terminal calls magenta "purple".
import { ThemeError } from '../schema.js';
import { hexish, isObj, parseJsonc } from './util.js';

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white'];
const KEYS = [...NAMES, ...NAMES.map((n) => `bright${n[0].toUpperCase()}${n.slice(1)}`)];

export const looksLikeWterm = (obj) =>
  isObj(obj) && (Array.isArray(obj.schemes) || (('background' in obj || 'foreground' in obj) && ('brightBlack' in obj || 'purple' in obj)));

export function importWterm(obj, { warnings }) {
  let scheme = obj;
  if (isObj(obj) && Array.isArray(obj.schemes)) {
    const list = obj.schemes.filter(isObj);
    if (!list.length) throw new ThemeError('Windows Terminal 설정에 색 구성표가 없어요');
    scheme = list[0];
    if (list.length > 1) warnings.push(`색 구성표 ${list.length}개 중 첫 번째만 가져왔어요`);
  }
  if (!isObj(scheme)) throw new ThemeError('Windows Terminal 색 구성표 형식이 아니에요');
  const ansi = KEYS.map((k) => hexish(scheme[k]));
  const bad = [...KEYS, 'background', 'foreground', 'cursorColor', 'selectionBackground']
    .filter((k) => scheme[k] !== undefined && !hexish(scheme[k])).length;
  if (bad) warnings.push(`잘못된 색 값 ${bad}개를 건너뛰었어요`);
  const bg = hexish(scheme.background);
  const fg = hexish(scheme.foreground);
  if (!bg && !fg && !ansi.some(Boolean)) throw new ThemeError('Windows Terminal 색 구성표에서 색을 찾지 못했어요');
  // Campbell, Windows Terminal's default scheme, fills what's missing.
  if (!bg || !fg) warnings.push('배경색이나 글자색이 없어 Windows Terminal 기본값으로 채웠어요');
  return {
    name: typeof scheme.name === 'string' && scheme.name.trim() ? scheme.name : 'Windows Terminal 테마',
    base: {
      bg: bg ?? '#0c0c0c',
      fg: fg ?? '#cccccc',
      selection: hexish(scheme.selectionBackground),
      cursor: hexish(scheme.cursorColor),
    },
    ansi: ansi.some(Boolean) ? ansi : [],
  };
}

export const importWtermText = (text, ctx) => importWterm(parseJsonc(text), ctx);
