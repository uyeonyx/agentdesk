// Writes derived tokens onto the document. Values come from themes users import, so every one is
// checked against a strict whitelist before it reaches CSS; nothing is ever concatenated into a rule.
import { isColor } from './color.js';

const NAME = /^--[a-z0-9-]+$/;
const VALUE = /^-?\d{1,4}(?:\.\d{1,4})?(?:px|%|s)?$/;
// Exactly the box-shadow shapes derive.js writes: up to four "x y blur [spread] rgba(...)" layers.
const LEN = '-?\\d{1,3}(?:\\.\\d{1,3})?(?:px)?';
const RGBA = 'rgba\\(\\d{1,3}, \\d{1,3}, \\d{1,3}, (?:0|1|0?\\.\\d{1,3})\\)';
const LAYER = `(?:inset )?${LEN}(?: ${LEN}){1,3} ${RGBA}`;
const SHADOW = new RegExp(`^${LAYER}(?:, ${LAYER}){0,3}$`);

export const isSafeName = (n) => typeof n === 'string' && NAME.test(n);
export const isSafeValue = (v) => typeof v === 'string' && v.length <= 300 && (isColor(v) || VALUE.test(v) || SHADOW.test(v));

export function applyTheme(derived, root = document.documentElement) {
  const rejected = [];
  for (const [name, value] of Object.entries(derived?.vars ?? {})) {
    if (isSafeName(name) && isSafeValue(value)) root.style.setProperty(name, value);
    else rejected.push(name);
  }
  const kind = derived?.kind === 'light' ? 'light' : 'dark';
  root.style.colorScheme = kind;
  root.dataset.themeKind = kind;
  return { rejected };
}
