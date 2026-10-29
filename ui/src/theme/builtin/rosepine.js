// Rosé Pine (rosepinetheme.com/palette). Terminal mapping from the official ports:
// black=overlay, red=love, green=pine, yellow=gold, blue=foam, magenta=iris, cyan=rose, white=text.
const variant = (id, name, kind, p) => ({
  id,
  name,
  kind,
  author: 'Rosé Pine',
  license: 'MIT',
  source: 'https://rosepinetheme.com/palette',
  base: { bg: p.base, fg: p.text, accent: p.iris, selection: p.hlMed, cursor: p.hlHigh },
  ansi: [
    p.overlay, p.love, p.pine, p.gold, p.foam, p.iris, p.rose, p.text,
    p.muted, p.love, p.pine, p.gold, p.foam, p.iris, p.rose, p.text,
  ],
  syntax: {
    keyword: p.pine, string: p.gold, number: p.gold, comment: p.muted, function: p.rose, type: p.foam,
    tag: p.foam, attr: p.iris, punct: p.subtle, variable: p.text, constant: p.gold,
  },
  ambient: { stops: [p.iris, p.rose, p.pine] },
});

export const rosePine = variant('rose-pine', 'Rosé Pine', 'dark', {
  base: '#191724', overlay: '#26233a', muted: '#6e6a86', subtle: '#908caa', text: '#e0def4', love: '#eb6f92',
  gold: '#f6c177', rose: '#ebbcba', pine: '#31748f', foam: '#9ccfd8', iris: '#c4a7e7', hlMed: '#403d52', hlHigh: '#524f67',
});
export const rosePineMoon = variant('rose-pine-moon', 'Rosé Pine Moon', 'dark', {
  base: '#232136', overlay: '#393552', muted: '#6e6a86', subtle: '#908caa', text: '#e0def4', love: '#eb6f92',
  gold: '#f6c177', rose: '#ea9a97', pine: '#3e8fb0', foam: '#9ccfd8', iris: '#c4a7e7', hlMed: '#44415a', hlHigh: '#56526e',
});
export const rosePineDawn = variant('rose-pine-dawn', 'Rosé Pine Dawn', 'light', {
  base: '#faf4ed', overlay: '#f2e9e1', muted: '#9893a5', subtle: '#797593', text: '#575279', love: '#b4637a',
  gold: '#ea9d34', rose: '#d7827e', pine: '#286983', foam: '#56949f', iris: '#907aa9', hlMed: '#dfdad9', hlHigh: '#cecacd',
});
