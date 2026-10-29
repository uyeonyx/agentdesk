import { useState } from 'preact/hooks';
import { I } from '../../ui/bits.jsx';

/** The agent's newest plan, pinned above the conversation: "할 일 3/7 · 지금: …", open for the list. */
export function PlanStrip({ items }) {
  const [open, setOpen] = useState(false);
  const done = items.filter((x) => x.status === 'done').length;
  const now = items.find((x) => x.status === 'active');
  return (
    <div class={`planstrip glass-2 ${open ? 'open' : ''}`} data-sheen>
      <button class="ps-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class="ps-bar" aria-hidden="true">
          {items.map((x, i) => (
            <i key={i} class={x.status} />
          ))}
        </span>
        <span class="ps-n num">
          할 일 {done}/{items.length}
        </span>
        {now && <span class="ps-now">지금: {now.text}</span>}
        <I n="chevron-down" class="chev" />
      </button>
      {open && (
        <ol class="ps-list">
          {items.map((x, i) => (
            <li key={i} class={x.status}>
              <I n={x.status === 'done' ? 'circle-check-filled' : x.status === 'active' ? 'circle-dot' : 'circle'} />
              <span>{x.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
