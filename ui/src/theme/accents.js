// Accent colors a person can lay over any theme, the way macOS does: a dark-theme and a light-theme
// shade of each, both deep enough to carry white text on a filled button.
export const ACCENTS = [
  { id: 'blue', name: '파랑', dark: '#2b6af0', light: '#0a66d9' },
  { id: 'purple', name: '보라', dark: '#7c3aed', light: '#7c3aed' },
  { id: 'pink', name: '분홍', dark: '#db2777', light: '#c2185b' },
  { id: 'red', name: '빨강', dark: '#dc2626', light: '#c81e1e' },
  { id: 'orange', name: '주황', dark: '#c2410c', light: '#c2410c' },
  { id: 'green', name: '초록', dark: '#15803d', light: '#15803d' },
  { id: 'teal', name: '청록', dark: '#0f766e', light: '#0f766e' },
  { id: 'graphite', name: '흑연', dark: '#ededef', light: '#1b1c1f' },
];

// A theme's own accent tokens give way to the picked one.
const ACCENT_UI = ['accent', 'accent-ink', 'accent-text', 'accent-soft', 'accent-line', 'focus', 'glow-color'];

/** The theme with the picked accent in place of its own; unknown ids ('theme') leave it as it is. */
export function withAccent(theme, id) {
  const a = ACCENTS.find((x) => x.id === id);
  if (!a || !theme) return theme;
  const ui = theme.ui ? Object.fromEntries(Object.entries(theme.ui).filter(([k]) => !ACCENT_UI.includes(k))) : undefined;
  return { ...theme, base: { ...theme.base, accent: theme.kind === 'light' ? a.light : a.dark }, ...(ui ? { ui } : {}) };
}
