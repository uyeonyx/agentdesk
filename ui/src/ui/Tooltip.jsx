import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

const EDGE = 10;

/**
 * One tooltip for the whole app: any element with data-tip="…" (and data-kbd="⌘K") shows it after a
 * short rest of the pointer. Replaces native title so labels and their shortcuts look the same.
 */
export function Tooltip() {
  const [tip, setTip] = useState(null);
  const box = useRef();
  useEffect(() => {
    let timer;
    let el = null;
    const hide = () => {
      clearTimeout(timer);
      el = null;
      setTip(null);
    };
    const over = (e) => {
      const t = e.target.closest?.('[data-tip]');
      if (t === el) return;
      hide();
      if (!t) return;
      el = t;
      timer = setTimeout(() => {
        if (!el?.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.bottom + 40 < innerHeight;
        setTip({ text: el.dataset.tip, kbd: el.dataset.kbd, cx: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, 420);
    };
    document.addEventListener('pointerover', over);
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'blur']) window.addEventListener(ev, hide, true);
    return () => {
      document.removeEventListener('pointerover', over);
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'blur']) window.removeEventListener(ev, hide, true);
    };
  }, []);
  // Placed once its own width is known: centered on the target, then pushed back inside the window.
  // (Positioned by its center, a tip near the right edge would shrink to the space left and wrap
  // every syllable onto its own line.)
  useLayoutEffect(() => {
    const n = box.current;
    if (!n || !tip) return;
    const w = n.offsetWidth;
    const left = Math.min(innerWidth - EDGE - w, Math.max(EDGE, tip.cx - w / 2));
    n.style.left = left + 'px';
    n.style.visibility = 'visible';
  }, [tip]);
  if (!tip) return null;
  return (
    <div ref={box} class="tip glass-3" role="tooltip" style={{ left: '0px', top: tip.y + 'px', visibility: 'hidden', transform: tip.below ? 'none' : 'translateY(-100%)' }}>
      <span>{tip.text}</span>
      {tip.kbd && <kbd>{tip.kbd}</kbd>}
    </div>
  );
}
