// Gruvbox (morhetz/gruvbox): terminal palettes and syntax roles from the original Vim theme.
const meta = { author: 'Pavel Pertsev', license: 'MIT', source: 'https://github.com/morhetz/gruvbox' };

export const gruvboxDark = {
  id: 'gruvbox-dark',
  name: 'Gruvbox Dark',
  kind: 'dark',
  ...meta,
  base: { bg: '#282828', fg: '#ebdbb2', accent: '#fe8019', selection: '#504945', cursor: '#ebdbb2' },
  ansi: [
    '#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
    '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2',
  ],
  syntax: {
    keyword: '#fb4934', string: '#b8bb26', number: '#d3869b', comment: '#928374', function: '#b8bb26', type: '#fabd2f',
    tag: '#83a598', attr: '#8ec07c', punct: '#a89984', variable: '#83a598', constant: '#d3869b',
  },
  ambient: { stops: ['#fe8019', '#d3869b', '#83a598'] },
};

export const gruvboxLight = {
  id: 'gruvbox-light',
  name: 'Gruvbox Light',
  kind: 'light',
  ...meta,
  base: { bg: '#fbf1c7', fg: '#3c3836', accent: '#af3a03', selection: '#d5c4a1', cursor: '#3c3836' },
  ansi: [
    '#fbf1c7', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#7c6f64',
    '#928374', '#9d0006', '#79740e', '#b57614', '#076678', '#8f3f71', '#427b58', '#3c3836',
  ],
  syntax: {
    keyword: '#9d0006', string: '#79740e', number: '#8f3f71', comment: '#928374', function: '#79740e', type: '#b57614',
    tag: '#076678', attr: '#427b58', punct: '#7c6f64', variable: '#076678', constant: '#8f3f71',
  },
  ambient: { stops: ['#d65d0e', '#b16286', '#458588'] },
};
