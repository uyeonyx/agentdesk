import { useMemo } from 'preact/hooks';
import { ansiSegments } from './ansi.js';

// Palette indices follow the terminal theme; 256-color/truecolor arrive as validated hex.
const color = (c) => c.hex || `var(--term-${c.ansi})`;

/** Terminal output with SGR colors. Newlines are kept as text: style `.ansi` with white-space: pre-wrap. */
export function Ansi({ text }) {
  const segs = useMemo(() => ansiSegments(text), [text]);
  return (
    <span class="ansi">
      {segs.map((s, i) => {
        const cls = [s.bold && 'bold', s.dim && 'dim', s.italic && 'italic', s.underline && 'underline'].filter(Boolean).join(' ');
        if (!cls && !s.fg && !s.bg) return s.text;
        const style = {};
        if (s.fg) style.color = color(s.fg);
        if (s.bg) style.backgroundColor = color(s.bg);
        return (
          <span key={i} class={cls || undefined} style={style}>
            {s.text}
          </span>
        );
      })}
    </span>
  );
}
