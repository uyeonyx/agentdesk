import { useMemo } from 'preact/hooks';
import { diffRows } from './diffview.js';

const SIG = { add: '+', del: '−', ctx: ' ' };

/** Unified diff hunks as rows: two line-number gutters, sign, text; one-line edits get word <mark>s. */
export function Diff({ hunks }) {
  const rows = useMemo(() => diffRows(hunks), [hunks]);
  return (
    <div class="diff">
      {rows.map((r, i) =>
        r.kind === 'gap' ? (
          <div key={i} class="dl gap" role="separator" />
        ) : (
          <div key={i} class={`dl ${r.kind}`}>
            <span class="ln">{r.aLine ?? ''}</span>
            <span class="ln">{r.bLine ?? ''}</span>
            <span class="sig">{SIG[r.kind]}</span>
            <span class="tx">{r.parts ? r.parts.map((p, j) => (p.changed ? <mark key={j}>{p.text}</mark> : p.text)) : r.text}</span>
          </div>
        ),
      )}
    </div>
  );
}
