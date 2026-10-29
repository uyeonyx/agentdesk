// Monokai (Wimer Hazenberg), as bundled with VS Code, including VS Code's Monokai terminal colors.
export const monokai = {
  id: 'monokai',
  name: 'Monokai',
  kind: 'dark',
  author: 'Wimer Hazenberg',
  license: 'MIT',
  source: 'https://github.com/microsoft/vscode/tree/main/extensions/theme-monokai',
  base: { bg: '#272822', fg: '#f8f8f2', accent: '#66d9ef', selection: '#49483e', cursor: '#f8f8f0' },
  ansi: [
    '#333333', '#c4265e', '#86b42b', '#b3b42b', '#6a7ec8', '#8c6bc8', '#56adbc', '#e3e3dd',
    '#666666', '#f92672', '#a6e22e', '#e2e22e', '#819aff', '#ae81ff', '#66d9ef', '#f8f8f2',
  ],
  syntax: {
    keyword: '#f92672', string: '#e6db74', number: '#ae81ff', comment: '#75715e', function: '#a6e22e', type: '#66d9ef',
    tag: '#f92672', attr: '#a6e22e', punct: '#f8f8f2', variable: '#f8f8f2', constant: '#ae81ff',
  },
  ambient: { stops: ['#f92672', '#ae81ff', '#66d9ef'] },
};
