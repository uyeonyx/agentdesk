// Nothing open: a launch pad. Say what to do and where; pick up what's waiting; every project with
// its own mark and what's going on in it.
import { useStore, set, openModal } from '../store.js';
import { isBlocked, tagOf, compareTasks, groupOf } from '../core/status.js';
import { openCommand, startTriage, newTask, select } from '../actions.js';
import { AddProjectBody } from '../features/sheets/Sheets.jsx';
import { openMenu } from '../ui/Menu.jsx';
import { projectItems } from '../features/task/taskActions.js';
import { Glyph, I, TimeAgo, roomVars } from '../ui/bits.jsx';
import { keyLabel } from './keys.js';
import { isMac } from '../util.js';

export function Home() {
  const s = useStore((s) => ({ projects: s.projects, tasks: s.tasks, loaded: s.loaded, filter: s.filter }));
  if (!s.loaded) return <div class="home" />;
  if (!s.projects.length)
    return (
      <div class="home">
        <div class="home-c narrow">
          <h1>프로젝트부터 추가해 주세요</h1>
          <p class="muted">git 저장소를 고르면 작업마다 별도 worktree에서 에이전트가 일해요. 서로 부딪히지 않아요.</p>
          <div class="home-add glass-2">
            <AddProjectBody />
          </div>
        </div>
      </div>
    );
  const live = s.tasks.filter((t) => !t.archived);
  const yours = live.filter((t) => t.state === 'needs_input' || t.state === 'review').sort(compareTasks);
  const blocked = yours.filter(isBlocked);
  const projects = [...s.projects].sort((a, b) => lastUsed(s.tasks, b.id) - lastUsed(s.tasks, a.id));
  const nameOf = (id) => s.projects.find((p) => p.id === id);
  return (
    <div class="home">
      <div class="home-c">
        <button class="home-ask" onClick={() => openCommand('new')}>
          <I n="plus" />
          <span>에이전트에게 맡길 일</span>
          <kbd>{keyLabel('new') || 'N'}</kbd>
        </button>
        {yours.length > 0 && (
          <section class={`home-turn ${blocked.length ? 'hot' : ''}`} aria-label="내 차례">
            <header>
              <h2>
                내 차례 <span class={`badge ${blocked.length ? 'warn' : 'info'} num`}>{yours.length}</span>
              </h2>
              <span class="dim">{blocked.length ? `${blocked.length}개가 허락이나 선택을 기다려요` : '답장하거나 검토할 작업이에요'}</span>
              <span class="sp" />
              <button class={`btn sm ${blocked.length ? 'warn' : 'primary'}`} onClick={startTriage}>
                차례로 처리 <kbd>Space</kbd>
              </button>
            </header>
            <div class="ht-list">
              {yours.slice(0, 5).map((t) => {
                const tag = tagOf(t);
                const p = nameOf(t.projectId);
                return (
                  <button key={t.id} class="ht-row" onClick={() => select(t.id)}>
                    <Glyph project={p} size={22} />
                    {tag && <span class={`tag ${tag.tone} ${tag.solid ? 'solid' : ''}`}>{tag.label}</span>}
                    <span class="ht-t">{t.title}</span>
                    <span class="ht-p">{p?.name}</span>
                  </button>
                );
              })}
              {yours.length > 5 && <span class="ht-more dim">외 {yours.length - 5}개</span>}
            </div>
          </section>
        )}
        <section class="home-sec" aria-label="프로젝트">
          <header>
            <h2>프로젝트</h2>
            <span class="sp" />
            <button class="btn sm ghost" onClick={() => openModal('import', {})}>
              <I n="history" /> 세션 불러오기
            </button>
            <button class="btn sm ghost" onClick={() => openModal('addProject')}>
              <I n="folder-plus" /> 프로젝트 추가
            </button>
          </header>
          <div class="pcards">
            {projects.map((p) => (
              <ProjectCard key={p.id} p={p} tasks={live.filter((t) => t.projectId === p.id)} on={s.filter === p.id} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** A project at a glance: its mark, what it is, what's waiting and running in it. Click to show only it. */
function ProjectCard({ p, tasks, on }) {
  const waiting = tasks.filter(isBlocked).length;
  const yours = tasks.filter((t) => t.state === 'needs_input' && !isBlocked(t)).length;
  const review = tasks.filter((t) => t.state === 'review').length;
  const busy = tasks.filter((t) => groupOf(t) === 'working').length;
  const last = Math.max(0, ...tasks.map((t) => t.updatedAt));
  return (
    <div class={`pcard room-scope ${on ? 'on' : ''}`} style={roomVars(p.color)} onContextMenu={(e) => openMenu(e, projectItems(p))}>
      <button class="pc-main" onClick={() => set({ filter: on ? null : p.id })} aria-pressed={on} data-tip={on ? '모든 프로젝트 보기' : '목록에 이 프로젝트만 보기'}>
        <Glyph project={p} size={44} />
        <b class="pc-name">{p.name}</b>
        <small class="pc-desc">{p.desc || p.display}</small>
        <span class="pc-st">
          {waiting > 0 && <span class="tag warn solid">기다림 {waiting}</span>}
          {yours > 0 && <span class="tag info">답장 {yours}</span>}
          {review > 0 && <span class="tag ok">검토 {review}</span>}
          {busy > 0 && (
            <span class="pc-busy">
              <span class="spin xs" /> 작업 중 {busy}
            </span>
          )}
          {!waiting && !yours && !review && !busy && <span class="dim">{last ? <>마지막 작업 · <TimeAgo at={last} /></> : '아직 작업이 없어요'}</span>}
        </span>
      </button>
      <button class="ibtn sm pc-new" onClick={() => newTask(p.id)} data-tip={`${p.name}에 새 작업`} aria-label={`${p.name}에 새 작업`}>
        <I n="plus" />
      </button>
    </div>
  );
}

const lastUsed = (tasks, pid) => Math.max(0, ...tasks.filter((t) => t.projectId === pid).map((t) => t.updatedAt));

/** "?": every shortcut, from the same table that runs them. */
export function CheatSheet({ keys }) {
  const groups = [...new Set(keys.map((k) => k.group))];
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && set({ cheat: false })}>
      <div class="sheet glass-3 wide cheat" role="dialog" aria-label="단축키">
        <div class="sheet-h">
          <h2>단축키</h2>
          <span class="sp" style="flex:1" />
          <button class="ibtn" onClick={() => set({ cheat: false })} aria-label="닫기">
            <I n="x" />
          </button>
        </div>
        <div class="sheet-b cheat-grid">
          {groups.map((g) => (
            <div key={g} class="cg">
              <h4>{g}</h4>
              {keys
                .filter((k) => k.group === g && k.label)
                .map((k) => (
                  <div key={k.id} class="kl">
                    <span>{k.label}</span>
                    <kbd>{keyLabel(k.id)}</kbd>
                  </div>
                ))}
            </div>
          ))}
        </div>
        {!isMac && <p class="cheat-note dim">터미널 안에서는 Ctrl 단축키를 Shift와 함께 눌러요. Ctrl만 누르면 터미널로 가요.</p>}
      </div>
    </div>
  );
}
