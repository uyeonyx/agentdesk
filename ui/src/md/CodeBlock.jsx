import { useEffect, useState } from 'preact/hooks';
import { highlightTree, peekHighlight } from './highlight.js';

// Highlight trees are flat-ish spans from highlight.js; nothing else reaches here.
const spans = (list) => list.map((n, i) => (n.t === 'text' ? n.text : <span key={i} class={n.props.class}>{spans(n.kids)}</span>));

/** Fenced code: plain text first, highlighted spans swapped in when ready (same font, no reflow). */
export function CodeBlock({ lang = '', code = '' }) {
  // Tagged with its input so a late result for older (streamed) code never shows over newer code.
  const [hl, setHl] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    highlightTree(code, lang)
      .then((tree) => alive && setHl({ code, lang, tree }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [code, lang]);

  const tree = hl && hl.code === code && hl.lang === lang ? hl.tree : peekHighlight(code, lang);
  const copy = () => {
    window.desk?.copy?.(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div class="codeblock">
      <div class="codebar">
        <span class="lang">{lang}</span>
        <button type="button" class="copy" onClick={copy}>
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
      <pre>
        <code class="hl">{tree ? spans(tree) : code}</code>
      </pre>
    </div>
  );
}
