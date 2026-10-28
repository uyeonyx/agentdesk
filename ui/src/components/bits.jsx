import { useEffect, useRef } from 'preact/hooks';
import { roomVars } from '../util.js';
import { closeModal } from '../store.js';
import { useLogo } from '../logos.js';

export const I = ({ n, style, class: cls = '' }) => <i class={`ti ti-${n} ${cls}`} style={style} aria-hidden="true" />;

/** The project's mark: its own logo on a ring of its color, or its icon on the color. */
export function Glyph({ project, size, class: cls = '' }) {
  const logo = useLogo(project);
  const st = { ...roomVars(project?.color) };
  if (size) Object.assign(st, { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.56) + 'px', borderRadius: Math.round(size * 0.28) + 'px' });
  return (
    <span class={`glyph ${logo ? 'has-logo' : ''} ${cls}`} style={st}>
      {logo ? <img src={logo} alt="" draggable={false} /> : <I n={project?.icon || 'folder'} />}
    </span>
  );
}

export function Spinner() {
  return <span class="spin" role="img" aria-label="작업 중" />;
}

/** Modal shell: Esc / backdrop click closes; Esc never leaks to the global undo handler. */
export function Modal({ children, class: cls = '', style, onClose = closeModal, labelledBy }) {
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
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (prev && prev.focus && document.contains(prev)) prev.focus();
    };
  }, [onClose]);
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal ${cls}`} style={style} ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}

export function useAutoFocus(dep) {
  const ref = useRef();
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [dep]);
  return ref;
}

export function Toggle({ on, onChange, title, desc }) {
  return (
    <button type="button" class={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span class="sw2" />
      <span>
        <b>{title}</b>
        <small>{desc}</small>
      </span>
    </button>
  );
}
