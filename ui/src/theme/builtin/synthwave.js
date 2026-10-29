// SynthWave '84 by Robb Owen. Terminal black/white slots follow VS Code's defaults, as the theme leaves them unset.
export const synthwave84 = {
  id: 'synthwave-84',
  name: "SynthWave '84",
  kind: 'dark',
  author: 'Robb Owen',
  license: 'MIT',
  source: 'https://github.com/robb0wen/synthwave-vscode',
  base: { bg: '#262335', fg: '#ffffff', accent: '#ff7edb', selection: '#ffffff20', cursor: '#f97e72' },
  ansi: [
    '#000000', '#fe4450', '#72f1b8', '#f3e70f', '#03edf9', '#ff7edb', '#03edf9', '#e5e5e5',
    '#666666', '#fe4450', '#72f1b8', '#fede5d', '#03edf9', '#ff7edb', '#03edf9', '#ffffff',
  ],
  syntax: {
    keyword: '#fede5d', string: '#ff8b39', number: '#f97e72', comment: '#848bbd', function: '#36f9f6', type: '#fe4450',
    tag: '#72f1b8', attr: '#fede5d', punct: '#bbbbbb', variable: '#ff7edb', constant: '#f97e72',
  },
  ambient: { stops: ['#ff7edb', '#f97e72', '#36f9f6'], speed: 30 },
  glass: { glow: true },
};
