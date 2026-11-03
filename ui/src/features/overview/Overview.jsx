// 관제: every live session on one screen, as a mosaic where space follows attention. A session
// stuck on me gets a big tile with its question card; one waiting for my reply or a new result a
// wide one; quiet work a small one that shows what it's doing this second.
import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore, set, get, projectOf, toast } from '../../store.js';
import { isLive, isBlocked, isBusy, whyOf, markOf, grouped } from '../../core/status.js';
import { arrange, colsFor, rowHeight, SPAN } from '../../core/mosaic.js';
import { duration } from '../../core/turns.js';
import { MODES, CYCLE, MODELS, nextMode, modeOf } from '../../core/session.js';
import { openTask, quickSend, archiveAsk, resume, openDrawer } from '../../actions.js';
import { enterAction } from '../../core/sendPolicy.js';
import { api } from '../../api.js';
import { PromptCard } from '../prompt/PromptCard.jsx';
import { Markdown } from '../../md/Markdown.jsx';
import { openMenu, openMenuAt } from '../../ui/Menu.jsx';
import { taskItems } from '../task/taskActions.js';
import { ModeChip, ModeTag, CtxMini } from '../session/Pickers.jsx';
import { Strip } from './Strip.jsx';
import { ClashLine } from '../talk/Clash.jsx';
import { Glyph, I, useNow, roomVars, ago } from '../../ui/bits.jsx';
import { sound } from '../../app/sounds.js';

export function Overview() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, filter: s.filter, layout: s.ovLayout, pins: s.ovPins, showDone: s.ovDone, composing: s.composing }));
  const mine = s.tasks.filter((t) => !t.archived && (!s.filter || t.projectId === s.filter));
  const g = grouped(mine);
  const live = mine.filter((t) => isLive(t) || (s.showDone && !t.archived));
  const shown = s.showDone ? live : live.filter(isLive);
  const pins = new Set(s.pins || []);
  const mosaic = s.layout !== 'grid';
  const items = mosaic ? arrange(shown, pins) : shown.map((t) => ({ t, z: 'l' }));
  const grid = useRef();
  const [box, setBox] = useState({ w: 1200, h: 700 });
  const [focus, setFocus] = useState(null);
  const focusId = focus && items.some((x) => x.t.id === focus) ? focus : items[0]?.t.id;

  // The grid's own size decides columns and row height.
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = colsFor(box.w);
  const all = s.composing ? [{ z: 'l' }, ...items] : items;
  const rowH = mosaic ? rowHeight(all, cols, box.h - 6) : null;

  // Arrows move to the tile that is really in that direction; ↵ opens it; digits answer its card.
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (e.isComposing || (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) || e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1], KeyL: [1, 0], KeyH: [-1, 0], KeyJ: [0, 1], KeyK: [0, -1] }[e.code];
      if (dir) {
        e.preventDefault();
        const next = neighbor(grid.current, focusId, dir);
        if (next) setFocus(next);
        return;
      }
      const t = items.find((x) => x.t.id === focusId)?.t;
      if (!t) return;
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
  }, [items.map((x) => x.t.id).join(), focusId]);
  useEffect(() => {
    grid.current?.querySelector(`[data-task-id="${focusId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusId]);

  const pin = (id) => set((st) => ({ ovPins: (st.ovPins || []).includes(id) ? st.ovPins.filter((x) => x !== id) : [...(st.ovPins || []), id] }));
  const project = s.filter && projectOf(s, s.filter);

  return (
    <div class="overview" data-testid="overview">
      <div class="ov-bar">
        <button class="scope" onClick={(e) => openMenuAt(e.currentTarget, [{ icon: 'stack-2', label: '모든 프로젝트', run: () => set({ filter: null }) }, '-', ...s.projects.map((p) => ({ icon: p.icon || 'folder', label: p.name, run: () => set({ filter: p.id }) }))], 'start')}>
          {project ? <Glyph project={project} size={22} /> : <I n="stack-2" />}
          <span>{project ? project.name : '모든 프로젝트'}</span>
          <I n="selector" class="dn" />
        </button>
        <span class="ov-sum">
          <span class="count warn num">{g.yours.length}</span>내 차례
          <span class="count info num">{g.working.length}</span>작업 중
          {g.stopped.length > 0 && (
            <>
              <span class="count num">{g.stopped.length}</span>멈춤
            </>
          )}
        </span>
        <span class="sp" />
        <div class="seg ov-sizes" role="group" aria-label="칸 크기">
          <button aria-pressed={mosaic} onClick={() => set({ ovLayout: 'mosaic' })} data-tip="나를 기다리는 세션은 크게, 조용히 일하는 세션은 작게">
            자동 크기
          </button>
          <button aria-pressed={!mosaic} onClick={() => set({ ovLayout: 'grid' })}>
            같은 크기
          </button>
        </div>
        <button class="btn sm ghost" onClick={() => set({ board: 'all' })} data-testid="recaps">
          <I n="message-2" /> 요약 모아 보기
        </button>
        {g.done.length > 0 && (
          <button class="btn sm ghost" onClick={() => set({ ovDone: !s.showDone })}>
            <I n={s.showDone ? 'chevron-down' : 'chevron-right'} /> 끝남 {g.done.length}
          </button>
        )}
        <button class="btn sm" onClick={() => set({ composing: true })} data-testid="new-tile-btn">
          <I n="plus" /> 새 작업 <kbd>N</kbd>
        </button>
      </div>
      <div class={`ov-grid ${mosaic ? 'mosaic' : ''}`} ref={grid} style={mosaic ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: `${rowH}px` } : undefined}>
        {s.composing && <NewTile cols={cols} />}
        {items.map(({ t, z }) => (
          <Panel key={t.id} t={t} p={projectOf(s, t.projectId)} z={z} cols={cols} mosaic={mosaic} pinned={pins.has(t.id)} focused={t.id === focusId} onFocus={() => setFocus(t.id)} onPin={() => pin(t.id)} />
        ))}
        {!items.length && !s.composing && (
          <div class="ov-empty">
            <I n="layout-dashboard" />
            <h3>돌아가는 세션이 없어요</h3>
            <button class="btn primary" onClick={() => set({ composing: true })}>
              <I n="plus" /> 새 작업 <kbd>N</kbd>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The tile whose center lies in direction `dir` ([dx, dy]) from the focused one, nearest first. */
function neighbor(root, id, [dx, dy]) {
  const els = [...(root?.querySelectorAll('[data-task-id]') || [])];
  const cur = els.find((e) => e.dataset.taskId === id) || els[0];
  if (!cur) return null;
  const c = (e) => {
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2, r.height];
  };
  const [cx, cy, ch] = c(cur);
  let best = null;
  let bd = Infinity;
  for (const e of els) {
    if (e === cur) continue;
    const [x, y] = c(e);
    if (dx && (Math.sign(x - cx) !== dx || Math.abs(y - cy) > ch / 2)) continue;
    if (dy && (Math.sign(y - cy) !== dy || Math.abs(y - cy) < 8)) continue;
    const d = dx ? Math.abs(x - cx) : Math.abs(y - cy) * 1000 + Math.abs(x - cx);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (!best && dx) best = els[els.indexOf(cur) + dx] || null;
  return best?.dataset.taskId || null;
}

const Panel = memo(function Panel({ t, p, z, cols, mosaic, pinned, focused, onFocus, onPin }) {
  const blocked = isBlocked(t);
  const [c, r] = SPAN[z];
  const style = { ...roomVars(p?.color), viewTransitionName: `task-${t.id}` };
  if (mosaic) Object.assign(style, { gridColumn: `span ${Math.min(c, cols)}`, gridRow: `span ${r}` });
  return (
    <article
      class={`pn glass-2 z-${z} ${focused ? 'focused' : ''} ${blocked ? 'blocked' : ''} ${markOf(t)}`}
      data-task-id={t.id}
      data-testid="tile"
      data-state={blocked ? 'blocked' : t.state}
      data-z={z}
      style={style}
      onMouseDown={onFocus}
      onContextMenu={(e) => !e.target.closest('input, textarea') && openMenu(e, taskItems(t))}
    >
      <button class="pn-h" onClick={() => openTask(t.id)} data-tip="집중해서 보기 ↵" aria-label={`${p?.name || ''} · ${t.title} 집중해서 보기`}>
        <Glyph project={p} size={z === 's' ? 26 : 30} task={t} />
        <span class="pn-tt">
          <span class="pn-title">{t.title}</span>
          <span class="pn-meta">
            <span class="pj">
              {p?.name}
              {t.agent === 'codex' ? ' · Codex' : ''}
            </span>
            {isLive(t) && t.state !== 'exited' && <ModeTag task={t} short={z === 's'} />}
            {isLive(t) && t.state !== 'exited' && <CtxMini task={t} />}
          </span>
        </span>
        {!(z === 's' && isBusy(t)) && <StateChip t={t} />}
      </button>
      <Strip t={t} class="pn-strip" />
      <div class="pn-body">
        <Body t={t} p={p} z={z} focused={focused} />
      </div>
      {t.clash?.length > 0 && z !== 's' && isLive(t) && <ClashLine t={t} />}
      <Foot t={t} p={p} z={z} mosaic={mosaic} pinned={pinned} onPin={onPin} />
    </article>
  );
});

export function StateChip({ t }) {
  const now = useNow();
  if (isBlocked(t))
    return (
      <span class="st b">
        <i class="dia" />
        <span class="num">{waited(now - stateSince(t))}</span>
      </span>
    );
  if (t.state === 'needs_input') return <span class="st r">답장 차례</span>;
  if (t.state === 'review') return <span class="st v">새 결과</span>;
  if (t.state === 'exited') return <span class="st x">멈춤</span>;
  if (t.state === 'waiting') return <span class="st w">대기 중</span>;
  if (isBusy(t))
    return (
      <span class="st w">
        작업 중 <span class="num">{clock(now - turnStart(t))}</span>
      </span>
    );
  return <span class="st x">{t.state === 'merged' ? '머지함' : '끝남'}</span>;
}

/** When the task got into its current state: the last change in its strip. */
const stateSince = (t) => {
  const s = t.strip?.s?.at(-1);
  return s ? t.strip.from + s[0] * 1000 : t.updatedAt;
};
const turnStart = (t) => t.messages?.at(-1)?.at || t.activity?.since || t.updatedAt;
const pad = (n) => String(n).padStart(2, '0');
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
function waited(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분째`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분째`;
}

function Body({ t, p, z, focused }) {
  if (isBlocked(t)) {
    if (t.prompt)
      return (
        <>
          <PromptCard task={t} project={p} compact focus={focused} />
          {z === 'l' && <Before t={t} />}
        </>
      );
    return (
      <div class="pn-term">
        <div class="qhead">
          <I n="terminal-2" />
          <b>{t.reason || '터미널에서 답해야 해요'}</b>
        </div>
        <button
          class="btn sm primary"
          onClick={() => {
            openTask(t.id);
            openDrawer('agent', t.id);
          }}
        >
          <I n="terminal-2" /> 원본 터미널 열기
        </button>
      </div>
    );
  }
  if (t.state === 'needs_input')
    return t.reply?.md ? (
      <div class="pn-md">
        <Markdown md={t.reply.md} compact />
      </div>
    ) : (
      <p class="sumtx q">{whyOf(t)}</p>
    );
  if (t.state === 'review' || !isLive(t))
    return t.recap?.text ? (
      <p class="sumtx">{t.recap.text}</p>
    ) : t.reply?.md ? (
      <div class="pn-md">
        <Markdown md={t.reply.md} compact />
      </div>
    ) : (
      <p class="sumtx">{whyOf(t)}</p>
    );
  if (t.state === 'exited')
    return (
      <>
        <div class="stopr">
          <I n="player-stop" />
          {t.reason || '멈췄어요'}
        </div>
        {t.recap?.text && <p class="sumtx">{t.recap.text}</p>}
      </>
    );
  // Working: what it said last, what it did, and what it's doing now.
  const feed = (t.activity?.feedTail || []).filter((f) => f.st !== 'run');
  return (
    <>
      {z !== 's' && t.recap?.text && (
        <p class="rcap">
          <I n="message-2" />
          <span>{t.recap.text}</span>
        </p>
      )}
      {z === 'l' && (
        <div class="recent">
          {feed.slice(-4).map((f) => (
            <div key={f.id} class={`rl ${f.st === 'err' ? 'err' : ''}`}>
              <i class={`kd k-${kindOf(f.kind)}`} />
              <span class="lb">{f.text}</span>
            </div>
          ))}
        </div>
      )}
      <Now t={t} z={z} />
    </>
  );
}

const kindOf = (k) => ({ read: 'read', search: 'read', edit: 'edit', cmd: 'cmd', web: 'web', agent: 'agent' })[k] || 'read';

/** What the agent did just before it stopped to ask: context for the answer, kept quiet. */
function Before({ t }) {
  const feed = (t.activity?.feedTail || []).filter((f) => f.st !== 'run').slice(-3);
  if (!feed.length) return null;
  return (
    <div class="recent before">
      <span class="bf-h">묻기 전에 한 일</span>
      {feed.map((f) => (
        <div key={f.id} class={`rl ${f.st === 'err' ? 'err' : ''}`}>
          <i class={`kd k-${kindOf(f.kind)}`} />
          <span class="lb">{f.text}</span>
        </div>
      ))}
    </div>
  );
}

function Now({ t, z }) {
  const now = useNow();
  const run = (t.activity?.feedTail || []).findLast((f) => f.st === 'run');
  const what = t.state === 'waiting' ? t.reason || '백그라운드 작업을 기다려요' : t.activity?.current || (t.state === 'starting' ? '시작하는 중' : '생각하는 중');
  const since = t.activity?.since || t.updatedAt;
  return (
    <div class="nowl">
      <i class={`kd k-${run ? kindOf(run.kind) : 'think'}`} />
      <b>{what}</b>
      {t.activity?.current && <span class="num el">{clock(now - since)}</span>}
    </div>
  );
}

function Foot({ t, p, z, mosaic, pinned, onPin }) {
  const pinBtn =
    mosaic && !isBlocked(t) ? (
      <button class="ibtn sm" onClick={onPin} data-tip={pinned ? '원래 크기로' : '크게 보기'} aria-label={pinned ? '원래 크기로' : '크게 보기'}>
        <I n={pinned ? 'arrows-minimize' : 'arrows-maximize'} />
      </button>
    ) : null;
  if (isBlocked(t)) return null;
  const c = t.changes || {};
  const files = c.files ? (
    <>
      파일 {c.files}개 <span class="a">+{c.adds}</span> <span class="d">−{c.dels}</span>
    </>
  ) : (
    '바뀐 파일 없음'
  );
  if (t.state === 'needs_input')
    return (
      <div class="pn-foot">
        <QuickReply t={t} p={p} />
        {pinBtn}
      </div>
    );
  if (t.state === 'review')
    return (
      <div class="pn-foot">
        <span class="ft">
          {files} · {ago(t.updatedAt)} 전
        </span>
        <span class="sp" />
        {c.files > 0 && (
          <button class="btn sm" onClick={() => openTask(t.id, 'review')}>
            <I n="git-compare" /> 변경 보기
          </button>
        )}
        {pinBtn}
      </div>
    );
  if (t.state === 'exited')
    return (
      <div class="pn-foot">
        <button class="btn sm primary" onClick={() => resume(t.id)} data-testid="resume">
          <I n="player-play" /> 이어서 하기
        </button>
        <span class="ft">{ago(t.updatedAt)} 전 멈춤</span>
        <span class="sp" />
        {pinBtn}
      </div>
    );
  if (!isLive(t))
    return (
      <div class="pn-foot">
        <span class="ft">{ago(t.updatedAt)} 전 끝남</span>
        <span class="sp" />
        {pinBtn}
      </div>
    );
  const plan = t.activity?.plan || [];
  const done = plan.filter((x) => x.status === 'done').length;
  const act = plan.find((x) => x.status === 'active');
  return (
    <div class="pn-foot">
      {plan.length > 0 ? (
        <span class="ft">
          할 일 {done}/{plan.length}
          <span class="pbar">
            {plan.slice(0, 12).map((x, i) => (
              <i key={i} class={x.status === 'done' ? 'on' : x.status === 'active' ? 'cur' : ''} />
            ))}
          </span>
          {act && z !== 's' && <span class="tx">{act.text}</span>}
        </span>
      ) : (
        <span class="ft">{z === 's' ? '' : '작업 중'}</span>
      )}
      <span class="sp" />
      <ModeChip task={t} small={z === 's'} />
      {pinBtn}
    </div>
  );
}

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

/** A new session: what to ask, where, with which agent, starting in which mode and model. */
function NewTile({ cols }) {
  const s = useStore((s) => ({ projects: s.projects, filter: s.filter, agents: s.agents, draft: s.newDraft }));
  const d = { projectId: s.filter || s.projects[0]?.id, agent: 'claude', mode: 'default', model: '', ...(s.draft || {}) };
  const ta = useRef();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const p = s.projects.find((x) => x.id === d.projectId);
  const claude = d.agent === 'claude';
  const patch = (x) => set((st) => ({ newDraft: { ...d, ...st.newDraft, ...x } }));
  useEffect(() => ta.current?.focus(), []);
  const start = async () => {
    if (busy || text.trim().length < 2 || !p) return;
    setBusy(true);
    try {
      const t = await api('POST', '/api/tasks', { projectId: p.id, agent: d.agent, prompt: text.trim(), ...(claude ? { mode: d.mode, model: d.model || undefined } : {}) });
      sound('sent');
      set({ composing: false });
      toast(`${p.name}에서 새 세션을 시작했어요${claude ? ` · ${modeOf(d.mode).label}` : ''}`, { projectId: p.id });
      return t;
    } catch (e) {
      toast(e.message, { kind: 'err' });
    } finally {
      setBusy(false);
    }
  };
  const m = modeOf(d.mode);
  return (
    <article class={`pn glass-2 new z-l m-${claude ? m.tone : ''}`} style={{ ...roomVars(p?.color), gridColumn: `span ${Math.min(2, cols)}`, gridRow: 'span 2' }} data-testid="new-tile">
      <div class="pn-h">
        <Glyph project={p} size={30} />
        <span class="pn-tt">
          <span class="pn-title">새 작업</span>
          <span class="pn-meta">
            <span class="pj">
              {p?.name} · {claude ? 'Claude Code' : 'Codex'}
            </span>
          </span>
        </span>
        <button class="ibtn sm" onClick={() => set({ composing: false })} aria-label="닫기" data-tip="닫기 · Esc">
          <I n="x" />
        </button>
      </div>
      <div class="new-b">
        <textarea
          ref={ta}
          value={text}
          placeholder={claude && d.mode === 'plan' ? '맡길 일을 쓰세요 · 코드를 바꾸기 전에 계획부터 보여 줘요' : '에이전트에게 맡길 일을 쓰세요'}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Escape') return set({ composing: false });
            if (e.key === 'Tab' && e.shiftKey && claude) {
              e.preventDefault();
              return patch({ mode: nextMode(d.mode) });
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              start();
            }
          }}
          data-testid="new-input"
        />
        <div class="nf">
          <div class="nr">
            <span class="nl">프로젝트</span>
            <span class="nps">
              {s.projects
                .filter((x) => x.kind !== 'group' || x.members?.length)
                .slice(0, 12)
                .map((x) => (
                  <button key={x.id} type="button" class={`npj ${x.id === d.projectId ? 'on' : ''}`} style={roomVars(x.color)} onClick={() => patch({ projectId: x.id })} data-tip={x.name}>
                    <Glyph project={x} size={22} />
                    {x.id === d.projectId && <span>{x.name}</span>}
                  </button>
                ))}
            </span>
          </div>
          <div class="nr">
            <span class="nl">에이전트</span>
            <div class="seg">
              {[
                ['claude', 'Claude Code'],
                ['codex', 'Codex'],
              ].map(([k, l]) => (
                <button key={k} aria-pressed={d.agent === k} disabled={s.agents && s.agents[k] === false} onClick={() => patch({ agent: k })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {claude ? (
            <>
              <div class="nr">
                <span class="nl">시작 모드</span>
                <div class="seg">
                  {MODES.filter((x) => CYCLE.includes(x.key)).map((x) => (
                    <button key={x.key} class={`m-${x.tone}`} aria-pressed={d.mode === x.key} onClick={() => patch({ mode: x.key })} data-tip={x.desc}>
                      <I n={x.icon} />
                      {x.label}
                    </button>
                  ))}
                </div>
                <kbd>⇧Tab</kbd>
              </div>
              <div class="nr">
                <span class="nl">모델</span>
                <div class="seg">
                  {[{ key: '', label: '기본' }, ...MODELS].map((x) => (
                    <button key={x.key} aria-pressed={d.model === x.key} onClick={() => patch({ model: x.key })} data-tip={x.desc}>
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div class="nr">
              <span class="nl">승인</span>
              <span class="hint">Codex는 설정에 정한 승인 방식으로 시작해요</span>
            </div>
          )}
        </div>
        <div class="new-f">
          <span class="hint">
            <kbd>↵</kbd> 시작 · <kbd>Esc</kbd> 취소
          </span>
          <span class="sp" />
          <button class="btn sm primary" disabled={busy || text.trim().length < 2} onClick={start}>
            <I n="player-play" /> 시작
          </button>
        </div>
      </div>
    </article>
  );
}
