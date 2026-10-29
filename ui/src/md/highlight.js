// Code → plain tree of `tok-*` spans via lowlight (hast, no HTML strings). Grammars load on first use.
import { lru } from './lru.js';

// Fence names and aliases → grammar registered in grammars.js. `shell` is the hljs session grammar
// ($ prompts + output), so it only serves console-like fences; scripts go to bash.
const LANG = {};
const alias = (name, names) => names.split(' ').forEach((k) => (LANG[k] = name));
alias('javascript', 'javascript js jsx mjs cjs node');
alias('typescript', 'typescript ts tsx mts cts');
alias('json', 'json jsonc json5');
alias('bash', 'bash sh zsh shell fish ksh');
alias('shell', 'console shellsession terminal');
alias('python', 'python py py3 python3 pyi');
alias('rust', 'rust rs');
alias('go', 'go golang');
alias('java', 'java');
alias('kotlin', 'kotlin kt kts');
alias('swift', 'swift');
alias('c', 'c h');
alias('cpp', 'cpp c++ cc cxx hpp hh hxx');
alias('ruby', 'ruby rb gemfile rakefile');
alias('php', 'php');
alias('css', 'css scss less');
alias('xml', 'xml html htm xhtml svg plist vue svelte');
alias('yaml', 'yaml yml');
alias('sql', 'sql psql mysql postgres postgresql sqlite');
alias('diff', 'diff patch udiff');
alias('markdown', 'markdown md mdx');
alias('ini', 'ini toml cfg conf properties dotenv env');

/** Fence name → registered grammar, or null (render plain). */
export function langId(lang) {
  return LANG[String(lang ?? '').trim().toLowerCase()] || null;
}

/** File path → grammar by extension (or dotfile name), or null. */
export function langOf(path) {
  const base = String(path ?? '').split(/[\\/]/).pop().toLowerCase();
  if (base === 'gemfile' || base === 'rakefile') return 'ruby';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  if (ext === 'bashrc' || ext === 'zshrc' || ext === 'profile') return 'bash';
  if (ext === 'env' || base.startsWith('.env')) return 'ini';
  return ext ? langId(ext) : null;
}

// hljs scope (class list joined with dots, `_` suffixes dropped) → token class suffix.
const SCOPE = {
  keyword: 'keyword', built_in: 'keyword', 'variable.language': 'keyword',
  literal: 'constant', symbol: 'constant', 'variable.constant': 'constant',
  title: 'function', 'title.function': 'function', 'title.class': 'type', type: 'type', class: 'type',
  attr: 'attr', attribute: 'attr', 'selector-attr': 'attr', 'selector-class': 'attr', 'selector-id': 'attr', 'selector-pseudo': 'attr',
  name: 'tag', 'selector-tag': 'tag',
  string: 'string', 'template-string': 'string', char: 'string',
  number: 'number',
  comment: 'comment', quote: 'comment',
  variable: 'variable', params: 'variable', 'template-variable': 'variable',
  meta: 'meta', section: 'meta',
  regexp: 'regexp',
  punctuation: 'punct', operator: 'punct', bullet: 'punct',
  addition: 'add', deletion: 'del', // diff fences
};

function tokClass(classNames) {
  if (!classNames?.length) return null;
  const parts = [String(classNames[0]).replace(/^hljs-/, ''), ...classNames.slice(1).map((c) => String(c).replace(/_+$/, ''))];
  // Most specific first: title.function.invoke → title.function → title
  for (let k = parts.length; k > 0; k--) {
    const hit = SCOPE[parts.slice(0, k).join('.')];
    if (hit) return 'tok-' + hit;
  }
  return null;
}

function pushText(out, text) {
  const last = out[out.length - 1];
  if (last?.t === 'text') last.text += text;
  else out.push({ t: 'text', text });
}

// Unmapped scopes flatten into their parent so the tree only carries classes we style.
function convert(nodes, out = []) {
  for (const n of nodes || []) {
    if (n.type === 'text') pushText(out, n.value);
    else if (n.type === 'element') {
      const cls = tokClass(n.properties?.className);
      if (cls) out.push({ t: 'tag', tag: 'span', props: { class: cls }, kids: convert(n.children) });
      else convert(n.children, out);
    }
  }
  return out;
}

const plain = (code) => (code ? [{ t: 'text', text: code }] : []);
const MAX = 100_000; // huge blocks: highlighting would stall the renderer for little gain
const cache = lru(200);
let grammars = null;

/** Cached result if ready: the tree, plain text for unhighlightable input, or null (needs highlightTree). */
export function peekHighlight(code, lang) {
  const src = String(code ?? '');
  const id = langId(lang);
  if (!id || src.length > MAX) return plain(src);
  return cache.get(id + '\0' + src) || null;
}

/** Highlighted plain tree for code in the given fence language; unknown languages stay plain. */
export async function highlightTree(code, lang) {
  const src = String(code ?? '');
  const id = langId(lang);
  if (!id || src.length > MAX) return plain(src);
  const key = id + '\0' + src;
  const hit = cache.get(key);
  if (hit) return hit;
  grammars ??= import('./grammars.js').catch((e) => {
    grammars = null; // let a later block retry a failed chunk load
    throw e;
  });
  const { lowlight } = await grammars;
  return cache.set(key, convert(lowlight.highlight(id, src).children));
}
