// The app's own two palettes, set by hand (0.7 standard: instrument panel, color strength 85). These
// are Desk Light and Desk Dark, and the shape every other theme is laid onto (palette.js): the same
// roles, steps and contrast floors, filled with that theme's colors.

import { parseColor, contrast, WHITE } from './color.js';

const INK = parseColor('#05070a');

const LIGHT = {
  bg: '#f4f6fb',
  chrome: '#f8fafd',
  surface: '#ffffff',
  'surface-2': '#eff3fa',
  hover: '#eef2fa',
  pressed: '#e5ebf6',
  line: '#e3e8f1',
  'line-2': '#cbd3df',
  text: '#1a1e26',
  'text-2': '#3b4350',
  'text-3': '#5f6a7b',
  'accent-fill': '#4368d6',
  'accent-fill-ink': '#ffffff',
  'accent-text': '#3d5fc9',
  'accent-soft': '#ecf1ff',
  'accent-line': '#4a70e0',
  'accent-mark': '#476ee0',
  warn: '#f29432',
  'warn-text': '#a4581a',
  'warn-soft': '#fff1df',
  info: '#476ee0',
  ok: '#32ab6c',
  'ok-text': '#227a4b',
  'ok-soft': '#e8f6ee',
  danger: '#dc5447',
  'danger-text': '#b13b31',
  'danger-soft': '#fdeeec',
  idle: '#c3c9d3',
  'code-bg': '#f3f6fc',
  'user-bg': '#ecf1ff',
  'add-bg': '#e8f6ee',
  'add-mark': '#c6ebd5',
  add: '#227a4b',
  'del-bg': '#fdeeec',
  'del-mark': '#f8cfc9',
  del: '#b13b31',
  win: '#eef2fb',
  'warn-win': '#ffe8ca',
  'info-win': '#dfe8ff',
  'act-read': '#9aa6b8',
  'act-edit': '#476ee0',
  'act-cmd': '#b65bb0',
  'act-web': '#1f9eb2',
  selection: 'rgba(67, 104, 214, 0.22)',
  scrim: 'rgba(244, 246, 251, 0.8)',
  frame: 'rgba(30, 45, 80, 0.1)',
  'e-0': '0 0 0 1px rgba(30, 45, 80, 0.06), 0 1px 3px -1px rgba(30, 45, 80, 0.07)',
  'e-1': '0 0 0 1px rgba(30, 45, 80, 0.08), 0 4px 12px -2px rgba(30, 45, 80, 0.08), 0 12px 32px -12px rgba(30, 45, 80, 0.14)',
  'e-2': '0 0 0 1px rgba(30, 45, 80, 0.08), 0 24px 56px -20px rgba(30, 45, 80, 0.3)',
};

const DARK = {
  bg: '#0f1218',
  chrome: '#12161d',
  surface: '#181d25',
  'surface-2': '#1f2530',
  hover: '#232a36',
  pressed: '#2a3240',
  line: '#2a313d',
  'line-2': '#3b4452',
  text: '#edf0f4',
  'text-2': '#c7cdd6',
  'text-3': '#9ba5b4',
  'accent-fill': '#6384de',
  'accent-fill-ink': '#0d1424',
  'accent-text': '#aabef6',
  'accent-soft': '#212d4b',
  'accent-line': '#6687e3',
  'accent-mark': '#809ef4',
  warn: '#f5a445',
  'warn-text': '#f4c895',
  'warn-soft': '#2d2416',
  info: '#809ef4',
  ok: '#59d18f',
  'ok-text': '#a2dfbb',
  'ok-soft': '#15291e',
  danger: '#f07767',
  'danger-text': '#f4b1a7',
  'danger-soft': '#351d1d',
  idle: '#6c7686',
  'code-bg': '#1f2530',
  'user-bg': '#212d4b',
  'add-bg': '#15291e',
  'add-mark': '#1f4a31',
  add: '#a2dfbb',
  'del-bg': '#351d1d',
  'del-mark': '#5a2a27',
  del: '#f4b1a7',
  win: '#0b0e14',
  'warn-win': '#33230f',
  'info-win': '#19284b',
  'act-read': '#6c7686',
  'act-edit': '#809ef4',
  'act-cmd': '#d58bd0',
  'act-web': '#4cc3d4',
  selection: 'rgba(128, 158, 244, 0.3)',
  scrim: 'rgba(15, 18, 24, 0.8)',
  frame: 'rgba(255, 255, 255, 0.07)',
  'e-0': '0 0 0 1px rgba(255, 255, 255, 0.06), 0 1px 2px rgba(0, 0, 0, 0.3)',
  'e-1': '0 0 0 1px rgba(255, 255, 255, 0.08), 0 12px 32px -12px rgba(0, 0, 0, 0.6)',
  'e-2': '0 0 0 1px rgba(255, 255, 255, 0.08), 0 24px 56px -20px rgba(0, 0, 0, 0.7)',
};

export const BASE = { light: LIGHT, dark: DARK };

/** The CSS variables for one palette (a theme's, or the hand-set one), with the picked accent over it. */
export function uiVars(kind, accent, palette = BASE[kind === 'light' ? 'light' : 'dark']) {
  const p = { ...palette, ...(accent || {}) };
  const v = {};
  for (const [k, c] of Object.entries(p)) v[`--${k}`] = c;
  // Ink on a solid status color: near-black, or white when the color is too deep for it.
  for (const s of ['warn', 'ok', 'danger']) v[`--${s}-ink`] = contrast(INK, parseColor(p[s])) >= contrast(WHITE, parseColor(p[s])) ? '#05070a' : '#ffffff';
  return v;
}

/** Every name uiVars writes: the app's whole color contract. */
export const UI_TOKENS = [...Object.keys(LIGHT), 'warn-ink', 'ok-ink', 'danger-ink'];
