import { useEffect, useRef } from 'preact/hooks';
import { closeModal } from '../store.js';

/** A dialog on glass: Esc or a press on the backdrop closes it; focus comes back where it was. */
export function Sheet({ children, wide, onClose = closeModal, label, class: cls = '' }) {
  const ref = useRef();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.activeElement;
    // Focus the first control unless something inside already took it.
    const t = setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector('[autofocus], input, textarea, button.primary, button')?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      if (prev?.focus && document.contains(prev)) prev.focus();
    };
  }, [onClose]);
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`sheet glass-3 ${wide ? 'wide' : ''} ${cls}`} ref={ref} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}
