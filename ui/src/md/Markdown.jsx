import { mdTree } from './parse.js';
import { CodeBlock } from './CodeBlock.jsx';

// Tags and props come only from parse.js (fixed tag set, http(s)-only hrefs), so spreading them is safe.
const render = (list, onFileRef) => list?.map((n, i) => node(n, i, onFileRef));

function node(n, key, onFileRef) {
  if (n.t === 'text') return n.text;
  const { tag, props } = n;
  if (tag === 'codeblock') return <CodeBlock key={key} lang={props.lang} code={props.code} />;
  const kids = render(n.kids, onFileRef);
  if (tag === 'fileref') {
    if (!onFileRef) return <code key={key}>{kids}</code>;
    return (
      <button key={key} type="button" class="fileref" onClick={() => onFileRef(props.path, props.line, props.end)}>
        <code>{kids}</code>
      </button>
    );
  }
  if (tag === 'th' || tag === 'td') {
    const Cell = tag;
    return (
      <Cell key={key} style={props?.align ? { textAlign: props.align } : undefined}>
        {kids}
      </Cell>
    );
  }
  const Tag = tag;
  return (
    <Tag key={key} {...props}>
      {kids}
    </Tag>
  );
}

/** Agent markdown. `onFileRef(path, line, end)` turns file-like inline code into buttons. */
export function Markdown({ md, onFileRef, compact }) {
  return <div class={compact ? 'md compact' : 'md'}>{render(mdTree(md), onFileRef)}</div>;
}
