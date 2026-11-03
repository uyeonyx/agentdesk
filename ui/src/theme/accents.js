// Accent colors a person can pick for the app (primary buttons, selection, meters). Each has a
// light-screen and a dark-screen shade; the rest of the set (text, soft fill, ink) is worked out so
// it reads on the app's own surfaces. Blue is the standard and needs no override.
import { parseColor, toHex, mix, contrast, ensureContrast } from './color.js';
import { BASE } from './base.js';

export const ACCENTS = [
  { id: 'blue', name: '파랑', light: '#4368d6', dark: '#6384de' },
  { id: 'teal', name: '청록', light: '#008093', dark: '#45b9cb' },
  { id: 'green', name: '초록', light: '#118552', dark: '#4fc283' },
  { id: 'orange', name: '주황', light: '#b45e15', dark: '#eb9a4a' },
  { id: 'rose', name: '장미', light: '#c2456b', dark: '#e88aa6' },
  { id: 'graphite', name: '흑연', light: '#3b4350', dark: '#c7cdd6' },
];

/** The accent tokens for a picked accent, or null for the standard blue (and unknown ids). */
export function accentSet(id, kind) {
  const a = ACCENTS.find((x) => x.id === id);
  if (!a || a.id === 'blue') return null;
  const p = BASE[kind === 'light' ? 'light' : 'dark'];
  const fill = parseColor(kind === 'light' ? a.light : a.dark);
  const surface = parseColor(p.surface);
  const white = parseColor('#ffffff');
  const deep = parseColor(kind === 'light' ? '#1a1e26' : '#0d1424');
  const ink = contrast(white, fill) >= contrast(deep, fill) ? white : deep;
  // A selected row is drawn on the soft fill, its time and path in --text-3: keep those readable.
  const text3 = parseColor(p['text-3']);
  let ratio = kind === 'light' ? 0.1 : 0.2;
  let soft = mix(surface, fill, ratio);
  while (contrast(text3, soft) < 4.56 && ratio > 0.06) soft = mix(surface, fill, (ratio -= 0.02));
  const text = ensureContrast(fill, [surface, soft], 4.56);
  return {
    'accent-fill': toHex(fill),
    'accent-fill-ink': toHex(ink),
    'accent-text': toHex(text),
    'accent-soft': toHex(soft),
    'accent-line': toHex(fill),
    'accent-mark': toHex(fill),
    info: toHex(fill),
    'user-bg': toHex(soft),
    'info-win': toHex(mix(parseColor(p.win), fill, kind === 'light' ? 0.12 : 0.2)),
  };
}
