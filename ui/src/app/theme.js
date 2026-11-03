// The person's theme, live. The screen is light, dark, or follows the system; each kind has its own
// theme (pref.light / pref.dark), which colors the whole app. Applied as CSS variables and handed to
// xterm, Monaco and the window chrome. The choice lives in the main process, so every window follows it.
import { deriveTokens, applyTheme, findTheme, BUILTIN_THEMES, DEFAULT_DARK_ID, DEFAULT_LIGHT_ID } from '../theme/index.js';
import { api } from '../api.js';
import { set } from '../store.js';

export const DEFAULT_PREF = { mode: 'system', light: DEFAULT_LIGHT_ID, dark: DEFAULT_DARK_ID, fixed: DEFAULT_DARK_ID, accent: 'theme' };

let pref = { ...DEFAULT_PREF };
let userThemes = [];
let derived = null;
let currentId = null;
let previewId = null;
const listeners = new Set();
const darkMq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const clearMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-transparency: reduce)') : null;
let systemDark = darkMq ? darkMq.matches : true;

export function onTheme(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const themePref = () => pref;
export const currentThemeId = () => currentId;
export const currentTokens = () => derived;

/** Which screen is showing: 'light' or 'dark'. */
export function screenKind() {
  if (pref.mode === 'light' || pref.mode === 'dark') return pref.mode;
  if (pref.mode === 'fixed') return findTheme(pref.fixed, userThemes)?.kind || pref.fixedKind || 'dark';
  return systemDark ? 'dark' : 'light';
}

function resolveId() {
  if (previewId) return previewId;
  if (pref.mode === 'fixed') return pref.fixed;
  return screenKind() === 'dark' ? pref.dark : pref.light;
}

// 0.6 and before: "always this theme" (mode fixed). It becomes that screen with that theme on it.
function migrate(p) {
  if (p.mode !== 'fixed') return p;
  const t = findTheme(p.fixed);
  const kind = t?.kind || p.fixedKind;
  if (kind !== 'light' && kind !== 'dark') return p;
  return t ? { ...p, mode: kind, [kind]: t.id } : { ...p, mode: kind };
}

function apply({ animate = false } = {}) {
  const id = resolveId();
  const theme = findTheme(id, userThemes) || findTheme(systemDark ? DEFAULT_DARK_ID : DEFAULT_LIGHT_ID);
  derived = deriveTokens(theme, { accent: pref.accent });
  currentId = theme.id;
  const commit = () => {
    const root = document.documentElement;
    applyTheme(derived, root);
    root.dataset.glass = 'off';
    for (const fn of listeners) fn(derived);
  };
  // A soft cross-fade between themes; previews switch at once so arrowing through stays quick.
  if (animate && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(commit);
  else commit();
  if (!previewId) window.desk?.setChrome?.({ scheme: derived.kind, bg: derived.chrome.bg, fg: derived.chrome.fg });
}

export async function bootTheme() {
  try {
    const p = await window.desk?.themePrefs?.();
    if (p) pref = migrate({ ...DEFAULT_PREF, ...p });
  } catch {}
  apply();
  darkMq?.addEventListener('change', (e) => {
    systemDark = e.matches;
    apply({ animate: true });
  });
  clearMq?.addEventListener('change', () => apply());
  window.desk?.onThemePrefs?.((p) => {
    pref = { ...DEFAULT_PREF, ...p };
    set({ theme: pref });
    apply({ animate: true });
  });
  set({ theme: pref });
}

/** The person's imported themes, from ~/.agentdesk/themes. */
export async function loadUserThemes() {
  try {
    const r = await api('GET', '/api/themes');
    userThemes = r.themes || [];
    set({ userThemes });
    if (userThemes.some((t) => t.id === resolveId())) apply();
  } catch {}
}

export function savePref(patch) {
  pref = { ...pref, ...patch };
  set({ theme: pref });
  // The app needs the fixed theme's kind to match its own menus and title bar to it.
  window.desk?.setThemePrefs?.({ ...pref, fixedKind: screenKind() });
  apply({ animate: true });
}

/** Pick a theme: it becomes the theme of the screen of its own kind (light or dark). */
export function chooseTheme(id) {
  previewId = null;
  const t = findTheme(id, userThemes);
  if (!t) return;
  const kind = t.kind === 'light' ? 'light' : 'dark';
  savePref(pref.mode === 'fixed' ? { mode: screenKind(), [kind]: id } : { [kind]: id });
}

export function previewTheme(id) {
  if (previewId === id) return;
  previewId = id;
  apply();
}
export function endPreview() {
  if (!previewId) return;
  previewId = null;
  apply();
}

export function themeList() {
  return [...BUILTIN_THEMES, ...userThemes].map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    user: !BUILTIN_THEMES.includes(t),
    preview: { bg: t.base.bg, fg: t.base.fg, accent: t.base.accent || t.ansi[4], ok: t.ansi[2], warn: t.ansi[3], danger: t.ansi[1], amb: t.ambient?.stops || [t.ansi[5], t.ansi[6]] },
  }));
}

export async function saveUserTheme(theme) {
  await api('POST', `/api/themes/${encodeURIComponent(theme.id)}`, theme);
  await loadUserThemes();
}
export async function removeUserTheme(id) {
  await api('DELETE', `/api/themes/${encodeURIComponent(id)}`);
  if (pref.light === id || pref.dark === id || pref.fixed === id) savePref({ light: pref.light === id ? DEFAULT_LIGHT_ID : pref.light, dark: pref.dark === id ? DEFAULT_DARK_ID : pref.dark, fixed: pref.fixed === id ? DEFAULT_DARK_ID : pref.fixed });
  await loadUserThemes();
}

/** For terminals: the theme's colors with the project's color for the cursor. */
export function xtermTheme(roomColor) {
  const x = derived?.xterm || {};
  return roomColor ? { ...x, cursor: roomColor, cursorAccent: x.background } : x;
}
export const monacoTheme = () => derived?.monaco;
