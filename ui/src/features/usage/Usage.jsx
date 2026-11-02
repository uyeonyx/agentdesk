// How much of the plan is used, as Claude Code's own /usage screen says it. The core reads it now
// and then while sessions run; opening this asks for a fresh read when it's more than a minute old.
import { createPortal } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api } from '../../api.js';
import { useStore, set } from '../../store.js';
import { I, ago, useDismiss, useNow } from '../../ui/bits.jsx';

const toneOf = (pct) => (pct >= 95 ? 'max' : pct >= 80 ? 'hi' : '');
/** The rows worth a glance in the title bar: the 5-hour limit when the plan has one, then the week. */
export function headline(u) {
  const rows = u?.claude?.rows || [];
  const h5 = rows.find((r) => r.key === 'current-session');
  const wk = rows.find((r) => r.key === 'current-week-all-models') || rows.find((r) => r.key.startsWith('current-week'));
  return { h5, wk, top: Math.max(h5?.pct ?? 0, wk?.pct ?? 0, ...rows.filter((r) => r.key.startsWith('current-week')).map((r) => r.pct)) };
}

export function refreshUsage(force = false) {
  return api('POST', '/api/usage', { force }).then(
    (usage) => set({ usage }),
    () => {}
  );
}

/** One limit: what it is, how full, when it resets. */
export function UsageRow({ r }) {
  return (
    <div class={`ur ${toneOf(r.pct)}`}>
      <span class="ur-l">{r.label}</span>
      <b class="num">{r.pct}%</b>
      <span class="meter">
        <i style={{ width: `${Math.min(100, r.pct)}%` }} />
      </span>
      <span class="ur-s">
        {r.spent ? `${r.spent} 사용 · ` : ''}
        {r.resets ? `${r.resets} 초기화` : ''}
      </span>
    </div>
  );
}

export function UsageRows({ u }) {
  const now = useNow(30000);
  const c = u?.claude;
  if (!c) return <p class="ur-empty">아직 읽지 않았어요 · Claude Code의 /usage 화면에서 읽어요</p>;
  return (
    <div class="ug">
      <h4>
        Claude Code <span>{c.at ? `${ago(c.at, now)} 전에 읽음` : ''}</span>
      </h4>
      {(c.rows || []).map((r) => (
        <UsageRow key={r.key} r={r} />
      ))}
      {c.error && <p class="ur-err">{c.error}</p>}
    </div>
  );
}

/** The title bar's gauge: the fullest limit at a glance, the whole list on a click. */
export function UsageChip() {
  const u = useStore((s) => s.usage);
  const claude = useStore((s) => s.agents?.claude?.available);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btn = useRef();
  if (!claude) return null;
  const { h5, wk, top } = headline(u);
  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    setBusy(true);
    await refreshUsage();
    setBusy(false);
  };
  const tip = (u?.claude?.rows || []).map((r) => `${r.label} ${r.pct}%`).join(' · ') || 'Claude Code 사용량';
  return (
    <>
      <button ref={btn} type="button" class={`usage ${toneOf(top)}`} onClick={toggle} data-tip={tip} aria-label="사용량" aria-expanded={open} data-testid="usage">
        <I n="gauge" />
        {h5 && (
          <span>
            5시간 <b class="num">{h5.pct}%</b>
          </span>
        )}
        {h5 && wk && <span class="sep2">·</span>}
        {wk ? (
          <span>
            주간 <b class="num">{wk.pct}%</b>
          </span>
        ) : (
          !h5 && <span>사용량</span>
        )}
      </button>
      {open && <UsagePop anchor={btn.current} u={u} busy={busy} onClose={() => setOpen(false)} />}
    </>
  );
}

function UsagePop({ anchor, u, busy, onClose }) {
  const ref = useRef();
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.right - 360, innerWidth - 368)), top: r.bottom + 8 });
    ref.current?.focus();
  }, []);
  useDismiss(true, onClose, ref);
  return createPortal(
    <div ref={ref} class="usage-pop glass-3" tabIndex={-1} role="dialog" aria-label="사용량" style={{ left: (pos?.left ?? -9999) + 'px', top: (pos?.top ?? -9999) + 'px' }} data-testid="usage-pop">
      <UsageRows u={u} />
      <div class="up-f">
        <span>Claude Code의 /usage 화면 값을 그대로 읽어요 · 앱이 따로 API를 부르지 않아요</span>
        <button type="button" class="btn sm ghost" disabled={busy} onClick={() => refreshUsage(true)}>
          {busy ? <span class="spin" /> : <I n="refresh" />} 새로 읽기
        </button>
      </div>
    </div>,
    document.body
  );
}
