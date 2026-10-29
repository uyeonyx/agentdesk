// Nord (Arctic Ice Studio). Terminal palette from nord-iterm2; syntax from nord-visual-studio-code.
// Nord ships no light theme: Nord Light arranges the same palette on Snow Storm (nord6).
export const nord = {
  id: 'nord',
  name: 'Nord',
  kind: 'dark',
  author: 'Arctic Ice Studio',
  license: 'MIT',
  source: 'https://www.nordtheme.com/docs/colors-and-palettes',
  base: { bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0', selection: '#434c5e', cursor: '#d8dee9' },
  ansi: [
    '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
    '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4',
  ],
  syntax: {
    keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', comment: '#616e88', function: '#88c0d0', type: '#8fbcbb',
    tag: '#81a1c1', attr: '#8fbcbb', punct: '#eceff4', variable: '#d8dee9', constant: '#b48ead',
  },
  ambient: { stops: ['#5e81ac', '#88c0d0', '#b48ead'], speed: 50 },
};

export const nordLight = {
  id: 'nord-light',
  name: 'Nord Light',
  kind: 'light',
  author: 'Arctic Ice Studio (palette)',
  license: 'MIT',
  source: 'https://www.nordtheme.com/docs/colors-and-palettes',
  base: { bg: '#eceff4', fg: '#2e3440', accent: '#5e81ac', selection: '#d8dee9', cursor: '#4c566a' },
  ansi: [
    '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#d8dee9',
    '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#e5e9f0',
  ],
  syntax: {
    keyword: '#5e81ac', string: '#a3be8c', number: '#b48ead', comment: '#616e88', function: '#88c0d0', type: '#8fbcbb',
    tag: '#5e81ac', attr: '#8fbcbb', punct: '#4c566a', variable: '#2e3440', constant: '#b48ead',
  },
  ambient: { stops: ['#88c0d0', '#b48ead', '#a3be8c'], speed: 50 },
};
