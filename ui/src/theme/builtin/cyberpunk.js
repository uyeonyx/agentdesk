// Cyberpunk, Cyberpunk Umbra and Cyberpunk Scarlet: the VS Code theme family
// (https://github.com/prometheux-ar/cyberpunk, formerly max-SS/cyberpunk). Colors are the
// themes' own; the theme ships no terminal palette, so the 16 colors are built from its syntax colors.

// The three share their syntax colors.
const syntax = {
  keyword: '#d57bff', string: '#76c1ff', number: '#fffc58', comment: '#6766b3', function: '#00b0ff', type: '#00ff9c',
  tag: '#ff5680', attr: '#ee6dff', punct: '#00b0ff', variable: '#eeffff', constant: '#fffc58',
};
const ansi = (black) => [
  black, '#ff3270', '#00ff9c', '#fffc58', '#00b0ff', '#d57bff', '#00ffc8', '#eeffff',
  '#6766b3', '#ff5680', '#00ff6a', '#fffc58', '#76c1ff', '#ee6dff', '#98e3ff', '#ffffff',
];
// Green is the theme's text color, so "waiting on me" takes its yellow; red stays for failures.
const status = { ok: '#00ff6a', warn: '#fffc58', danger: '#ff3270', info: '#00b0ff' };
const meta = { kind: 'dark', author: 'Max Pfeiffer', license: 'GPL-3.0', source: 'https://github.com/prometheux-ar/cyberpunk' };

// Neon green on deep violet.
export const cyberpunk = {
  ...meta,
  id: 'cyberpunk',
  name: 'Cyberpunk',
  base: { bg: '#261d45', fg: '#00ff9c', accent: '#00ff9c', selection: '#311b92', cursor: '#00ff6a' },
  ansi: ansi('#100d23'),
  syntax,
  ui: { ...status, 'bg-app': '#100d23', 'bg-raised': '#372963', 'text-2': '#b08bff', 'text-3': '#7877b3', 'accent-ink': '#00140b', 'accent-text': '#00ffc8', 'term-fg': '#00ffc8' },
  ambient: { stops: ['#5c35b1', '#00e676', '#372963'], speed: 60 },
};

// The same neon on near-black navy, with blue instead of violet.
export const cyberpunkUmbra = {
  ...meta,
  id: 'cyberpunk-umbra',
  name: 'Cyberpunk Umbra',
  base: { bg: '#100d23', fg: '#00ff9c', accent: '#00ff9c', selection: '#311b92', cursor: '#00ff6a' },
  ansi: ansi('#1e1d45'),
  syntax,
  ui: { ...status, 'bg-raised': '#1e1d45', 'text-2': '#8b96ff', 'text-3': '#7877b3', 'accent-ink': '#00140b', 'accent-text': '#3d5afe', 'term-fg': '#00ff6a' },
  ambient: { stops: ['#3d5afe', '#131341', '#00ff6a'], speed: 60 },
};

// Scarlet on black, cyan for links and the cursor. Long reading text takes the theme's light scarlet
// (its title bar color); the pure #ff0055 is barely AA, so it marks secondary text, buttons and lines.
export const cyberpunkScarlet = {
  ...meta,
  id: 'cyberpunk-scarlet',
  name: 'Cyberpunk Scarlet',
  base: { bg: '#101116', fg: '#ff0055', accent: '#ff0055', selection: '#ff005540', cursor: '#00ffc8' },
  ansi: ansi('#0a0b0e'),
  syntax,
  ui: { ...status, 'bg-app': '#0a0b0e', text: '#ff8ba8', 'text-2': '#ff0055', 'text-3': '#be4e74', 'accent-text': '#00ffc8', 'term-fg': '#00a2ff' },
  ambient: { stops: ['#4a0018', '#140009', '#002a40'], speed: 60 },
};
