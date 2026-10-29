// Everforest (sainnhe/everforest), medium contrast. Terminal slots map the palette the way the plugin does.
const meta = { author: 'Sainnhe Park', license: 'MIT', source: 'https://github.com/sainnhe/everforest' };

export const everforestDark = {
  id: 'everforest-dark',
  name: 'Everforest Dark',
  kind: 'dark',
  ...meta,
  base: { bg: '#2d353b', fg: '#d3c6aa', accent: '#a7c080', selection: '#543a48', cursor: '#d3c6aa' },
  ansi: [
    '#475258', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa',
    '#7a8478', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa',
  ],
  syntax: {
    keyword: '#e67e80', string: '#83c092', number: '#d699b6', comment: '#859289', function: '#a7c080', type: '#dbbc7f',
    tag: '#e69875', attr: '#dbbc7f', punct: '#9da9a0', variable: '#7fbbb3', constant: '#83c092',
  },
  ambient: { stops: ['#a7c080', '#83c092', '#7fbbb3'] },
};

export const everforestLight = {
  id: 'everforest-light',
  name: 'Everforest Light',
  kind: 'light',
  ...meta,
  base: { bg: '#fdf6e3', fg: '#5c6a72', accent: '#8da101', selection: '#eaedc8', cursor: '#5c6a72' },
  ansi: [
    '#5c6a72', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#e6e2cc',
    '#829181', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#fdf6e3',
  ],
  syntax: {
    keyword: '#f85552', string: '#35a77c', number: '#df69ba', comment: '#939f91', function: '#8da101', type: '#dfa000',
    tag: '#f57d26', attr: '#dfa000', punct: '#829181', variable: '#3a94c5', constant: '#35a77c',
  },
  ambient: { stops: ['#8da101', '#35a77c', '#3a94c5'] },
};
