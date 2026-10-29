// 관제탑: every live session as a tile, most urgent first. A stuck one carries its question card;
// one waiting for my reply shows the start of its last answer and a reply box.
import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, set, projectOf } from '../../store.js';
import { isLive, isBlocked, compareTasks, whyOf, labelOf, markOf } from '../../core/status.js';
import { duration } from '../../core/turns.js';
import { openTask, quickSend, archiveAsk, newTask } from '../../actions.js';
import { enterAction } from '../../core/sendPolicy.js';
import { PromptCard } from '../prompt/PromptCard.jsx';
import { Markdown } from '../../md/Markdown.jsx';
import { openMenu } from '../../ui/Menu.jsx';
import { taskItems } from '../task/taskActions.js';
import { Glyph, I, TimeAgo, useNow, roomVars } from '../../ui/bits.jsx';
import { useFlip } from '../../ui/useFlip.js';

export function Overview() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, filter: s.filter }));
  const list = s.tasks.filter((t) => !t.archived && isLive(t) && (!s.filter || t.projectId === s.filter)).sort(compareTasks);
  const grid = useRef();
  const [focus, setFocus] = useState(0);
  useFlip(grid);

  // Arrows and J/K move between tiles; the focused one takes digits, R, O and E.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (e.isComposing || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'))) return;
      const cols = Math.max(1, Math.round(grid.current?.clientWidth / 380) || 1);
      const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, KeyJ: 1, KeyK: -1 }[e.code];
      if (move && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setFocus((f) => Math.max(0, Math.min(list.length - 1, f + move)));
        return;
      }
      const t = list[focus];
      if (!t || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyO' || e.key === 'Enter') {
        e.preventDefault();
        openTask(t.id);
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        grid.current?.querySelector(`[data-task-id="${t.id}"] .qr input`)?.focus();
      } else if (e.code === 'KeyE') {
        e.preventDefault();
        archiveAsk(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list.map((t) => t.id).join(), focus]);

  if (!list.length)
    return (
      <div class="overview">
        <div class="empty">
          <I n="layout-dashboard" style="font-size:28px;color:var(--text-3)" />
          <h3>돌아가는 세션이 없어요</h3>
          <button class="btn primary" onClick={() => newTask()}>
            <I n="plus" /> 새 작업 <kbd>N</kbd>
          </button>
        </div>
      </div>
    );
  return (
    <div class="overview scroll">
      <div class="ov-grid" ref={grid}>
        {list.map((t, i) => (
          <Tile key={t.id} t={t} p={projectOf(s, t.projectId)} focused={i === focus} onFocus={() => setFocus(i)} />
        ))}
      </div>
    </div>
  );
}

const Tile = memo(function Tile({ t, p, focused, onFocus }) {
  const blocked = isBlocked(t);
  const now = useNow();
  const working = t.state === 'working' || t.state === 'starting';
  const plan = t.activity?.plan || [];
  const done = plan.filter((x) => x.status === 'done').length;
  return (
    <article
      class={`tile glass-2 ${focused ? 'focused' : ''} ${blocked ? 'blocked' : ''} ${markOf(t)}`}
     
      data-flip={t.id}
      data-task-id={t.id}
      data-testid="tile"
      data-state={blocked ? 'blocked' : t.state}
      style={{ ...roomVars(p?.color), viewTransitionName: `task-${t.id}` }}
      onMouseDown={onFocus}
      onDblClick={(e) => !e.target.closest('button, input, textarea, a') && openTask(t.id)}
      onContextMenu={(e) => !e.target.closest('input, textarea') && openMenu(e, taskItems(t))}
      aria-label={`${p?.name || ''} · ${t.title} · ${labelOf(t)}`}
    >
      <header class="tl-h">
        <Glyph project={p} size={28} task={t} />
        <div class="tl-id">
          <span class="tl-p">{p?.name}</span>
          <button class="tl-t" onClick={() => openTask(t.id)}>
            {t.title}
          </button>
        </div>
        <span class={`state-pill ${markOf(t)}`}>
          <span class="d" />
          {labelOf(t)}
        </span>
      </header>
      <div class="tl-b">
        {blocked && t.prompt ? (
          <PromptCard task={t} project={p} compact focus={focused} />
        ) : t.state === 'needs_input' ? (
          <>
            {t.reply?.md ? (
              <div class="tl-reply">
                <Markdown md={t.reply.md} compact />
              </div>
            ) : (
              <p class="tl-why">{whyOf(t)}</p>
            )}
            <QuickReply t={t} p={p} />
          </>
        ) : t.state === 'review' ? (
          <>
            <p class="tl-why">{whyOf(t)}</p>
            <div class="tl-act">
              <button class="btn sm" onClick={() => openTask(t.id, 'review')}>
                <I n="git-compare" /> 검토
              </button>
            </div>
          </>
        ) : working ? (
          <>
            <div class="tl-now">
              <span class="breath" />
              <span class="what">{t.activity?.current || '생각하는 중'}</span>
              <span class="num el">{duration(now - (t.activity?.since || t.updatedAt))}</span>
            </div>
            {(t.activity?.feedTail || []).slice(-3).map((f) => (
              <div key={f.id} class={`tl-feed st-${f.st}`}>
                <I n={f.st === 'err' ? 'x' : f.st === 'run' ? 'loader-2' : 'check'} /> <span>{f.text}</span>
              </div>
            ))}
          </>
        ) : (
          <p class="tl-why">{whyOf(t)}</p>
        )}
      </div>
      {plan.length > 0 && (
        <footer class="tl-f">
          <span class="tl-plan">
            <i style={{ width: `${(done / plan.length) * 100}%` }} />
          </span>
          <span class="num">
            {done}/{plan.length}
          </span>
          <span class="sp" />
          <TimeAgo at={t.updatedAt} />
        </footer>
      )}
    </article>
  );
});

function QuickReply({ t, p }) {
  const [v, setV] = useState('');
  const send = async () => {
    if (!v.trim()) return;
    const ok = await quickSend(t.id, v.trim());
    if (ok) setV('');
  };
  return (
    <div class="qr">
      <input
        class="field"
        value={v}
        placeholder="답장 · ↵"
        onInput={(e) => setV(e.currentTarget.value)}
        onKeyDown={(e) => {
          const a = enterAction(e, { careful: !!p?.careful });
          if (a === 'send') {
            e.preventDefault();
            send();
          } else if (e.key === 'Escape') e.currentTarget.blur();
        }}
      />
    </div>
  );
}
