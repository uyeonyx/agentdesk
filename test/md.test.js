// Conversation rendering: markdown/ANSI/diff/highlight trees built from untrusted agent text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mdTree, fileRefOf } from '../ui/src/md/parse.js';
import { ansiSegments } from '../ui/src/md/ansi.js';
import { diffRows, wordDiff } from '../ui/src/md/diffview.js';
import { highlightTree, peekHighlight, langOf, langId } from '../ui/src/md/highlight.js';

const MD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'src', 'md');

const text = (t) => ({ t: 'text', text: t });
const one = (md) => mdTree(md)[0];
const walk = (nodes, fn) => nodes?.forEach((n) => (fn(n), walk(n.kids, fn)));
const tags = (md) => {
  const s = new Set();
  walk(mdTree(md), (n) => n.t === 'tag' && s.add(n.tag));
  return s;
};
const plainText = (nodes) => (nodes || []).map((n) => (n.t === 'text' ? n.text : plainText(n.kids))).join('');
const find = (md, tag) => {
  const out = [];
  walk(mdTree(md), (n) => n.tag === tag && out.push(n));
  return out;
};

// ---- markdown -------------------------------------------------------------------------------

test('headings: h1–h4 kept, h5/h6 folded into h4', () => {
  assert.deepEqual(
    mdTree('# a\n## b\n### c\n#### d\n##### e\n###### f').map((n) => n.tag),
    ['h1', 'h2', 'h3', 'h4', 'h4', 'h4'],
  );
  assert.deepEqual(one('## Hello').kids, [text('Hello')]);
});

test('paragraph with inline strong, em, del, code, br, escapes and entities', () => {
  const p = one('**b** *e* ~~d~~ `c` \\*lit\\* &amp; &lt;x&gt; &copy; a  \nb');
  assert.equal(p.tag, 'p');
  assert.deepEqual(p.kids, [
    { t: 'tag', tag: 'strong', kids: [text('b')] },
    text(' '),
    { t: 'tag', tag: 'em', kids: [text('e')] },
    text(' '),
    { t: 'tag', tag: 'del', kids: [text('d')] },
    text(' '),
    { t: 'tag', tag: 'code', kids: [text('c')] },
    text(' *lit* & <x> © a'),
    { t: 'tag', tag: 'br' },
    text('b'),
  ]);
});

test('inline code keeps its characters verbatim', () => {
  assert.deepEqual(one('`a < b && c &amp; d`').kids, [{ t: 'tag', tag: 'code', kids: [text('a < b && c &amp; d')] }]);
});

test('lists: ordered with start, unordered, nested', () => {
  const ol = one('3. three\n4. four');
  assert.equal(ol.tag, 'ol');
  assert.deepEqual(ol.props, { start: 3 });
  assert.deepEqual(ol.kids.map((li) => plainText(li.kids)), ['three', 'four']);
  assert.equal(one('1. a\n2. b').props, undefined, 'start=1 is the default');

  const ul = one('- a\n  - b\n- c');
  assert.equal(ul.tag, 'ul');
  assert.equal(ul.kids.length, 2);
  assert.deepEqual(ul.kids[0].kids[0], text('a'));
  assert.equal(ul.kids[0].kids[1].tag, 'ul');
  assert.deepEqual(ul.kids[0].kids[1].kids[0].kids, [text('b')]);
});

test('task list items get a disabled checkbox, tight or loose', () => {
  const ul = one('- [ ] todo\n- [x] done');
  assert.deepEqual(ul.kids[0], {
    t: 'tag',
    tag: 'li',
    props: { class: 'task' },
    kids: [{ t: 'tag', tag: 'input', props: { type: 'checkbox', checked: false, disabled: true } }, text('todo')],
  });
  assert.equal(ul.kids[1].kids[0].props.checked, true);

  const loose = one('- [x] a\n\n- [ ] b');
  const p = loose.kids[0].kids[0];
  assert.equal(p.tag, 'p');
  assert.deepEqual(p.kids[0].props, { type: 'checkbox', checked: true, disabled: true });
  assert.deepEqual(p.kids[1], text('a'));
});

test('tables carry column alignment and sit in a scroll wrapper', () => {
  const wrap = one('| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | **2** | 3 | 4 |');
  assert.deepEqual(wrap.props, { class: 'tablewrap' });
  const [thead, tbody] = wrap.kids[0].kids;
  assert.equal(wrap.kids[0].tag, 'table');
  assert.deepEqual(thead.kids[0].kids.map((th) => [th.tag, th.props?.align]), [
    ['th', 'left'],
    ['th', 'center'],
    ['th', 'right'],
    ['th', undefined],
  ]);
  const cells = tbody.kids[0].kids;
  assert.deepEqual(cells.map((td) => td.props?.align), ['left', 'center', 'right', undefined]);
  assert.deepEqual(cells[1].kids, [{ t: 'tag', tag: 'strong', kids: [text('2')] }]);
});

test('blockquote, hr and fenced/indented code blocks', () => {
  const [bq, hr, fenced, bare, indented] = mdTree('> quoted **x**\n\n---\n\n```ts title="a"\nlet x = 1\n```\n\n```\nplain\n```\n\n    four');
  assert.equal(bq.tag, 'blockquote');
  assert.equal(bq.kids[0].tag, 'p');
  assert.deepEqual(hr, { t: 'tag', tag: 'hr' });
  assert.deepEqual(fenced, { t: 'tag', tag: 'codeblock', props: { lang: 'ts', code: 'let x = 1' } });
  assert.deepEqual(bare.props, { lang: '', code: 'plain' });
  assert.deepEqual(indented.props, { lang: '', code: 'four' });
});

test('http(s) links and autolinks become safe anchors', () => {
  const [a, , auto, , www] = one('[docs](https://example.com/a?b=1 "T") <https://x.dev> www.y.com').kids;
  assert.deepEqual(a, {
    t: 'tag',
    tag: 'a',
    props: { href: 'https://example.com/a?b=1', rel: 'noopener noreferrer', target: '_blank', title: 'T' },
    kids: [text('docs')],
  });
  assert.equal(auto.props.href, 'https://x.dev/');
  assert.equal(www.props.href, 'http://www.y.com/');
});

test('unsafe or non-http links render as their label text', () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', '/relative', '../up', '#frag', 'vbscript:x']) {
    const p = one(`before [label](${href}) after`);
    assert.deepEqual(p.kids, [text('before label after')], href);
  }
  assert.deepEqual(one('mail <a@b.co>').kids, [text('mail a@b.co')]);
  assert.ok(!tags('[x](javascript:alert(1)) [y](data:x) [z](file:///a)').has('a'));
});

test('raw HTML shows as literal text, block and inline', () => {
  const [script, img, para] = mdTree('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\nhi <b onclick="x()">bold</b> there');
  assert.deepEqual(script, { t: 'tag', tag: 'p', kids: [text('<script>alert(1)</script>')] });
  assert.deepEqual(img.kids, [text('<img src=x onerror=alert(1)>')]);
  assert.deepEqual(para.kids, [text('hi <b onclick="x()">bold</b> there')]);
});

test('images never become img tags', () => {
  assert.deepEqual(one('![shot](https://example.com/a.png)').kids, [
    { t: 'tag', tag: 'a', props: { href: 'https://example.com/a.png', rel: 'noopener noreferrer', target: '_blank' }, kids: [text('shot')] },
  ]);
  assert.deepEqual(one('![](https://example.com/a.png)').kids[0].kids, [text('https://example.com/a.png')]);
  assert.deepEqual(one('![alt](javascript:alert(1)) ![x](data:image/png;base64,AAAA)').kids, [text('alt x')]);
});

test('hostile input only ever yields whitelisted tags and http(s) hrefs', () => {
  const evil = [
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">x</a> [a](<javascript:alert(1)>)',
    '<style>*{}</style>\n\n<svg onload=alert(1)>',
    '[x](  javascript:alert(1)  ) [y](java\nscript:alert(1)) [z](&#106;avascript:alert(1))',
    '![i](https://x/a.png)<img src=x>',
    '<details><summary>s</summary>\n\n**b**\n\n</details>',
  ].join('\n\n');
  const allowed = new Set('h1 h2 h3 h4 p strong em del code br a ul ol li input table thead tbody tr th td div blockquote hr codeblock fileref'.split(' '));
  walk(mdTree(evil), (n) => {
    if (n.t !== 'tag') return;
    assert.ok(allowed.has(n.tag), `unexpected tag ${n.tag}`);
    if (n.tag === 'a') assert.match(n.props.href, /^https?:\/\//);
    for (const k of Object.keys(n.props || {})) assert.ok(!/^on/i.test(k), `event prop ${k}`);
  });
});

test('file-like inline code becomes a fileref, not inside links', () => {
  assert.deepEqual(one('open `src/app.ts:12`').kids[1], {
    t: 'tag',
    tag: 'fileref',
    props: { path: 'src/app.ts', line: 12, end: null },
    kids: [text('src/app.ts:12')],
  });
  assert.deepEqual(one('`console.log`').kids[0].tag, 'code');
  const [a] = one('[`src/a.ts`](https://x.dev)').kids;
  assert.equal(a.kids[0].tag, 'code', 'no button nested in an anchor');
});

test('fileRefOf accepts paths and line suffixes', () => {
  const ok = {
    'src/app.ts': ['src/app.ts', null, null],
    'src/app.ts:12': ['src/app.ts', 12, null],
    './a/b.js:3-9': ['./a/b.js', 3, 9],
    '../x/y.py': ['../x/y.py', null, null],
    'README.md': ['README.md', null, null],
    'package.json': ['package.json', null, null],
    '/abs/path/main.go:7': ['/abs/path/main.go', 7, null],
    '~/notes/todo.txt': ['~/notes/todo.txt', null, null],
    'app/[id]/page.tsx': ['app/[id]/page.tsx', null, null],
    '.github/workflows/ci.yml': ['.github/workflows/ci.yml', null, null],
    'src\\win\\file.cs:4': ['src\\win\\file.cs', 4, null],
    'tsc/err.ts:10:5': ['tsc/err.ts', 10, null],
  };
  for (const [s, [p, line, end]] of Object.entries(ok)) assert.deepEqual(fileRefOf(s), { path: p, line, end }, s);
});

test('fileRefOf rejects code, prose, URLs and globs', () => {
  for (const s of [
    'console.log', 'process.env', 'foo.bar', 'Next.js', 'node.js', 'v1.2.3', '1.5', 'a/b/1.2', 'src/app', 'npm run build',
    'foo bar.md', 'https://x.com/a.js', 'http://localhost:3000/a.ts', 'github.com/a/b.md', '*.ts', 'src/**/*.ts',
    '.json', 'x.verylongext', 'fn(a.ts)', '', 'README.md:', 'a.ts:x',
  ]) assert.equal(fileRefOf(s), null, s);
});

test('mdTree memoizes by input and survives empty input', () => {
  assert.equal(mdTree('same **text**'), mdTree('same **text**'));
  assert.deepEqual(mdTree(''), []);
  assert.deepEqual(mdTree(undefined), []);
});

// ---- ANSI -----------------------------------------------------------------------------------

const E = '\x1b[';

test('ansi: plain text is one segment, empty is none', () => {
  assert.deepEqual(ansiSegments('hello\tworld\n'), [{ text: 'hello\tworld\n' }]);
  assert.deepEqual(ansiSegments(''), []);
});

test('ansi: basic, bright and background colors with resets', () => {
  assert.deepEqual(ansiSegments(`${E}31mred${E}39m ${E}92;44mhi${E}49mx${E}0m.`), [
    { text: 'red', fg: { ansi: 1 } },
    { text: ' ' },
    { text: 'hi', fg: { ansi: 10 }, bg: { ansi: 4 } },
    { text: 'x', fg: { ansi: 10 } },
    { text: '.' },
  ]);
  assert.deepEqual(ansiSegments(`${E}103mY${E}m`), [{ text: 'Y', bg: { ansi: 11 } }]);
});

test('ansi: 256-color and truecolor', () => {
  assert.deepEqual(ansiSegments(`${E}38;5;9ma${E}38;5;208mb${E}38;5;232mc${E}48;5;255md${E}0m`), [
    { text: 'a', fg: { ansi: 9 } },
    { text: 'b', fg: { hex: '#ff8700' } },
    { text: 'c', fg: { hex: '#080808' } },
    { text: 'd', fg: { hex: '#080808' }, bg: { hex: '#eeeeee' } },
  ]);
  assert.deepEqual(ansiSegments(`${E}38;2;255;0;128;1mt${E}48;2;1;2;3mu`), [
    { text: 't', fg: { hex: '#ff0080' }, bold: true },
    { text: 'u', fg: { hex: '#ff0080' }, bold: true, bg: { hex: '#010203' } },
  ]);
  assert.deepEqual(ansiSegments(`${E}38:2::10:20:30mv`), [{ text: 'v', fg: { hex: '#0a141e' } }], 'ITU colon form');
  assert.deepEqual(ansiSegments(`${E}38;2;999;0;0mw`), [{ text: 'w' }], 'out-of-range ignored');
});

test('ansi: bold/dim/italic/underline and their resets', () => {
  assert.deepEqual(ansiSegments(`${E}1;3;4mA${E}22mB${E}2mC${E}22;23;24mD${E}1mE${E}0mF`), [
    { text: 'A', bold: true, italic: true, underline: true },
    { text: 'B', italic: true, underline: true },
    { text: 'C', italic: true, underline: true, dim: true },
    { text: 'D' },
    { text: 'E', bold: true },
    { text: 'F' },
  ]);
});

test('ansi: OSC 8 hyperlinks, titles and cursor codes are stripped, text kept', () => {
  assert.deepEqual(ansiSegments('see \x1b]8;;https://x.dev\x1b\\the docs\x1b]8;;\x1b\\ now'), [{ text: 'see the docs now' }]);
  assert.deepEqual(ansiSegments('\x1b]0;title\x07a\x1b]8;;u\x07b\x1b]8;;\x07'), [{ text: 'ab' }]);
  assert.deepEqual(ansiSegments(`${E}2K${E}1A${E}?25l${E}3;4Hx${E}?25h${E}Jy\x1b7z\x1b8\x1b(B`), [{ text: 'xyz' }]);
  assert.deepEqual(ansiSegments('a\x00b\x07c\x08d\x7fe\x1bPdcs\x1b\\f'), [{ text: 'abcdef' }]);
});

test('ansi: carriage returns keep the text written last on the line', () => {
  assert.deepEqual(ansiSegments('progress 10%\rprogress 100%\ndone'), [{ text: 'progress 100%\ndone' }]);
  assert.deepEqual(ansiSegments('a\r\nb\r\n'), [{ text: 'a\nb\n' }], 'CRLF is a plain newline');
  assert.deepEqual(ansiSegments('keep\r'), [{ text: 'keep' }], 'nothing written after \\r');
  assert.deepEqual(ansiSegments(`${E}31m1/3\r${E}32m3/3${E}0m\nok`), [{ text: '3/3', fg: { ansi: 2 } }, { text: '\nok' }]);
  assert.deepEqual(ansiSegments(`old${E}1Gnew`), [{ text: 'new' }], 'cursor to column 1 acts like \\r');
});

// ---- diff -----------------------------------------------------------------------------------

test('diffRows numbers both sides and puts a gap between hunks', () => {
  const rows = diffRows([
    { a: 10, b: 10, lines: [' keep', '-gone', '-gone2', '+new', ' tail', '\\ No newline at end of file'] },
    { a: 40, b: 39, lines: ['+added', ' ctx'] },
  ]);
  assert.deepEqual(
    rows.map(({ kind, aLine, bLine, text }) => [kind, aLine, bLine, text]),
    [
      ['ctx', 10, 10, 'keep'],
      ['del', 11, null, 'gone'],
      ['del', 12, null, 'gone2'],
      ['add', null, 11, 'new'],
      ['ctx', 13, 12, 'tail'],
      ['gap', null, null, ''],
      ['add', null, 39, 'added'],
      ['ctx', 40, 40, 'ctx'],
    ],
  );
  assert.ok(rows.every((r) => !r.parts), 'multi-line del block is not a one-line edit');
});

test('diffRows without line numbers and with empty context lines', () => {
  const rows = diffRows([{ a: null, b: null, lines: ['', '-x', '+y'] }]);
  assert.deepEqual(rows.map((r) => [r.kind, r.aLine, r.bLine, r.text]), [
    ['ctx', null, null, ''],
    ['del', null, null, 'x'],
    ['add', null, null, 'y'],
  ]);
  assert.deepEqual(diffRows([]), []);
});

test('one-line edits get word parts; unrelated lines do not', () => {
  const [del, add] = diffRows([{ a: 1, b: 1, lines: ['-const total = sum(a, b);', '+const total = sum(a, b, c);'] }]);
  assert.deepEqual(del.parts, [{ text: 'const total = sum(a, b);', changed: false }]);
  assert.deepEqual(add.parts, [
    { text: 'const total = sum(a, b', changed: false },
    { text: ', c', changed: true },
    { text: ');', changed: false },
  ]);
  const [d2, a2] = diffRows([{ a: 1, b: 1, lines: ['-alpha beta', '+gamma delta'] }]);
  assert.equal(d2.parts, undefined);
  assert.equal(a2.parts, undefined);
});

test('wordDiff marks changed tokens and caps long lines', () => {
  assert.deepEqual(wordDiff('let x = foo(1)', 'let y = foo(2)'), {
    old: [
      { text: 'let ', changed: false },
      { text: 'x', changed: true },
      { text: ' = foo(', changed: false },
      { text: '1', changed: true },
      { text: ')', changed: false },
    ],
    new: [
      { text: 'let ', changed: false },
      { text: 'y', changed: true },
      { text: ' = foo(', changed: false },
      { text: '2', changed: true },
      { text: ')', changed: false },
    ],
  });
  assert.deepEqual(wordDiff('같은 줄', '같은 줄'), { old: [{ text: '같은 줄', changed: false }], new: [{ text: '같은 줄', changed: false }] });
  const long = 'x '.repeat(250);
  assert.deepEqual(wordDiff(long, long + 'y'), { old: [{ text: long, changed: true }], new: [{ text: long + 'y', changed: true }] });
});

// ---- highlight ------------------------------------------------------------------------------

// token class → texts
function classes(tree) {
  const m = {};
  walk(tree, (n) => n.t === 'tag' && (m[n.props.class] ||= []).push(plainText(n.kids)));
  return m;
}

test('highlightTree: typescript tokens', async () => {
  const code = 'import { x } from "y";\n// note\nclass Foo { n = 42; run(a: string) { return /re/g.test(a) ? true : null; } }';
  const tree = await highlightTree(code, 'ts');
  assert.equal(plainText(tree), code, 'text is preserved exactly');
  const c = classes(tree);
  assert.ok(c['tok-keyword'].includes('import') && c['tok-keyword'].includes('class') && c['tok-keyword'].includes('return'));
  assert.deepEqual(c['tok-string'], ['"y"']);
  assert.deepEqual(c['tok-comment'], ['// note']);
  assert.deepEqual(c['tok-type'], ['Foo']);
  assert.deepEqual(c['tok-number'], ['42']);
  assert.ok(c['tok-function'].includes('run'));
  assert.deepEqual(c['tok-regexp'], ['/re/g']);
  assert.deepEqual(c['tok-constant'], ['true', 'null']);
  assert.ok(Object.keys(c).every((k) => /^tok-[a-z]+$/.test(k)));
});

test('highlightTree: python and bash tokens', async () => {
  const py = classes(await highlightTree('@cache\ndef f(x):\n    return x + 1  # inc', 'py'));
  assert.deepEqual(py['tok-meta'], ['@cache']);
  assert.deepEqual(py['tok-function'], ['f']);
  assert.deepEqual(py['tok-variable'], ['x']);
  assert.deepEqual(py['tok-comment'], ['# inc']);
  assert.ok(py['tok-keyword'].includes('def'));

  const sh = classes(await highlightTree('echo "hi $HOME" # greet\nif [ -f x ]; then ls; fi', 'sh'));
  assert.ok(sh['tok-keyword'].includes('if') && sh['tok-keyword'].includes('echo'));
  assert.deepEqual(sh['tok-string'], ['"hi $HOME"']);
  assert.deepEqual(sh['tok-variable'], ['$HOME']);
  assert.deepEqual(sh['tok-comment'], ['# greet']);
});

test('highlightTree: unknown or missing language stays plain; results are cached', async () => {
  assert.deepEqual(await highlightTree('just <text>', 'brainfuck'), [text('just <text>')]);
  assert.deepEqual(await highlightTree('x', ''), [text('x')]);
  assert.deepEqual(await highlightTree('', 'ts'), []);
  assert.deepEqual(peekHighlight('plain', 'nope'), [text('plain')]);
  assert.equal(peekHighlight('let fresh = 1', 'ts'), null, 'not highlighted yet');
  const first = await highlightTree('let fresh = 1', 'ts');
  assert.equal(peekHighlight('let fresh = 1', 'typescript'), first, 'aliases share the cache');
  assert.equal(await highlightTree('let fresh = 1', 'ts'), first);
});

test('language ids from fences and paths', () => {
  assert.deepEqual(['js', 'tsx', 'zsh', 'console', 'py', 'rs', 'yml', 'html', 'toml', 'diff', 'C++', ' JSON '].map(langId), [
    'javascript', 'typescript', 'bash', 'shell', 'python', 'rust', 'yaml', 'xml', 'ini', 'diff', 'cpp', 'json',
  ]);
  assert.equal(langId('cobol'), null);
  assert.deepEqual(['src/a.tsx', 'b.mjs', 'Cargo.toml', 'x/y.PY', 'k.kts', '.zshrc', '.env.local', 'Gemfile', 'Makefile', 'noext', 'a.zzz'].map(langOf), [
    'typescript', 'javascript', 'ini', 'python', 'kotlin', 'bash', 'ini', 'ruby', null, null, null,
  ]);
});

// ---- guard ----------------------------------------------------------------------------------

test('renderer sources never inject HTML strings', () => {
  const files = fs.readdirSync(MD_DIR, { recursive: true }).filter((f) => /\.(m?js|jsx)$/.test(f));
  assert.ok(files.length >= 8, `expected md sources, got ${files}`);
  for (const f of files) {
    const src = fs.readFileSync(path.join(MD_DIR, f), 'utf8');
    assert.doesNotMatch(src, /innerHTML|outerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write/, f);
  }
});
