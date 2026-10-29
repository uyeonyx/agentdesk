import { useLayoutEffect, useRef } from 'preact/hooks';

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Rows that change place glide there instead of jumping (FLIP). Children marked with
 * data-flip="<key>" inside `ref` are measured before and after each render.
 */
export function useFlip(ref) {
  const last = useRef(new Map());
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    // Measured against the list itself, so scrolling it doesn't count as moving.
    const origin = box.getBoundingClientRect().top - box.scrollTop;
    const now = new Map();
    for (const el of box.querySelectorAll('[data-flip]')) now.set(el.dataset.flip, [el, el.getBoundingClientRect().top - origin]);
    if (!still()) {
      for (const [k, [el, top]] of now) {
        const before = last.current.get(k);
        if (before === undefined) continue;
        const dy = before - top;
        if (Math.abs(dy) < 2) continue;
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    }
    last.current = new Map([...now].map(([k, [, top]]) => [k, top]));
  });
}
