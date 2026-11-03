// The left rail: every session, grouped by what it needs from me. "내 차례" on top, most urgent
// first; a row says in one line why it's there.
import { memo } from 'preact/compat';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore, get, set, projectOf } from '../../store.js';
import { isMac } from '../../util.js';
import { GROUPS, grouped, whyOf, tagOf, isBlocked, labelOf, groupOf } from '../../core/status.js';
import { select, archive, archiveAsk, archiveMany, resumeMany, togglePick, pickRange, clearPicks, shelved, newTask, restore, startTriage } from '../../actions.js';
import { openMenu } from '../../ui/Menu.jsx';
import { Glyph, I, TimeAgo, useDismiss, useListNav, roomVars } from '../../ui/bits.jsx';
import { useFlip } from '../../ui/useFlip.js';
import { taskItems, pickedItems, projectItems } from '../task/taskActions.js';
import { keyLabel } from '../../app/keys.js';
import { openModal } from '../../store.js';

// Groups you clear out once you've looked: their header offers "모두 보관".
const CLEARABLE = new Set(['stopped', 'done']);

export function Rail() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, filter: s.filter, selected: s.selected, collapsed: s.collapsed, picked: s.picked, railView: s.railView, railW: s.railW, loaded: s.loaded }));
  const live = s.tasks.filter((t) => !t.archived && (!s.filter || t.projectId === s.filter));
  const g = grouped(live);
  const list = useRef();
  useFlip(list);
  const picked = live.filter((t) => s.picked.includes(t.id));
  const shelf = shelved(s.tasks, s.filter);
  const toggle = (k) => set((st) => ({ collapsed: { ...st.collapsed, [k]: !st.collapsed[k] } }));

  return (
    <aside class="rail glass" style={{ width: s.railW + 'px' }} aria-label="작업 목록" data-testid="rail">
      <ProjectFilter projects={s.projects} tasks={s.tasks} filter={s.filter} />
      {picked.length > 0 && <PickBar tasks={picked} />}
      {s.railView === 'shelf' ? (
        <Shelf tasks={shelf} />
      ) : (
        <div class="rail-list scroll" ref={list}>
          {s.loaded && !live.length && <RailEmpty hasProjects={s.projects.length > 0} />}
          {GROUPS.map((grp) => {
            const items = g[grp.key];
            if (!items.length) return null;
            const closed = !!s.collapsed[grp.key];
            const ids = items.map((t) => t.id);
            const hot = grp.key === 'yours' && items.some(isBlocked);
            const tone = hot ? 'warn' : grp.key === 'yours' ? 'info' : '';
            const all = { icon: 'archive', label: `${items.length}개 모두 보관`, run: () => archiveMany(ids) };
            const fold = { icon: closed ? 'chevron-down' : 'chevron-up', label: closed ? '펼치기' : '접기', run: () => toggle(grp.key) };
            return (
              <section key={grp.key} aria-label={grp.title} data-group={grp.key}>
                <div class="grp-h" onContextMenu={(e) => openMenu(e, [all, '-', fold])}>
                  <button class={`grp-t ${closed ? 'closed' : ''}`} onClick={() => toggle(grp.key)} aria-expanded={!closed}>
                    <I n="chevron-down" />
                    {grp.title}
                    <span class={`count ${tone}`}>{items.length}</span>
                  </button>
                  {grp.key === 'yours' && items.length > 1 && (
                    <button class="grp-x" onClick={startTriage} data-tip="하나씩 차례로 처리" data-kbd={keyLabel('triage')}>
                      <I n="player-track-next" /> 차례로
                    </button>
                  )}
                  {CLEARABLE.has(grp.key) && (
                    <button class="grp-x" onClick={all.run} data-tip={`'${grp.title}' ${items.length}개를 보관함으로 옮겨요`}>
                      <I n="archive" /> 모두 보관
                    </button>
                  )}
                </div>
                {!closed && items.map((t) => <Row key={t.id} t={t} p={projectOf(s, t.projectId)} sel={t.id === s.selected} picked={s.picked.includes(t.id)} group={{ title: grp.title, ids }} />)}
              </section>
            );
          })}
        </div>
      )}
      <div class="rail-foot">
        <button class="btn sm ghost" onClick={() => newTask()} data-tip="새 작업" data-kbd={keyLabel('new')}>
          <I n="plus" /> 새 작업
        </button>
        <button class="btn sm ghost" onClick={() => openModal('import', { projectId: s.filter })} data-tip="다른 터미널이나 지난 대화의 세션을 불러와요">
          <I n="history" /> 불러오기
        </button>
        <span class="sp" />
        {(shelf.length > 0 || s.railView === 'shelf') && (
          <button class={`btn sm ghost ${s.railView === 'shelf' ? 'on' : ''}`} onClick={() => set({ railView: s.railView === 'shelf' ? 'list' : 'shelf' })} data-tip="보관한 작업 · 꺼내면 같은 대화로 이어가요">
            <I n="archive" /> 보관함 <span class="n num">{shelf.length}</span>
          </button>
        )}
      </div>
      <Resizer />
    </aside>
  );
}

const Row = memo(function Row({ t, p, sel, picked, group }) {
  const blocked = isBlocked(t);
  const tag = tagOf(t);
  const why = whyOf(t);
  const plan = t.activity?.plan || [];
  const done = plan.filter((x) => x.status === 'done').length;
  const finished = t.state === 'merged' || t.state === 'discarded';
  const click = (e) => {
    if (e.shiftKey) return pickRange(t.id);
    if (isMac ? e.metaKey : e.ctrlKey) return togglePick(t.id);
    clearPicks();
    select(t.id);
  };
  const menu = (e) => {
    const ids = get().picked;
    openMenu(e, ids.length > 1 && ids.includes(t.id) ? pickedItems(ids) : taskItems(t, { group }));
  };
  return (
    <div class="rrow-wrap room-scope" style={roomVars(p?.color)} data-flip={t.id} onContextMenu={menu}>
      <button
        class={`rrow ${sel ? 'sel' : ''} ${picked ? 'picked' : ''} ${blocked ? 'blocked' : ''} ${finished ? 'finished' : ''}`}
        onClick={click}
        aria-current={sel ? 'true' : undefined}
        aria-pressed={picked ? 'true' : undefined}
        aria-label={`${p?.name || ''} · ${t.title} · ${labelOf(t)}`}
        data-testid="rail-row"
        data-task-id={t.id}
        data-state={blocked ? 'blocked' : t.state}
      >
        <Glyph project={p} size={30} task={t} />
        {picked && (
          <span class="pk">
            <I n="check" />
          </span>
        )}
        <span class="rr-main">
          <span class="rr-t">
            {t.remote && <I n="device-mobile" class="rm" />}
            {t.watching && <span class="where">{t.watching.where}</span>}
            {t.title}
          </span>
          <span class="rr-s">
            {tag && <span class={`tag ${tag.tone} ${tag.solid ? 'solid' : ''}`}>{tag.label}</span>}
            <span class="why">{why.replace(/^(허락|질문|계획|선택|터미널) · /, '')}</span>
          </span>
          {plan.length > 0 && !finished && (
            <span class="rr-plan" aria-label={`할 일 ${done}/${plan.length}`}>
              <i style={{ width: `${(done / plan.length) * 100}%` }} />
            </span>
          )}
        </span>
        <span class="rr-meta">
          {t.state === 'review' && t.changes?.files > 0 ? (
            <span class="diffstat num">
              <b class="a">+{t.changes.adds}</b> <b class="d">−{t.changes.dels}</b>
            </span>
          ) : (
            <TimeAgo at={t.updatedAt} />
          )}
        </span>
      </button>
      <button class="rrow-x" onClick={() => (finished ? archive(t.id) : archiveAsk(t.id))} data-tip={finished ? '목록에서 내리기' : '보관 · 꺼내면 같은 대화로 이어가요'} data-kbd="E" aria-label={`${t.title} 보관`}>
        <I n="archive" />
      </button>
    </div>
  );
});

/** Which projects the rail shows: the current one by name, and a searchable list of all of them. */
function ProjectFilter({ projects, tasks, filter }) {
  const [open, setOpen] = useState(false);
  const box = useRef();
  const live = tasks.filter((t) => !t.archived);
  const counts = (pid) => {
    const mine = pid ? live.filter((t) => t.projectId === pid) : live;
    return { all: mine.length, yours: mine.filter((t) => t.state === 'needs_input' || t.state === 'review').length, blocked: mine.filter(isBlocked).length, busy: mine.filter((t) => groupOf(t) === 'working').length };
  };
  const cur = filter ? projects.find((p) => p.id === filter) : null;
  const c = counts(filter);
  useDismiss(open, () => setOpen(false), box);
  return (
    <div class="scope" ref={box}>
      <button class={`scope-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={`프로젝트: ${cur ? cur.name : '모든 프로젝트'}`} data-testid="project-switch">
        {cur ? <Glyph project={cur} size={30} /> : <span class="scope-all"><I n="stack-2" /></span>}
        <span class="scope-m">
          <b>{cur ? cur.name : '모든 프로젝트'}</b>
          <small>{c.all ? `작업 ${c.all}${c.busy ? ` · 작업 중 ${c.busy}` : ''}` : cur?.desc || '작업 없음'}</small>
        </span>
        {c.yours > 0 && <span class={`badge ${c.blocked ? 'warn' : 'info'} num`}>{c.yours}</span>}
        <I n="selector" class="scope-chev" />
      </button>
      {open && <ProjectList projects={projects} filter={filter} counts={counts} close={() => setOpen(false)} />}
    </div>
  );
}

function ProjectList({ projects, filter, counts, close }) {
  const [q, setQ] = useState('');
  const shown = [{ id: null, name: '모든 프로젝트' }, ...projects].filter((p) => !q || !p.id || (p.name + ' ' + (p.desc || '') + ' ' + (p.display || '')).toLowerCase().includes(q.toLowerCase()));
  const pick = (p) => {
    set({ filter: p?.id || null });
    close();
  };
  const [active, setActive, onKeyDown] = useListNav(shown.length, (i) => pick(shown[i]));
  const list = useRef();
  // Opens on the project already shown; the active row stays in view while arrowing.
  useLayoutEffect(() => setActive(Math.max(0, shown.findIndex((p) => p.id === filter))), []);
  useLayoutEffect(() => list.current?.querySelector('.scope-li.active')?.scrollIntoView({ block: 'nearest' }), [active]);
  return (
    <div class="scope-pop" role="dialog" aria-label="프로젝트 고르기">
      <div class="scope-q">
        <I n="search" />
        <input
          autoFocus
          placeholder="프로젝트 찾기"
          value={q}
          onInput={(e) => {
            setQ(e.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          aria-label="프로젝트 찾기"
        />
      </div>
      <div class="scope-list scroll" role="listbox" aria-label="프로젝트" ref={list}>
        {shown.map((p, i) => {
          const c = counts(p.id);
          const n = p.id ? projects.indexOf(p) + 1 : 0;
          return (
            <button
              key={p.id || 'all'}
              class={`scope-li ${i === active ? 'active' : ''} ${filter === p.id ? 'cur' : ''}`}
              role="option"
              aria-selected={filter === p.id}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(p)}
              onContextMenu={(e) => p.id && openMenu(e, projectItems(p))}
            >
              {p.id ? <Glyph project={p} size={28} /> : <span class="scope-all sm"><I n="stack-2" /></span>}
              <span class="scope-m">
                <b>{p.name}</b>
                <small>{p.id ? p.desc || p.display : `프로젝트 ${projects.length}개`}</small>
              </span>
              <span class="scope-c">
                {c.busy > 0 && (
                  <span class="busy num" data-tip={`작업 중 ${c.busy}`}>
                    <span class="spin xs" />
                    {c.busy}
                  </span>
                )}
                {c.yours > 0 && <span class={`badge ${c.blocked ? 'warn' : 'info'} num`}>{c.yours}</span>}
              </span>
              {n <= 9 && <kbd>{isMac ? `⌥${n}` : `Alt+${n}`}</kbd>}
              {filter === p.id && <I n="check" class="scope-ok" />}
            </button>
          );
        })}
        {!shown.length && <div class="empty">찾는 프로젝트가 없어요</div>}
      </div>
      <div class="scope-foot">
        <button
          class="btn sm ghost"
          onClick={() => {
            close();
            openModal('addProject');
          }}
        >
          <I n="folder-plus" /> 프로젝트 추가
        </button>
        <span class="sp" />
        <button
          class="btn sm ghost"
          onClick={() => {
            close();
            set({ screen: 'settings', settingsTab: 'projects', settingsProject: filter || undefined });
          }}
        >
          <I n="settings" /> 관리
        </button>
      </div>
    </div>
  );
}

function PickBar({ tasks }) {
  const stopped = tasks.filter((t) => !t.running && t.state === 'exited' && !t.watching);
  return (
    <div class="pickbar" role="toolbar" aria-label="선택한 작업">
      <span class="n">
        <I n="checks" /> {tasks.length}개 선택
      </span>
      <span class="sp" />
      {stopped.length > 0 && (
        <button class="btn sm" onClick={() => resumeMany(stopped.map((t) => t.id))}>
          <I n="player-play" /> 재개
        </button>
      )}
      <button class="btn sm" onClick={() => archiveMany(tasks.map((t) => t.id))}>
        <I n="archive" /> 보관 <kbd>E</kbd>
      </button>
      <button class="ibtn sm" onClick={clearPicks} data-tip="선택 해제" data-kbd="Esc" aria-label="선택 해제">
        <I n="x" />
      </button>
    </div>
  );
}

function Shelf({ tasks }) {
  const [q, setQ] = useState('');
  const projects = useStore((s) => s.projects);
  const list = tasks.filter((t) => !q || (t.title + ' ' + (projectOf({ projects }, t.projectId)?.name || '')).toLowerCase().includes(q.toLowerCase())).sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  return (
    <div class="shelf">
      <div class="shelf-h">
        <button class="ibtn sm" onClick={() => set({ railView: 'list' })} aria-label="목록으로">
          <I n="arrow-left" />
        </button>
        <b>보관함</b>
        <span class="count">{tasks.length}</span>
      </div>
      <input class="field" placeholder="보관한 작업 찾기" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <div class="rail-list scroll">
        {!list.length && <div class="empty">{q ? '찾는 작업이 없어요' : '보관한 작업이 없어요'}</div>}
        {list.map((t) => {
          const p = projectOf({ projects }, t.projectId);
          return (
            <div key={t.id} class="rrow shelved" onContextMenu={(e) => openMenu(e, taskItems(t))}>
              <Glyph project={p} size={30} />
              <span class="rr-main">
                <span class="rr-t">{t.title}</span>
                <span class="rr-s">
                  <span class="why">
                    {p?.name} · <TimeAgo at={t.archivedAt || t.updatedAt} /> 전에 보관
                  </span>
                </span>
              </span>
              <button class="btn sm" onClick={() => restore(t.id)} aria-label={`${t.title} 꺼내기`}>
                꺼내기
              </button>
              <button class="ibtn sm" onClick={() => openModal('discard', { taskId: t.id })} data-tip="버리기" aria-label={`${t.title} 버리기`}>
                <I n="trash" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RailEmpty({ hasProjects }) {
  return (
    <div class="empty rail-empty">
      <I n={hasProjects ? 'inbox' : 'folder-plus'} style="font-size:22px;color:var(--text-3)" />
      <p>{hasProjects ? '지금은 할 일이 없어요' : '프로젝트부터 추가해 주세요'}</p>
      {hasProjects ? (
        <button class="btn sm" onClick={() => newTask()}>
          <I n="plus" /> 새 작업 <kbd>N</kbd>
        </button>
      ) : (
        <button class="btn sm" onClick={() => openModal('addProject')}>
          <I n="folder-plus" /> 프로젝트 추가
        </button>
      )}
    </div>
  );
}

/** Drag the rail's edge to resize it; double-click resets. */
function Resizer() {
  const start = (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = get().railW;
    const move = (ev) => set({ railW: Math.max(240, Math.min(440, w0 + ev.clientX - x0)) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.documentElement.classList.remove('resizing');
    };
    document.documentElement.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div class="rail-resize" onPointerDown={start} onDblClick={() => set({ railW: 300 })} role="separator" aria-orientation="vertical" aria-label="목록 너비" />;
}
