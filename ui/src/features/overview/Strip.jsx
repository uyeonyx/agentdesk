// The last half hour of a session on one thin line: what kind of tool ran when (gray reads, blue
// edits, magenta commands), and striped amber while it waited on me.
import { useNow } from '../../ui/bits.jsx';

const WINDOW = 30 * 60_000;
const KIND = { r: 'read', e: 'edit', c: 'cmd', w: 'web', a: 'agent', t: 'read' };

export function Strip({ t, class: cls = '' }) {
  const now = useNow(5000);
  const st = t.strip;
  if (!st) return <span class={`strip ${cls}`} aria-hidden="true" />;
  const from = now - WINDOW;
  const pct = (x) => (Math.max(0, Math.min(WINDOW, x - from)) / WINDOW) * 100;
  const bands = [];
  for (let i = 0; i < st.s.length; i++) {
    const [s, state, ask] = st.s[i];
    const a = st.from + s * 1000;
    const b = i + 1 < st.s.length ? st.from + st.s[i + 1][0] * 1000 : now;
    if (b <= from) continue;
    const cls2 = state === 'needs_input' ? (ask ? 'wait' : 'reply') : state === 'review' ? 'review' : ['working', 'starting', 'waiting'].includes(state) ? 'work' : '';
    if (cls2) bands.push(<i key={`s${i}`} class={`sb ${cls2}`} style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} />);
  }
  const clips = st.c.map(([s, len, k, ok], i) => {
    const a = st.from + s * 1000;
    const b = ok === 'r' ? now : a + len * 1000;
    if (b < from) return null;
    return <i key={i} class={`sc k-${KIND[k] || 'read'} ${ok === 'e' ? 'err' : ''}`} style={{ left: `${pct(a)}%`, width: `${Math.max(0.35, pct(b) - pct(a))}%` }} />;
  });
  return (
    <span class={`strip ${cls}`} aria-hidden="true">
      {bands}
      {clips}
    </span>
  );
}
