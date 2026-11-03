// A session's settings as chips: permission mode, model, effort, context. The composer bar and the
// overview's tiles both use them. Changes go through the core, for this session only.
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api } from '../../api.js';
import { toast, useStore, set } from '../../store.js';
import { MODES, modeOf, EFFORTS, effortOf, MODELS, modelName, familyOf, ctxPct, ctxTone, tokens } from '../../core/session.js';
import { isBusy } from '../../core/status.js';
import { I, useDismiss, useListNav } from '../../ui/bits.jsx';

const claude = (t) => t.agent !== 'codex';

export async function changeMode(task, mode) {
  const m = modeOf(mode);
  try {
    const r = await api('POST', `/api/tasks/${task.id}/mode`, { mode });
    toast(r.applied === 'start' ? `${m.label} · 다시 시작할 때 적용돼요` : isBusy(task) ? `${m.label} · 다음 도구 실행부터 적용돼요` : `${m.label} 모드`);
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

async function change(task, what, value, label) {
  try {
    const r = await api('POST', `/api/tasks/${task.id}/${what}`, { [what]: value });
    toast(r.applied === 'start' ? `${label} · 다시 시작할 때 적용돼요` : `${label} · 이 세션에만 적용했어요`);
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function compact(task) {
  try {
    await api('POST', `/api/tasks/${task.id}/compact`);
    toast('대화를 압축하는 중이에요 · 코드는 그대로예요');
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

/** The context gauge: a ring that fills, colored when it's getting full. */
export function Ring({ pct, size = 16 }) {
  const c = 2 * Math.PI * 8;
  return (
    <svg class="ring" viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
      <circle cx="10" cy="10" r="8" />
      <circle class="fg" cx="10" cy="10" r="8" stroke-dasharray={`${((pct ?? 0) / 100) * c} ${c}`} />
    </svg>
  );
}

/**
 * A list that opens from a chip, above it when there's room (the composer sits at the bottom).
 * Drawn on the body so a tile's clipping can't cut it. ↑↓ ↵ to pick, Esc or a click outside to close.
 */
function Pop({ anchor, title, sub, items, onPick, onClose, width = 340, children }) {
  const ref = useRef();
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    const left = Math.max(8, Math.min(r.left, innerWidth - width - 8));
    const top = r.top - h - 8 > 8 ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - 8);
    setPos({ left, top });
    ref.current.focus();
  }, []);
  useDismiss(true, onClose, ref);
  const list = items || [];
  const [active, setActive, onKeyDown] = useListNav(list.length, (i) => !list[i].disabled && onPick(list[i]));
  return createPortal(
    <div ref={ref} class="pk-pop" style={{ left: (pos?.left ?? -9999) + 'px', top: (pos?.top ?? -9999) + 'px', width: width + 'px' }} tabIndex={-1} role="listbox" aria-label={title} onKeyDown={onKeyDown}>
      {title && (
        <div class="pk-h">
          {title}
          {sub && <span>{sub}</span>}
        </div>
      )}
      {list.map((it, i) => (
        <button
          key={it.key}
          type="button"
          class={`pk-li m-${it.tone || ''} ${i === active ? 'on' : ''}`}
          role="option"
          aria-selected={!!it.current}
          disabled={it.disabled}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(it)}
        >
          {it.icon && (
            <span class="pk-ic">
              <I n={it.icon} />
            </span>
          )}
          <span class="pk-t">
            <b>{it.label}</b>
            {it.desc && <span>{it.desc}</span>}
          </span>
          {it.current ? <I n="check" class="pk-ck" /> : <span />}
        </button>
      ))}
      {children}
    </div>,
    document.body
  );
}

/**
 * Open/close state for a chip's popover; a press on the chip while it's open just closes it.
 * `name`: typing that command in the composer (/model, /effort) opens this one instead.
 */
function usePop(name) {
  const [open, setOpen] = useState(false);
  const closedAt = useRef(0);
  const btn = useRef();
  const want = useStore((s) => s.openPick);
  useEffect(() => {
    if (!name || want !== name || !btn.current) return;
    set({ openPick: null });
    setOpen(true);
  }, [want]);
  const toggle = (e) => {
    e?.stopPropagation?.();
    if (open || Date.now() - closedAt.current < 250) return;
    setOpen(true);
  };
  const close = () => {
    closedAt.current = Date.now();
    setOpen(false);
  };
  return { open, toggle, close, btn };
}

/** The permission mode. In a running session only the Shift+Tab modes can be reached. */
export function ModeChip({ task, small = false, hint = false }) {
  const p = usePop();
  if (!claude(task)) return null;
  const m = modeOf(task.mode || 'default');
  const items = MODES.map((x) => ({ ...x, current: x.key === m.key, disabled: !x.cycle && task.running, desc: !x.cycle && task.running ? `${x.desc} · 새 세션에서만` : x.desc }));
  return (
    <>
      <button ref={p.btn} type="button" class={`mchip m-${m.tone} ${small ? 'ico' : ''}`} onClick={p.toggle} data-tip={`권한 모드: ${m.label} · 작업 중에도 바로 바뀌어요`} data-kbd={hint ? '⇧Tab' : undefined} aria-label={`권한 모드: ${m.label}`} data-testid="mode-chip" data-mode={m.key}>
        <I n={m.icon} />
        {!small && m.label}
        {hint && !small && <span class="k">⇧Tab</span>}
      </button>
      {p.open && (
        <Pop
          anchor={p.btn.current}
          title="권한 모드"
          sub={isBusy(task) ? '다음 도구 실행부터 적용돼요' : '⇧Tab으로 차례로 바꿔요'}
          items={items}
          onClose={p.close}
          onPick={(it) => {
            p.close();
            if (it.key !== m.key) changeMode(task, it.key);
          }}
        />
      )}
    </>
  );
}

export function ModelChip({ task }) {
  const p = usePop('model');
  if (!claude(task)) return null;
  const fam = familyOf(task.model) || task.pick?.model || '';
  const busy = isBusy(task);
  const items = MODELS.map((x) => ({ ...x, current: x.key === fam, disabled: busy && task.running, desc: busy && task.running ? '작업이 끝나면 바꿀 수 있어요' : x.desc }));
  return (
    <>
      <button ref={p.btn} type="button" class="chip2" onClick={p.toggle} data-tip="모델 · 이 세션에만 적용돼요" data-testid="model-chip">
        <I n="cpu" />
        {modelName(task.model) || '기본 모델'}
        <I n="chevron-down" class="dn" />
      </button>
      {p.open && (
        <Pop
          anchor={p.btn.current}
          title="모델"
          sub="이 세션에만 · 기본값은 그대로"
          items={items}
          width={300}
          onClose={p.close}
          onPick={(it) => {
            p.close();
            if (it.key !== fam) change(task, 'model', it.key, it.label);
          }}
        />
      )}
    </>
  );
}

export function EffortChip({ task }) {
  const p = usePop('effort');
  if (!claude(task)) return null;
  const cur = effortOf(task.effort);
  const busy = isBusy(task) && task.running;
  const items = EFFORTS.map((x) => ({ ...x, current: x.key === cur?.key, disabled: busy, desc: busy ? '작업이 끝나면 바꿀 수 있어요' : x.desc }));
  return (
    <>
      <button ref={p.btn} type="button" class="chip2" onClick={p.toggle} data-tip="노력 수준 · 생각을 얼마나 깊게 할지" data-testid="effort-chip">
        <I n="brain" />
        노력 {cur?.label || '기본'}
        <I n="chevron-down" class="dn" />
      </button>
      {p.open && (
        <Pop
          anchor={p.btn.current}
          title="노력 수준"
          sub="이 세션에만 · 기본값은 그대로"
          items={items}
          width={300}
          onClose={p.close}
          onPick={(it) => {
            p.close();
            if (it.key !== cur?.key) change(task, 'effort', it.key, `노력 ${it.label}`);
          }}
        />
      )}
    </>
  );
}

/** How full the context is; opens a breakdown with "compact now". */
export function CtxChip({ task, onDetail }) {
  const p = usePop();
  if (!claude(task) || !task.ctx) return null;
  const pct = ctxPct(task.ctx);
  return (
    <>
      <button ref={p.btn} type="button" class={`ctxm ${ctxTone(pct)}`} onClick={p.toggle} data-tip={pct == null ? '압축한 뒤 다음 답에서 다시 세요' : `${tokens(task.ctx.used)} / ${tokens(task.ctx.limit)} 토큰`} data-testid="ctx-chip">
        <Ring pct={pct} />
        문맥 <b class="num">{pct == null ? '—' : `${pct}%`}</b>
      </button>
      {p.open && (
        <Pop anchor={p.btn.current} title="문맥 사용량" onClose={p.close} width={360}>
          <div class="pk-ctx">
            <div class="pk-ctx-n">
              <b class="num">{tokens(task.ctx.used)}</b> / {tokens(task.ctx.limit)} 토큰 {pct != null && <span class="num">· {pct}%</span>}
            </div>
            <span class={`pk-bar ${ctxTone(pct)}`}>
              <i style={{ width: `${pct ?? 0}%` }} />
            </span>
            <p>95%가 넘으면 Claude Code가 알아서 압축해요. 압축하면 지금까지의 대화를 요약으로 바꾸고, 코드는 그대로예요.</p>
            <div class="pk-acts">
              {onDetail && (
                <button
                  type="button"
                  class="btn sm ghost"
                  onClick={() => {
                    p.close();
                    onDetail();
                  }}
                >
                  <I n="list-details" /> 자세히 (/context)
                </button>
              )}
              <span class="sp" />
              <button
                type="button"
                class="btn sm primary"
                disabled={isBusy(task)}
                data-tip={isBusy(task) ? '작업이 끝나면 압축할 수 있어요' : undefined}
                onClick={() => {
                  p.close();
                  compact(task);
                }}
              >
                <I n="arrows-minimize" /> 지금 압축
              </button>
            </div>
          </div>
        </Pop>
      )}
    </>
  );
}

/** A small context reading for a tile's header. */
export function CtxMini({ task }) {
  const pct = ctxPct(task.ctx);
  if (!claude(task) || pct == null) return null;
  return (
    <span class={`ctxmini ${ctxTone(pct)}`} data-tip={`문맥 ${pct}% 사용`}>
      <Ring pct={pct} size={12} />
      <span class="num">{pct}%</span>
    </span>
  );
}

/** The mode as a quiet word in a header, only when it isn't the default. */
export function ModeTag({ task, short = false }) {
  if (!claude(task) || !task.mode || task.mode === 'default') return null;
  const m = modeOf(task.mode);
  return (
    <span class={`mm m-${m.tone}`} data-tip={m.desc}>
      <I n={m.icon} />
      {!short && m.label}
    </span>
  );
}
