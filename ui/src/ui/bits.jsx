import { useEffect, useLayoutEffect, useReducer, useRef } from 'preact/hooks';
import { useLogo } from '../logos.js';
import { markOf } from '../core/status.js';

export const I = ({ n, style, class: cls = '' }) => <i class={`ti ti-${n} ${cls}`} style={style} aria-hidden="true" />;

/** The project color on an element: everything inside derives its tints from it (room.css). */
export function roomVars(color = '#7D8FA3') {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(color).slice(i, i + 2), 16) / 255 || 0);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return { '--room': color, '--room-ink': lum > 0.42 ? 'rgb(0 0 0 / 0.78)' : '#fff' };
}

/** The project's mark: its own logo, or its icon on its color. With `task`, a status mark at the corner. */
export function Glyph({ project, size = 22, task, class: cls = '' }) {
  const logo = useLogo(project);
  const st = { ...roomVars(project?.color), width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.56) + 'px', borderRadius: Math.round(size * 0.3) + 'px' };
  return (
    <span class={`glyph room-scope ${logo ? 'has-logo' : ''} ${cls}`} style={st}>
      {logo ? <img src={logo} alt="" draggable={false} /> : <I n={project?.icon || 'folder'} />}
      {task && <span class={`mark ${markOf(task)}`} aria-hidden="true" />}
    </span>
  );
}

export function Spinner() {
  return <span class="spin" role="img" aria-label="작업 중" />;
}

export function Kbd({ k }) {
  return k ? <kbd>{k}</kbd> : null;
}

// One clock for every "3분 전" and "12초": a tick a second, shared.
const clockSubs = new Set();
let clock;
export function useNow(every = 1000) {
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const fn = () => bump();
    clockSubs.add(fn);
    if (!clock) clock = setInterval(() => clockSubs.forEach((f) => f()), every);
    return () => {
      clockSubs.delete(fn);
      if (!clockSubs.size) {
        clearInterval(clock);
        clock = null;
      }
    };
  }, []);
  return Date.now();
}

export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return '방금';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}일` : `${Math.round(d / 30)}달`;
}

export function TimeAgo({ at }) {
  const now = useNow(15000);
  return <span class="num">{ago(at, now)}</span>;
}

/** Element for an effect that runs while `open`: closes on Esc and on a press outside. */
export function useDismiss(open, close, ref) {
  // Listening starts with the first paint: an Esc pressed the moment the popover shows must close it.
  useLayoutEffect(() => {
    if (!open) return;
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    const down = (e) => ref?.current && !ref.current.contains(e.target) && close();
    window.addEventListener('keydown', key, true);
    window.addEventListener('mousedown', down, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('mousedown', down, true);
    };
  }, [open]);
}

/** A list moved through with ↑/↓ (and J/K when `letters`), ↵ to pick. Returns [active, setActive, onKeyDown]. */
export function useListNav(count, onPick, { letters = false, wrap = true } = {}) {
  const [active, setActive] = useReducer((_, v) => v, 0);
  const ref = useRef(active);
  ref.current = Math.min(active, Math.max(0, count - 1));
  const onKeyDown = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const down = e.key === 'ArrowDown' || (letters && e.code === 'KeyJ' && !e.metaKey && !e.ctrlKey);
    const up = e.key === 'ArrowUp' || (letters && e.code === 'KeyK' && !e.metaKey && !e.ctrlKey);
    if (down || up) {
      e.preventDefault();
      const n = ref.current + (down ? 1 : -1);
      setActive(wrap ? (n + count) % Math.max(1, count) : Math.max(0, Math.min(count - 1, n)));
    } else if (e.key === 'Enter' && count) {
      e.preventDefault();
      onPick(ref.current, e);
    }
  };
  return [ref.current, setActive, onKeyDown];
}
