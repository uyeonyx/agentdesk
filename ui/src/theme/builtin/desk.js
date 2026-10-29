// Agent Desk's own themes: graphite neutrals, one cool blue-violet accent, an indigo/teal/violet aurora.
export const deskGlassDark = {
  id: 'desk-glass-dark',
  name: 'Desk Glass Dark',
  kind: 'dark',
  author: 'Agent Desk',
  license: 'MIT',
  base: { bg: '#16171d', fg: '#e6e8ef', accent: '#7c8cff', selection: '#7c8cff42', cursor: '#aab4ff' },
  ansi: [
    '#2a2c35', '#f2706b', '#4cc38a', '#f5b544', '#6e9eff', '#b392ff', '#4fd1d9', '#c5cad6',
    '#5d6270', '#ff8f8a', '#6fdba4', '#ffcb6b', '#93b7ff', '#cbb2ff', '#7fe3ea', '#f3f5fa',
  ],
  syntax: {
    keyword: '#b9a3ff', string: '#8fd9b6', number: '#f2b57d', comment: '#6c7383', function: '#8cb4ff', type: '#72d3dc',
    tag: '#f48a8f', attr: '#f0c784', punct: '#9aa1b0', variable: '#e0e3ec', constant: '#ffb48a',
  },
  ambient: { stops: ['#4f55e6', '#14a39a', '#8a57f0'], speed: 48 },
};

export const deskGlassLight = {
  id: 'desk-glass-light',
  name: 'Desk Glass Light',
  kind: 'light',
  author: 'Agent Desk',
  license: 'MIT',
  base: { bg: '#f7f8fa', fg: '#1c1e25', accent: '#5b5bd6', selection: '#5b5bd633', cursor: '#5b5bd6' },
  ansi: [
    '#1c1e25', '#d23f45', '#1d8b56', '#b7791f', '#2f66d0', '#7e4fd6', '#0f8790', '#a8adb8',
    '#6b7080', '#e5484d', '#2aa36b', '#d39b2f', '#4a83e8', '#9a6df0', '#20a5b0', '#d9dce3',
  ],
  syntax: {
    keyword: '#6a48d7', string: '#1b7a50', number: '#b0540c', comment: '#8b909c', function: '#2c5fc9', type: '#0c7782',
    tag: '#c33a40', attr: '#94600f', punct: '#5c6271', variable: '#1c1e25', constant: '#b0540c',
  },
  ambient: { stops: ['#a7abff', '#8fe0d6', '#d2b8ff'], speed: 52 },
};
