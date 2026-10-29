// Original genre palette: blue-black night, neon magenta and cyan, acid yellow. Glows.
export const cyberpunk = {
  id: 'cyberpunk',
  name: 'Cyberpunk',
  kind: 'dark',
  author: 'Agent Desk',
  license: 'MIT',
  base: { bg: '#0b0a14', fg: '#e6f0ff', accent: '#ff2bd6', selection: '#ff2bd640', cursor: '#00f0ff' },
  ansi: [
    '#1b1930', '#ff3b5c', '#00ff9c', '#f9f002', '#2e8bff', '#ff2bd6', '#00f0ff', '#c8d3ec',
    '#4b4870', '#ff6b85', '#5effc0', '#fffa70', '#6aaeff', '#ff6fe4', '#6bf7ff', '#ffffff',
  ],
  syntax: {
    keyword: '#ff2bd6', string: '#f9f002', number: '#ff9a3d', comment: '#6d6a94', function: '#00f0ff', type: '#b07bff',
    tag: '#ff3b5c', attr: '#00ff9c', punct: '#8e8bb8', variable: '#e6f0ff', constant: '#ff9a3d',
  },
  ambient: { stops: ['#ff2bd6', '#00e5ff', '#7a3cff'], speed: 26 },
  glass: { alpha: 0.56, glow: true },
};
