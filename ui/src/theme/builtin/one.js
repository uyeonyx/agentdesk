// Atom One Dark / One Light. Syntax from Atom's one-dark-syntax / one-light-syntax; terminal palettes
// from onedark.vim (dark) and sonph/onehalf (light), the usual terminal companions.
export const oneDark = {
  id: 'one-dark',
  name: 'One Dark',
  kind: 'dark',
  author: 'Atom (GitHub)',
  license: 'MIT',
  source: 'https://github.com/atom/atom/tree/master/packages/one-dark-syntax',
  base: { bg: '#282c34', fg: '#abb2bf', accent: '#61afef', selection: '#3e4451', cursor: '#528bff' },
  ansi: [
    '#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
    '#5c6370', '#be5046', '#98c379', '#d19a66', '#61afef', '#c678dd', '#56b6c2', '#ffffff',
  ],
  syntax: {
    keyword: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#5c6370', function: '#61afef', type: '#e5c07b',
    tag: '#e06c75', attr: '#d19a66', punct: '#abb2bf', variable: '#e06c75', constant: '#d19a66',
  },
  ambient: { stops: ['#61afef', '#c678dd', '#56b6c2'] },
};

export const oneLight = {
  id: 'one-light',
  name: 'One Light',
  kind: 'light',
  author: 'Atom (GitHub)',
  license: 'MIT',
  source: 'https://github.com/atom/atom/tree/master/packages/one-light-syntax',
  base: { bg: '#fafafa', fg: '#383a42', accent: '#4078f2', selection: '#e5e5e6', cursor: '#526fff' },
  ansi: [
    '#383a42', '#e45649', '#50a14f', '#c18401', '#0184bc', '#a626a4', '#0997b3', '#fafafa',
    '#4f525e', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff',
  ],
  syntax: {
    keyword: '#a626a4', string: '#50a14f', number: '#986801', comment: '#a0a1a7', function: '#4078f2', type: '#c18401',
    tag: '#e45649', attr: '#986801', punct: '#383a42', variable: '#e45649', constant: '#986801',
  },
  ambient: { stops: ['#4078f2', '#a626a4', '#0184bc'] },
};
