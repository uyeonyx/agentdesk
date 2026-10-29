// GitHub themes (primer/github-vscode-theme): editor, terminal and "prettylights" syntax colors.
const meta = { author: 'GitHub', license: 'MIT', source: 'https://github.com/primer/github-vscode-theme' };

export const githubDark = {
  id: 'github-dark',
  name: 'GitHub Dark',
  kind: 'dark',
  ...meta,
  base: { bg: '#0d1117', fg: '#e6edf3', accent: '#2f81f7', selection: '#264f78', cursor: '#2f81f7' },
  ansi: [
    '#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4',
    '#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff',
  ],
  syntax: {
    keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', comment: '#8b949e', function: '#d2a8ff', type: '#ffa657',
    tag: '#7ee787', attr: '#79c0ff', punct: '#e6edf3', variable: '#ffa657', constant: '#79c0ff',
  },
  ambient: { stops: ['#1f6feb', '#8957e5', '#3fb950'] },
};

export const githubDarkDimmed = {
  id: 'github-dark-dimmed',
  name: 'GitHub Dark Dimmed',
  kind: 'dark',
  ...meta,
  base: { bg: '#22272e', fg: '#adbac7', accent: '#539bf5', selection: '#2e4c77', cursor: '#539bf5' },
  ansi: [
    '#545d68', '#f47067', '#57ab5a', '#c69026', '#539bf5', '#b083f0', '#39c5cf', '#909dab',
    '#636e7b', '#ff938a', '#6bc46d', '#daaa3f', '#6cb6ff', '#dcbdfb', '#56d4dd', '#cdd9e5',
  ],
  syntax: {
    keyword: '#f47067', string: '#96d0ff', number: '#6cb6ff', comment: '#768390', function: '#dcbdfb', type: '#f69d50',
    tag: '#8ddb8c', attr: '#6cb6ff', punct: '#adbac7', variable: '#f69d50', constant: '#6cb6ff',
  },
  ambient: { stops: ['#539bf5', '#986ee2', '#57ab5a'] },
};

export const githubLight = {
  id: 'github-light',
  name: 'GitHub Light',
  kind: 'light',
  ...meta,
  base: { bg: '#ffffff', fg: '#1f2328', accent: '#0969da', selection: '#0969da33', cursor: '#0969da' },
  ansi: [
    '#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
    '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f',
  ],
  syntax: {
    keyword: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', function: '#8250df', type: '#953800',
    tag: '#116329', attr: '#0550ae', punct: '#1f2328', variable: '#953800', constant: '#0550ae',
  },
  // Primer's functional colors: the terminal yellow here is a dark brown that reads poorly as "warning".
  ui: { ok: '#1a7f37', warn: '#bf8700', danger: '#cf222e', info: '#0969da' },
  ambient: { stops: ['#0969da', '#8250df', '#1a7f37'] },
};
