import { useEffect, useState } from 'preact/hooks';

/**
 * One tooltip for the whole app: any element with data-tip="…" (and data-kbd="⌘K") shows it after a
 * short rest of the pointer. Replaces native title so labels and their shortcuts look the same.
 */
export function Tooltip() {
  const [tip, setTip] = useState(null);
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
        setTip({ text: el.dataset.tip, kbd: el.dataset.kbd, x: Math.min(innerWidth - 12, Math.max(12, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8, below });
      }, 420);
    };
    document.addEventListener('pointerover', over);
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'blur']) window.addEventListener(ev, hide, true);
    return () => {
      document.removeEventListener('pointerover', over);
      for (const ev of ['pointerdown', 'keydown', 'wheel', 'blur']) window.removeEventListener(ev, hide, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div class="tip glass-3" role="tooltip" style={{ left: tip.x + 'px', top: tip.y + 'px', transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}>
      <span>{tip.text}</span>
      {tip.kbd && <kbd>{tip.kbd}</kbd>}
    </div>
  );
}
