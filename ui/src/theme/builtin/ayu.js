// Ayu (ayu-theme/ayu-colors): editor and syntax colors, terminal palettes as in the Ayu terminal ports.
// Ayu writes comments/punctuation as translucent fg; they are flattened onto each background here.
const meta = { author: 'Ike Ku', license: 'MIT', source: 'https://github.com/ayu-theme/ayu-colors' };

export const ayuDark = {
  id: 'ayu-dark',
  name: 'Ayu Dark',
  kind: 'dark',
  ...meta,
  base: { bg: '#0b0e14', fg: '#bfbdb6', accent: '#e6b450', selection: '#409fff40', cursor: '#e6b450' },
  ansi: [
    '#11151c', '#ea6c73', '#7fd962', '#f9af4f', '#53bdfa', '#cda1fa', '#90e1c6', '#c7c7c7',
    '#686868', '#f07178', '#aad94c', '#ffb454', '#59c2ff', '#d2a6ff', '#95e6cb', '#ffffff',
  ],
  syntax: {
    keyword: '#ff8f40', string: '#aad94c', number: '#d2a6ff', comment: '#636a72', function: '#ffb454', type: '#59c2ff',
    tag: '#39bae6', attr: '#ffb454', punct: '#898886', variable: '#bfbdb6', constant: '#d2a6ff',
  },
  ambient: { stops: ['#e6b450', '#39bae6', '#d2a6ff'] },
};

export const ayuMirage = {
  id: 'ayu-mirage',
  name: 'Ayu Mirage',
  kind: 'dark',
  ...meta,
  base: { bg: '#1f2430', fg: '#cccac2', accent: '#ffcc66', selection: '#33415e', cursor: '#ffcc66' },
  ansi: [
    '#191e2a', '#ed8274', '#a6cc70', '#fad07b', '#6dcbfa', '#cfbafa', '#90e1c6', '#c7c7c7',
    '#686868', '#f28779', '#bae67e', '#ffd580', '#73d0ff', '#d4bfff', '#95e6cb', '#ffffff',
  ],
  syntax: {
    keyword: '#ffad66', string: '#d5ff80', number: '#dfbfff', comment: '#6c7a8b', function: '#ffd173', type: '#73d0ff',
    tag: '#5ccfe6', attr: '#ffd173', punct: '#989896', variable: '#cccac2', constant: '#dfbfff',
  },
  ambient: { stops: ['#ffcc66', '#73d0ff', '#dfbfff'] },
};

export const ayuLight = {
  id: 'ayu-light',
  name: 'Ayu Light',
  kind: 'light',
  ...meta,
  base: { bg: '#fcfcfc', fg: '#5c6166', accent: '#ffaa33', selection: '#035bd626', cursor: '#ffaa33' },
  ansi: [
    '#000000', '#ff3333', '#86b300', '#f29718', '#41a6d9', '#f07178', '#4dbf99', '#ffffff',
    '#323232', '#ff6565', '#b8e532', '#ffc94a', '#73d8ff', '#ffa3aa', '#7ff1cb', '#ffffff',
  ],
  syntax: {
    keyword: '#fa8d3e', string: '#86b300', number: '#a37acc', comment: '#a0a3a8', function: '#f2ae49', type: '#399ee6',
    tag: '#55b4d4', attr: '#f2ae49', punct: '#8d9094', variable: '#5c6166', constant: '#a37acc',
  },
  ambient: { stops: ['#ffaa33', '#399ee6', '#a37acc'] },
};
