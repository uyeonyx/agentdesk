// A session's recent activity on one thin line: what kind of tool ran when (gray reads, blue
// edits, magenta commands), and striped amber while it waited on me. The span follows the
// session's age (5, 10, 15 or 30 minutes), so a new session fills the line instead of a sliver.
import { useNow } from '../../ui/bits.jsx';

const KIND = { r: 'read', e: 'edit', c: 'cmd', w: 'web', a: 'agent', t: 'read' };
const SPANS = [5, 10, 15, 30].map((m) => m * 60_000);

/** How far back the strip reaches for this session, in ms. */
export function stripSpan(t, now = Date.now()) {
  const age = now - (t.createdAt || t.strip?.from || now);
  return SPANS.find((w) => age <= w * 0.92) || SPANS.at(-1);
}

export function Strip({ t, class: cls = '' }) {
  const now = useNow(5000);
  const st = t.strip;
  if (!st) return null;
  const WINDOW = stripSpan(t, now);
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
  // Nothing in the span: no empty gray line under the tile or row; the big one says so.
  if (!bands.length && !clips.some(Boolean)) return cls.includes('big') ? <span class={`strip ${cls} none`}>이 동안은 조용했어요</span> : null;
  return (
    <span class={`strip ${cls}`} aria-hidden="true">
      {bands}
      {clips}
    </span>
  );
}
