// 관제: every live session on one screen, as an instrument panel. On top, a readout strip (how many
// wait on me, want a reply, are working, have stopped) and the plan's usage gauges; below, one plate
// per group, split into cells by hairlines. What waits on me comes first and carries its card.
import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore, set, projectOf, toast, GENERAL } from '../../store.js';
import { isLive, isBlocked, whyOf, markOf, grouped, lampOf, lampTimer, clockOf } from '../../core/status.js';
import { MODES, CYCLE, MODELS, nextMode, modeOf } from '../../core/session.js';
import { openTask, quickSend, archiveAsk, resume, openDrawer } from '../../actions.js';
import { enterAction } from '../../core/sendPolicy.js';
import { api } from '../../api.js';
import { PromptCard } from '../prompt/PromptCard.jsx';
import { Markdown } from '../../md/Markdown.jsx';
import { openMenu, openMenuAt } from '../../ui/Menu.jsx';
import { taskItems } from '../task/taskActions.js';
import { ModeChip } from '../session/Pickers.jsx';
import { ClashLine } from '../talk/Clash.jsx';
import { headline } from '../usage/Usage.jsx';
import { Glyph, I, Lamp, useNow, roomVars, ago } from '../../ui/bits.jsx';
import { sound } from '../../app/sounds.js';

const OV_GROUPS = [
  { key: 'wait', title: '허락·선택할 것', short: '나를 기다림', z: 'l' },
  { key: 'turn', title: '답장·결과', short: '답장·결과', z: 'm' },
  { key: 'work', title: '작업 중', short: '작업 중', z: 'l' },
  { key: 'stop', title: '멈춤', short: '멈춤', z: 'm' },
];
const LAMP_OF_GROUP = { wait: 'wait', turn: 'reply', work: 'work', stop: 'stop' };

export function Overview() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, filter: s.filter, showDone: s.ovDone, composing: s.composing, usage: s.usage }));
  const mine = s.tasks.filter((t) => !t.archived && (!s.filter || t.projectId === s.filter));
  const g = grouped(mine);
  const groups = {
    wait: g.yours.filter(isBlocked),
    turn: g.yours.filter((t) => !isBlocked(t)),
    work: g.working,
    stop: s.showDone ? [...g.stopped, ...g.done] : g.stopped,
  };
  const order = OV_GROUPS.flatMap((x) => groups[x.key]);
  const grid = useRef();
  const [focus, setFocus] = useState(null);
  const focusId = focus && order.some((t) => t.id === focus) ? focus : order[0]?.id;

  // Arrows move to the cell that is really in that direction; ↵ opens it; digits answer its card.
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
      const t = order.find((x) => x.id === focusId);
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
  }, [order.map((t) => t.id).join(), focusId]);
  useEffect(() => {
    grid.current?.querySelector(`[data-task-id="${focusId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusId]);

  const project = s.filter && projectOf(s, s.filter);
  const use = headline(s.usage);
  let i = 0;
  const tools = (
    <div class="ov-tools">
      <button class="scope-mini" data-tip="볼 프로젝트" onClick={(e) => openMenuAt(e.currentTarget, [{ icon: 'stack-2', label: '모든 프로젝트', run: () => set({ filter: null }) }, '-', ...s.projects.map((p) => ({ icon: p.icon || 'folder', label: p.name, run: () => set({ filter: p.id }) }))], 'end')}>
        {project ? <Glyph project={project} size={18} /> : <I n="stack-2" />}
        <span>{project ? project.name : '모든 프로젝트'}</span>
        <I n="selector" class="dn" />
      </button>
      <button class="btn sm ghost" onClick={() => set({ board: 'all' })} data-testid="recaps">
        <I n="message-2" /> 요약 모아 보기
      </button>
      {g.done.length > 0 && (
        <button class="btn sm ghost" onClick={() => set({ ovDone: !s.showDone })}>
          <I n={s.showDone ? 'chevron-down' : 'chevron-right'} /> 끝남 <span class="num">{g.done.length}</span>
        </button>
      )}
      <button class="btn sm" onClick={() => set({ composing: true })} data-testid="new-tile-btn" data-tip="새 작업 · N">
        <I n="plus" /> 새 작업
      </button>
    </div>
  );
  const first = s.composing ? 'new' : OV_GROUPS.find((x) => groups[x.key].length)?.key;
  return (
    <div class="overview" data-testid="overview">
      <div class="ov-scroll scroll" ref={grid}>
        <header class="ov-head">
          <div class="ov-title">
            <h1>관제</h1>
            <Clock />
          </div>
          <div class="cluster" role="group" aria-label="세션 수">
            {OV_GROUPS.map((x) => (
              <div key={x.key} class={`win ${x.key === 'wait' ? 'w' : x.key === 'stop' ? '' : 'i'}`} data-testid={`count-${x.key}`}>
                <small>
                  <Lamp s={LAMP_OF_GROUP[x.key]} word={x.short} sm />
                </small>
                <b class="num">{groups[x.key].length}</b>
              </div>
            ))}
          </div>
          <span class="sp" />
          {(use.h5 || use.wk) && (
            <div class="gauges">
              {use.h5 && <Gauge label="5시간" pct={use.h5.pct} />}
              {use.wk && <Gauge label="주간" pct={use.wk.pct} />}
            </div>
          )}
        </header>
        {s.composing && (
          <section class="ov-grp" aria-label="새 작업">
            <div class="ov-gh">
              <h2 class="label">새 작업</h2>
              {tools}
            </div>
            <NewTile />
          </section>
        )}
        {OV_GROUPS.map((x) => {
          const list = groups[x.key];
          if (!list.length) return null;
          return (
            <section key={x.key} class="ov-grp" aria-label={x.title} data-group={x.key}>
              <div class="ov-gh">
                <h2 class="label">
                  {x.title}
                  <span class="num">{list.length}</span>
                </h2>
                {first === x.key && tools}
              </div>
              <div class="plate ov-plate" style={{ '--i': i++ }}>
                {list.map((t) => (
                  <Cell key={t.id} t={t} p={projectOf(s, t.projectId)} z={x.key === 'stop' && !isLive(t) ? 's' : x.z} focused={t.id === focusId} onFocus={() => setFocus(t.id)} />
                ))}
              </div>
            </section>
          );
        })}
        {!order.length && !s.composing && <div class="ov-gh">{tools}</div>}
        {!order.length && !s.composing && (
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

/** Today's date and the time, for the head of the panel. */
function Clock() {
  const now = useNow(15000);
  const d = new Date(now);
  const date = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  return (
    <span class="when num">
      {date} · {time}
    </span>
  );
}

/** A half-dial gauge for one usage limit, with quarter ticks; it turns warm past 80%. */
function Gauge({ label, pct }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const a = Math.PI * (1 - f);
    return [46 + Math.cos(a) * 30, 48 - Math.sin(a) * 30, 46 + Math.cos(a) * 26, 48 - Math.sin(a) * 26];
  });
  return (
    <div class={`gauge ${pct >= 80 ? 'hi' : ''}`} data-tip={`${label} 한도의 ${pct}%를 썼어요`}>
      <svg viewBox="0 0 92 52" aria-hidden="true">
        <path class="track" d="M8 48a38 38 0 0 1 76 0" />
        <path class="val" d="M8 48a38 38 0 0 1 76 0" pathLength="100" stroke-dasharray={`${Math.max(0, Math.min(100, pct))} 100`} />
        {ticks.map(([x1, y1, x2, y2], k) => (
          <line key={k} class="tick" x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} />
        ))}
      </svg>
      <b class="num">
        {pct}
        <small>%</small>
      </b>
      <span>{label}</span>
    </div>
  );
}

// The cell nearest in the direction of an arrow key, by where cells really are on screen.
function neighbor(root, id, [dx, dy]) {
  const els = [...(root?.querySelectorAll('[data-testid="tile"]') || [])];
  const cur = els.find((e) => e.dataset.taskId === id);
  if (!cur) return els[0]?.dataset.taskId || null;
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

const Cell = memo(function Cell({ t, p, z, focused, onFocus }) {
  const blocked = isBlocked(t);
  const now = useNow();
  const l = lampOf(t);
  const timer = lampTimer(t, now);
  const meta = [p?.name, t.agent === 'codex' ? 'Codex' : null, ['reply', 'result', 'stop'].includes(l.s) ? `${ago(t.updatedAt)} 전` : null].filter(Boolean).join(' · ');
  return (
    <article
      class={`cell oc z-${z} ${focused ? 'focused' : ''} ${blocked ? 'blocked' : ''} ${markOf(t)}`}
      data-task-id={t.id}
      data-testid="tile"
      data-state={blocked ? 'blocked' : t.state}
      data-z={z}
      style={{ ...roomVars(p?.color), viewTransitionName: `task-${t.id}` }}
      onMouseDown={onFocus}
      onContextMenu={(e) => !e.target.closest('input, textarea') && openMenu(e, taskItems(t))}
    >
      <button class="oc-h pn-h" onClick={() => openTask(t.id)} data-tip="집중해서 보기 ↵" aria-label={`${p?.name || ''} · ${t.title} 집중해서 보기`}>
        <Glyph project={p} size={28} />
        <span class="oc-tt">
          <span class="oc-title" title={t.title}>
            {t.title}
          </span>
          <span class="oc-meta">{meta}</span>
        </span>
        <Lamp s={l.s} word={l.word}>{timer}</Lamp>
      </button>
      <div class="oc-b">
        <Body t={t} p={p} z={z} focused={focused} />
      </div>
      {t.clash?.length > 0 && z !== 's' && isLive(t) && <ClashLine t={t} />}
      <Foot t={t} p={p} z={z} />
    </article>
  );
});

function Body({ t, p, z, focused }) {
  if (isBlocked(t)) {
    if (t.prompt)
      return (
        <>
          {z === 'l' && <Before t={t} />}
          <PromptCard task={t} project={p} compact focus={focused} />
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
      <Fade>
        <Markdown md={t.reply.md} compact />
      </Fade>
    ) : (
      <p class="sumtx q">{whyOf(t)}</p>
    );
  if (t.state === 'review' || !isLive(t))
    return t.recap?.text ? (
      <p class="sumtx">{t.recap.text}</p>
    ) : t.reply?.md ? (
      <Fade>
        <Markdown md={t.reply.md} compact />
      </Fade>
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

/** A reply cut to the tile: the last lines fade only when there is more below them. */
function Fade({ children }) {
  const ref = useRef();
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCut(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} class={`pn-md ${cut ? 'cut' : ''}`}>
      {children}
    </div>
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
  const since = t.activity?.since || t.activity?.idleAt || t.updatedAt;
  return (
    <div class="nowl">
      <i class={`kd k-${run ? kindOf(run.kind) : 'think'}`} />
      <b>{what}</b>
      {t.activity?.current && <span class="num el">{clockOf(now - since)}</span>}
    </div>
  );
}

function Foot({ t, p, z }) {
  const pinBtn = null;
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
function NewTile() {
  const s = useStore((s) => ({ projects: s.projects, filter: s.filter, agents: s.agents, draft: s.newDraft }));
  const d = { projectId: s.filter || s.projects[0]?.id, agent: 'claude', mode: 'default', model: '', ...(s.draft || {}) };
  const ta = useRef();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // No project picked (or none added yet): a general session, anchored to one later.
  const p = (d.projectId && s.projects.find((x) => x.id === d.projectId)) || GENERAL;
  const claude = d.agent === 'claude';
  const patch = (x) => set((st) => ({ newDraft: { ...d, ...st.newDraft, ...x } }));
  useEffect(() => ta.current?.focus(), []);
  const start = async () => {
    if (busy || text.trim().length < 2 || !p) return;
    setBusy(true);
    try {
      const t = await api('POST', '/api/tasks', { projectId: p.general ? undefined : p.id, agent: d.agent, prompt: text.trim(), ...(claude ? { mode: d.mode, model: d.model || undefined } : {}) });
      sound('sent');
      set({ composing: false });
      toast(`${p.general ? '범용 세션을 시작했어요' : `${p.name}에서 새 세션을 시작했어요`}${claude ? ` · ${modeOf(d.mode).label}` : ''}`, { projectId: p.id });
      return t;
    } catch (e) {
      toast(e.message, { kind: 'err' });
    } finally {
      setBusy(false);
    }
  };
  const m = modeOf(d.mode);
  return (
    <article class={`pn new ov-new m-${claude ? m.tone : ''}`} style={roomVars(p?.color)} data-testid="new-tile">
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
          placeholder={p.general ? '무엇이든 묻거나 맡기세요 · 어느 프로젝트 일인지는 나중에 정해도 돼요' : claude && d.mode === 'plan' ? '맡길 일을 쓰세요 · 코드를 바꾸기 전에 계획부터 보여 줘요' : '에이전트에게 맡길 일을 쓰세요'}
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
              <button type="button" class={`npj ${p.general ? 'on' : ''}`} style={roomVars(GENERAL.color)} onClick={() => patch({ projectId: null })} data-tip="프로젝트 없이 · 나중에 붙일 수 있어요" aria-label="범용" aria-pressed={p.general} data-testid="new-general">
                <Glyph project={GENERAL} size={22} />
                {p.general && <span>범용</span>}
              </button>
              {s.projects
                .filter((x) => x.kind !== 'group' || x.members?.length)
                .slice(0, 12)
                .map((x) => (
                  <button key={x.id} type="button" class={`npj ${x.id === p.id ? 'on' : ''}`} style={roomVars(x.color)} onClick={() => patch({ projectId: x.id })} data-tip={x.name} aria-label={x.name} aria-pressed={x.id === p.id}>
                    <Glyph project={x} size={22} />
                    {x.id === p.id && <span>{x.name}</span>}
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
            <kbd>↵</kbd> 시작{claude ? <> · <kbd>⇧Tab</kbd> 모드</> : null} · <kbd>Esc</kbd> 취소
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
