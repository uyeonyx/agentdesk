// Kanagawa (rebelot/kanagawa.nvim): Wave and Lotus, with the plugin's terminal colors and syntax roles.
const meta = { author: 'Tommaso Laurenzi', license: 'MIT', source: 'https://github.com/rebelot/kanagawa.nvim' };

export const kanagawaWave = {
  id: 'kanagawa-wave',
  name: 'Kanagawa Wave',
  kind: 'dark',
  ...meta,
  base: { bg: '#1f1f28', fg: '#dcd7ba', accent: '#7e9cd8', selection: '#2d4f67', cursor: '#c8c093' },
  ansi: [
    '#16161d', '#c34043', '#76946a', '#c0a36e', '#7e9cd8', '#957fb8', '#6a9589', '#c8c093',
    '#727169', '#e82424', '#98bb6c', '#e6c384', '#7fb4ca', '#938aa9', '#7aa89f', '#dcd7ba',
  ],
  syntax: {
    keyword: '#957fb8', string: '#98bb6c', number: '#d27e99', comment: '#727169', function: '#7e9cd8', type: '#7aa89f',
    tag: '#7fb4ca', attr: '#e6c384', punct: '#9cabca', variable: '#dcd7ba', constant: '#ffa066',
  },
  ambient: { stops: ['#7e9cd8', '#957fb8', '#7aa89f'] },
};

export const kanagawaLotus = {
  id: 'kanagawa-lotus',
  name: 'Kanagawa Lotus',
  kind: 'light',
  ...meta,
  base: { bg: '#f2ecbc', fg: '#545464', accent: '#4d699b', selection: '#c9cbd1', cursor: '#43436c' },
  ansi: [
    '#1f1f28', '#c84053', '#6f894e', '#77713f', '#4d699b', '#b35b79', '#597b75', '#545464',
    '#8a8980', '#d7474b', '#6e915f', '#836f4a', '#6693bf', '#624c83', '#5e857a', '#43436c',
  ],
  syntax: {
    keyword: '#624c83', string: '#6f894e', number: '#b35b79', comment: '#8a8980', function: '#4d699b', type: '#597b75',
    tag: '#6693bf', attr: '#77713f', punct: '#4e8ca2', variable: '#545464', constant: '#cc6d00',
  },
  ambient: { stops: ['#4d699b', '#624c83', '#597b75'] },
};
