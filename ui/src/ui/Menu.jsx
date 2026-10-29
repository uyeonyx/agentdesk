// Right-click menus and the ⋯ menu: one list of items, drawn at the pointer or under a button.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useStore, get, set } from '../store.js';
import { I } from './bits.jsx';

/**
 * Items: { icon, label, run | href, hint?, danger?, disabled? }, '-' for a separator; falsy ones
 * are skipped so lists can be written with conditions inline.
 */
export function openMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  const list = tidy(items);
  if (list.length) set({ ctx: { x: e.clientX, y: e.clientY, items: list } });
}

/** Under a button (the ⋯ menu): right edges line up unless `align` is 'start'. */
export function openMenuAt(el, items, align = 'end') {
  const list = tidy(items);
  const r = el.getBoundingClientRect();
  if (list.length) set({ ctx: { x: align === 'end' ? r.right : r.left, y: r.bottom + 6, items: list, alignEnd: align === 'end' } });
}

export const closeMenu = () => get().ctx && set({ ctx: null });

function tidy(items) {
  const out = [];
  for (const it of items) {
    if (!it) continue;
    if (it === '-') {
      if (out.length && out[out.length - 1] !== '-') out.push(it);
    } else out.push(it);
  }
  while (out[out.length - 1] === '-') out.pop();
  return out;
}

export function MenuItems({ items, close }) {
  return tidy(items).map((it, i) =>
    it === '-' ? (
      <hr key={`-${i}`} />
    ) : (
      <button
        key={it.label}
        class={`li ${it.danger ? 'danger' : ''}`}
        role="menuitem"
        disabled={it.disabled}
        onClick={() => {
          close();
          if (it.href) window.open(it.href, '_blank', 'noopener');
          else it.run();
        }}
      >
        <I n={it.icon || 'point'} />
        <span class="m">{it.label}</span>
        {it.hint ? <kbd>{it.hint}</kbd> : <span />}
      </button>
    )
  );
}

/** The one open right-click menu, wherever it was asked for. */
export function ContextMenu() {
  const m = useStore((s) => s.ctx);
  const box = useRef();

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !m) return;
    // Keep it on screen: past the right edge it moves left, past the bottom it opens upward.
    const r = el.getBoundingClientRect();
    const x0 = m.alignEnd ? m.x - r.width : m.x;
    const x = x0 + r.width > innerWidth - 6 ? Math.max(6, innerWidth - r.width - 6) : Math.max(6, x0);
    const y = m.y + r.height > innerHeight - 6 ? Math.max(6, m.y - r.height) : m.y;
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, visibility: 'visible' });
    el.focus();
  }, [m]);

  // Listening starts with the first paint: an Esc pressed the moment the menu shows must close it.
  useLayoutEffect(() => {
    if (!m) return;
    const outside = (e) => !box.current?.contains(e.target) && closeMenu();
    const key = (e) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const all = [...box.current.querySelectorAll('.li:not([disabled])')];
        const i = all.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? all[(i + 1) % all.length] : all[(i <= 0 ? all.length : i) - 1];
        next?.focus();
      }
    };
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('wheel', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('mousedown', outside, true);
      window.removeEventListener('wheel', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [m]);

  if (!m) return null;
  return (
    <div class="menu ctx glass-3" role="menu" ref={box} tabIndex={-1} style="visibility:hidden" onContextMenu={(e) => e.preventDefault()}>
      <MenuItems items={m.items} close={closeMenu} />
    </div>
  );
}

