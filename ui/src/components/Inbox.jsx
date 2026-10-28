import { useEffect, useRef } from 'preact/hooks';
import { useStore, set, projectOf } from '../store.js';
import { LANES, laneOf, iconOf, ago, roomVars, progressOf } from '../util.js';
import { select, visibleTasks, newTask, shelved } from '../actions.js';
import { Glyph, I, Spinner } from './bits.jsx';
import { ShelfButton } from './Board.jsx';

export function Inbox() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, filter: s.filter, selected: s.selected, collapsed: s.collapsed, loaded: s.loaded }));
  const list = visibleTasks(s);
  const groups = LANES.map((l) => ({ ...l, items: list.filter((t) => laneOf(t) === l.key) })).filter((g) => g.items.length);
  const selRef = useRef();
  useEffect(() => selRef.current?.scrollIntoView({ block: 'nearest' }), [s.selected]);

  const toggle = (k) => set((st) => ({ collapsed: { ...st.collapsed, [k]: !st.collapsed[k] } }));

  return (
    <aside class="inbox" aria-label="작업 목록">
      <div class="inbox-list scroll">
        {s.loaded && !list.length && (
          <div class="empty">
            <h3>{s.projects.length ? '할 일이 비어 있어요' : '프로젝트부터 추가하세요'}</h3>
            {s.projects.length ? (
              <>
                <p>
                  <kbd>N</kbd> 을 누르거나 아래 버튼으로 에이전트에게 첫 작업을 시켜보세요. 작업마다 별도 worktree에서 돌아가서 서로 부딪히지 않아요.
                </p>
                <button class="btn" onClick={() => newTask()}>
                  <I n="plus" /> 새 작업
                </button>
              </>
            ) : (
              <p>오른쪽에서 git 저장소를 골라 추가하면 돼요. 프로젝트마다 고유한 색과 아이콘이 붙어요.</p>
            )}
          </div>
        )}
        {groups.map((g) => {
          const closed = !!s.collapsed[g.key];
          return (
            <section key={g.key} aria-label={g.title}>
              <button class={`lane-h ${closed ? 'closed' : ''} ${g.key === 'blocked' ? 'hot' : ''}`} onClick={() => toggle(g.key)} aria-expanded={!closed}>
                <I n="chevron-down" />
                {g.title} <span class="n">{g.items.length}</span>
              </button>
              {!closed &&
                g.items.map((t) => {
                  const p = projectOf(s, t.projectId);
                  const sel = t.id === s.selected;
                  return <Row key={t.id} t={t} p={p} sel={sel} refEl={sel ? selRef : undefined} />;
                })}
            </section>
          );
        })}
        {shelved(s.tasks, s.filter).length > 0 && <ShelfButton tasks={s.tasks} filter={s.filter} class="shelf-link" />}
      </div>
    </aside>
  );
}

function Row({ t, p, sel, refEl }) {
  const icon = iconOf(t);
  const line = t.state === 'review' && t.summary ? t.summary : t.reason || t.summary || '';
  const done = t.state === 'merged' || t.state === 'discarded';
  const pr = progressOf(t);
  const working = t.state === 'working' || t.state === 'starting';
  const showAct = !done && (pr.running > 0 || pr.total > 0 || (working && pr.current));
  return (
    <button ref={refEl} class={`row ${sel ? 'sel' : ''} ${done ? 'done' : ''} ${t.ask ? 'blocked' : ''}`} style={roomVars(p?.color)} onClick={() => select(t.id)} aria-current={sel ? 'true' : undefined}>
      <Glyph project={p} />
      <span style="min-width:0">
        <div class="t">
          {t.remote && <I n="device-mobile" class="rm" />}
          {t.watching && <span class="where">{t.watching.where}</span>}
          {t.title}
        </div>
        <div class="s">
          <b>{p?.name || '?'}</b> {line}
        </div>
        {showAct && (
          <div class="act">
            {pr.total > 0 && (
              <span class="pl" title={pr.doing?.text || ''}>
                <span class="bar">
                  <i style={{ width: `${(pr.done / pr.total) * 100}%` }} />
                </span>
                {pr.done}/{pr.total}
              </span>
            )}
            {pr.running > 0 && (
              <span class="sa">
                <I n="users" /> 서브 {pr.running}
              </span>
            )}
            {working && pr.current && <span class="cur">{pr.current}</span>}
          </div>
        )}
      </span>
      <span class="meta">
        <span class="st" title={t.state}>
          {icon ? <I n={icon} /> : <Spinner />}
        </span>
        {t.state === 'review' && t.changes.files > 0 ? (
          <span class="stat">
            <span class="a">+{t.changes.adds}</span>
            <span class="d">−{t.changes.dels}</span>
          </span>
        ) : (
          <span>{ago(t.updatedAt)}</span>
        )}
      </span>
    </button>
  );
}
