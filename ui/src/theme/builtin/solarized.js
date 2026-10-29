// Solarized (Ethan Schoonover). One fixed 16-color terminal palette for both modes;
// syntax roles follow VS Code's bundled Solarized themes.
const ansi = [
  '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
  '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3',
];
const meta = { author: 'Ethan Schoonover', license: 'MIT', source: 'https://ethanschoonover.com/solarized/' };
const syntax = (comment, punct) => ({
  keyword: '#859900', string: '#2aa198', number: '#d33682', comment, function: '#268bd2', type: '#cb4b16',
  tag: '#268bd2', attr: '#93a1a1', punct, variable: '#268bd2', constant: '#b58900',
});

export const solarizedDark = {
  id: 'solarized-dark',
  name: 'Solarized Dark',
  kind: 'dark',
  ...meta,
  base: { bg: '#002b36', fg: '#839496', accent: '#268bd2', selection: '#073642', cursor: '#839496' },
  ansi,
  syntax: syntax('#586e75', '#839496'),
  ambient: { stops: ['#268bd2', '#6c71c4', '#2aa198'] },
};

export const solarizedLight = {
  id: 'solarized-light',
  name: 'Solarized Light',
  kind: 'light',
  ...meta,
  base: { bg: '#fdf6e3', fg: '#657b83', accent: '#268bd2', selection: '#eee8d5', cursor: '#657b83' },
  ansi,
  syntax: syntax('#93a1a1', '#657b83'),
  ambient: { stops: ['#268bd2', '#6c71c4', '#2aa198'] },
};
