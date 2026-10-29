// Dracula, per the official spec (draculatheme.com/spec), including its ANSI palette.
export const dracula = {
  id: 'dracula',
  name: 'Dracula',
  kind: 'dark',
  author: 'Zeno Rocha',
  license: 'MIT',
  source: 'https://draculatheme.com/spec',
  base: { bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9', selection: '#44475a', cursor: '#f8f8f2' },
  ansi: [
    '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
    '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff',
  ],
  syntax: {
    keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', function: '#50fa7b', type: '#8be9fd',
    tag: '#ff79c6', attr: '#50fa7b', punct: '#f8f8f2', variable: '#f8f8f2', constant: '#bd93f9',
  },
  ambient: { stops: ['#bd93f9', '#ff79c6', '#8be9fd'] },
};
