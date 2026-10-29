// Catppuccin (catppuccin.com/palette). Terminal mapping as in the official terminal ports
// (black=surface1, white=subtext1, ...; Latte flips them); syntax roles per the VS Code port.
const flavors = {
  latte: {
    name: 'Latte', kind: 'light',
    rosewater: '#dc8a78', pink: '#ea76cb', mauve: '#8839ef', red: '#d20f39', peach: '#fe640b', yellow: '#df8e1d',
    green: '#40a02b', teal: '#179299', sapphire: '#209fb5', blue: '#1e66f5', lavender: '#7287fd',
    text: '#4c4f69', subtext1: '#5c5f77', subtext0: '#6c6f85', overlay2: '#7c7f93',
    surface2: '#acb0be', surface1: '#bcc0cc', base: '#eff1f5',
  },
  frappe: {
    name: 'Frappé', kind: 'dark',
    rosewater: '#f2d5cf', pink: '#f4b8e4', mauve: '#ca9ee6', red: '#e78284', peach: '#ef9f76', yellow: '#e5c890',
    green: '#a6d189', teal: '#81c8be', sapphire: '#85c1dc', blue: '#8caaee', lavender: '#babbf1',
    text: '#c6d0f5', subtext1: '#b5bfe2', subtext0: '#a5adce', overlay2: '#949cbb',
    surface2: '#626880', surface1: '#51576d', base: '#303446',
  },
  macchiato: {
    name: 'Macchiato', kind: 'dark',
    rosewater: '#f4dbd6', pink: '#f5bde6', mauve: '#c6a0f6', red: '#ed8796', peach: '#f5a97f', yellow: '#eed49f',
    green: '#a6da95', teal: '#8bd5ca', sapphire: '#7dc4e4', blue: '#8aadf4', lavender: '#b7bdf8',
    text: '#cad3f5', subtext1: '#b8c0e0', subtext0: '#a5adcb', overlay2: '#939ab7',
    surface2: '#5b6078', surface1: '#494d64', base: '#24273a',
  },
  mocha: {
    name: 'Mocha', kind: 'dark',
    rosewater: '#f5e0dc', pink: '#f5c2e7', mauve: '#cba6f7', red: '#f38ba8', peach: '#fab387', yellow: '#f9e2af',
    green: '#a6e3a1', teal: '#94e2d5', sapphire: '#74c7ec', blue: '#89b4fa', lavender: '#b4befe',
    text: '#cdd6f4', subtext1: '#bac2de', subtext0: '#a6adc8', overlay2: '#9399b2',
    surface2: '#585b70', surface1: '#45475a', base: '#1e1e2e',
  },
};

function catppuccin(id, p) {
  const light = p.kind === 'light';
  const [black, white, brBlack, brWhite] = light
    ? [p.subtext1, p.surface2, p.subtext0, p.surface1]
    : [p.surface1, p.subtext1, p.surface2, p.subtext0];
  return {
    id: `catppuccin-${id}`,
    name: `Catppuccin ${p.name}`,
    kind: p.kind,
    author: 'Catppuccin',
    license: 'MIT',
    source: 'https://catppuccin.com/palette',
    base: { bg: p.base, fg: p.text, accent: p.mauve, selection: p.surface2 + (light ? '80' : '99'), cursor: p.rosewater },
    ansi: [
      black, p.red, p.green, p.yellow, p.blue, p.pink, p.teal, white,
      brBlack, p.red, p.green, p.yellow, p.blue, p.pink, p.teal, brWhite,
    ],
    syntax: {
      keyword: p.mauve, string: p.green, number: p.peach, comment: p.overlay2, function: p.blue, type: p.yellow,
      tag: p.blue, attr: p.yellow, punct: p.overlay2, variable: p.text, constant: p.peach,
    },
    ambient: { stops: [p.mauve, p.sapphire, p.pink] },
  };
}

export const catppuccinLatte = catppuccin('latte', flavors.latte);
export const catppuccinFrappe = catppuccin('frappe', flavors.frappe);
export const catppuccinMacchiato = catppuccin('macchiato', flavors.macchiato);
export const catppuccinMocha = catppuccin('mocha', flavors.mocha);
