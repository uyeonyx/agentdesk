// Tokyo Night (folke/tokyonight.nvim): Night, Storm and Day styles with their terminal extras.
const syntaxDark = {
  keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', comment: '#565f89', function: '#7aa2f7', type: '#2ac3de',
  tag: '#f7768e', attr: '#73daca', punct: '#89ddff', variable: '#c0caf5', constant: '#ff9e64',
};
const ansiDark = (black) => [
  black, '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
  '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
];
const meta = { author: 'Folke Lemaitre', license: 'Apache-2.0', source: 'https://github.com/folke/tokyonight.nvim' };

export const tokyoNight = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  kind: 'dark',
  ...meta,
  base: { bg: '#1a1b26', fg: '#c0caf5', accent: '#7aa2f7', selection: '#283457', cursor: '#c0caf5' },
  ansi: ansiDark('#15161e'),
  syntax: syntaxDark,
  ambient: { stops: ['#7aa2f7', '#bb9af7', '#7dcfff'] },
};

export const tokyoNightStorm = {
  id: 'tokyo-night-storm',
  name: 'Tokyo Night Storm',
  kind: 'dark',
  ...meta,
  base: { bg: '#24283b', fg: '#c0caf5', accent: '#7aa2f7', selection: '#2e3c64', cursor: '#c0caf5' },
  ansi: ansiDark('#1d202f'),
  syntax: syntaxDark,
  ambient: { stops: ['#7aa2f7', '#bb9af7', '#73daca'] },
};

export const tokyoNightDay = {
  id: 'tokyo-night-day',
  name: 'Tokyo Night Day',
  kind: 'light',
  ...meta,
  base: { bg: '#e1e2e7', fg: '#3760bf', accent: '#2e7de9', selection: '#b7c1e3', cursor: '#3760bf' },
  ansi: [
    '#e9e9ed', '#f52a65', '#587539', '#8c6c3e', '#2e7de9', '#9854f1', '#007197', '#6172b0',
    '#a1a6c5', '#f52a65', '#587539', '#8c6c3e', '#2e7de9', '#9854f1', '#007197', '#3760bf',
  ],
  syntax: {
    keyword: '#9854f1', string: '#587539', number: '#b15c00', comment: '#848cb5', function: '#2e7de9', type: '#188092',
    tag: '#f52a65', attr: '#387068', punct: '#006a83', variable: '#3760bf', constant: '#b15c00',
  },
  ambient: { stops: ['#2e7de9', '#9854f1', '#007197'] },
};
