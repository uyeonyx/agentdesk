import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, get, set, setView, openModal, projectOf, taskOf } from '../store.js';
import { roomVars, ago, mod, undoKey, progressOf, SOURCE_LABEL } from '../util.js';
import { undoBanner, dismissBanner, undoMessage, newTask, archive } from '../actions.js';
import { Glyph, I } from './bits.jsx';
import { TerminalView } from './Terminal.jsx';
import { Composer } from './Composer.jsx';
import { TermBar } from './TermBar.jsx';
import { ProgressPanel } from './Progress.jsx';
import { WatchView, WatchBar } from './Watch.jsx';
import { ShellPane } from './Shell.jsx';
import { Review } from './Review.jsx';
import { Files } from './Files.jsx';
import { AddProjectBody } from './Modals.jsx';
import { MenuItems, taskItems } from './Menu.jsx';

const VIEWS = [
  { key: 'chat', label: '대화', icon: 'terminal-2' },
  { key: 'review', label: '변경', icon: 'git-compare' },
  { key: 'files', label: '파일', icon: 'files' },
];

export function RoomArea() {
  const s = useStore((s) => ({ selected: s.selected, tasks: s.tasks, projects: s.projects, loaded: s.loaded }));
  const task = taskOf(s, s.selected);
  const project = task && projectOf(s, task.projectId);
  if (!s.loaded) return <div class="room-wrap" />;
  if (!s.projects.length) {
    return (
      <div class="room-wrap">
        <div class="room" style={{ ...roomVars('#7D8FA3'), gridTemplateRows: '1fr', borderColor: 'var(--line-strong)' }}>
          <div class="scroll" style="padding:28px 32px;max-width:760px">
            <h2 style="margin:0 0 6px;font-size:22px;letter-spacing:-.02em">에이전트에게 일 시킬 프로젝트를 골라요</h2>
            <p style="color:var(--muted);margin:0 0 18px">프로젝트마다 색과 아이콘이 생겨요. 어디서 무엇을 시키는지 헷갈리지 않게, 이후 모든 화면이 그 색으로 칠해져요.</p>
            <AddProjectBody />
          </div>
        </div>
      </div>
    );
  }
  if (!task || !project || task.archived) return <Lobby />;
  return <Room key="room" task={task} project={project} />;
}

function Lobby() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, filter: s.filter }));
  const projects = s.filter ? s.projects.filter((p) => p.id === s.filter) : s.projects;
  return (
    <div class="room-wrap">
      <div class="room" style={{ gridTemplateRows: '1fr', borderColor: 'var(--line-strong)' }}>
        <div class="scroll" style="padding:28px 32px">
          <h2 style="margin:0 0 4px;font-size:20px;letter-spacing:-.02em">무엇을 시킬까요</h2>
          <p style="color:var(--muted);margin:0 0 18px">
            프로젝트를 골라 새 작업을 시작하거나, 왼쪽에서 작업을 골라요. <kbd>J</kbd> <kbd>K</kbd> 로 이동, <kbd>↵</kbd> 로 입력창.
          </p>
          <button class="btn" style="margin:-4px 0 18px" onClick={() => openModal('import', { projectId: s.filter })}>
            <I n="history" /> 이미 있는 세션 불러오기
          </button>
          <div class="ptiles">
            {projects.map((p) => {
              const live = s.tasks.filter((t) => t.projectId === p.id && !t.archived && !['merged', 'discarded'].includes(t.state)).length;
              return (
                <button key={p.id} class="ptile" style={roomVars(p.color)} onClick={() => newTask(p.id)}>
                  <Glyph project={p} />
                  <span style="min-width:0">
                    <div class="nm">{p.name}</div>
                    <div class="ds">{p.desc || p.display}</div>
                    <div class="ds" style="margin-top:2px">{live ? `진행 중 ${live}개` : '새 작업 시작'}</div>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Room({ task, project }) {
  const view = useStore((s) => s.views[task.id] || (task.state === 'review' ? 'review' : 'chat'));
  const banner = useStore((s) => s.banner);
  const progressOpen = useStore((s) => s.progressOpen);
  const shellOpen = useStore((s) => s.shellOpen);
  const shellH = useStore((s) => s.shellH);
  const allProjects = useStore((s) => s.projects);
  const [sweep, setSweep] = useState(0);
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState(false);
  const prevProject = useRef(project.id);

  useEffect(() => {
    if (prevProject.current !== project.id) setSweep((n) => n + 1);
    prevProject.current = project.id;
    setHistory(false);
    setMenu(false);
  }, [task.id]);

  const hasChanges = task.changes.files > 0;
  const live = !['merged', 'discarded'].includes(task.state);
  const showBanner = banner && banner.taskId === task.id;
  const bannerProject = showBanner ? project : null;
  const pr = progressOf(task);
  const progressCount = pr.running || (pr.total ? `${pr.done}/${pr.total}` : 0);

  return (
    <div class="room-wrap" style={roomVars(project.color)}>
      <section class={`room ${project.careful ? 'careful' : ''}`} aria-label={`${project.name} 작업 공간`}>
        {sweep > 0 && <div key={`c${sweep}`} class="room-cue go" />}
        <header key={`h${sweep}`} class={`room-h ${sweep ? 'cued' : ''}`}>
          <button class="btn ghost icon back" onClick={() => set({ selected: null })} aria-label="목록으로">
            <I n="arrow-left" />
          </button>
          <Glyph project={project} />
          <div class="room-id">
            <div class="room-name">
              <h1>{project.name}</h1>
              {project.careful && (
                <span class="careful-badge" title={`신중 모드: ${mod}↵ 로만 보내져요`}>
                  <I n="shield-lock" /> 신중
                </span>
              )}
              <span class="desc">{project.desc}</span>
            </div>
            <div class="room-sub">
              <span class="title" title={task.title}>
                {task.title}
              </span>
              {task.multi ? (
                <span class="repos" title="이 작업이 함께 고치는 저장소들">
                  {task.repos.map((r) => {
                    const rp = allProjects.find((p) => p.id === r.projectId);
                    return (
                      <span key={r.prefix} class="repo" style={roomVars(rp?.color || project.color)}>
                        <i />
                        {r.name}
                      </span>
                    );
                  })}
                  <span class="branch">
                    <I n="git-branch" />
                    {task.branch}
                  </span>
                </span>
              ) : (
                task.branch && (
                  <span class="branch">
                    <I n="git-branch" />
                    {task.branch}
                  </span>
                )
              )}
              {task.watching && (
                <span class="branch watching" title="이 세션은 다른 곳에서 돌고 있고, Desk는 대화 기록을 실시간으로 따라 읽어요">
                  <I n="eye" /> {task.watching.where} 세션 보는 중
                </span>
              )}
              {task.adopted && !task.watching && (
                <span class="branch" title={`불러온 세션이라 새 worktree 없이 ${task.worktree}에서 바로 작업해요`}>
                  <I n="folder-open" /> 원래 폴더
                </span>
              )}
              <span class="agent">
                <I n={task.agent === 'codex' ? 'brand-openai' : 'sparkles'} />
                {task.agent === 'codex' ? 'Codex' : 'Claude Code'}
              </span>
            </div>
          </div>
          <div class="seg" role="tablist" aria-label="보기">
            {VIEWS.map((v, i) => (
              <button key={v.key} class={view === v.key ? 'on' : ''} onClick={() => setView(task.id, v.key)} role="tab" aria-selected={view === v.key} title={`${v.label} (⌥${i + 1})`}>
                <I n={v.icon} />
                {v.label}
                {v.key === 'review' && hasChanges && <span class="badge">{task.changes.files}</span>}
              </button>
            ))}
          </div>
          <div class="room-actions">
            {live && task.isolated && !task.adopted && hasChanges && (
              <>
                <button class="btn primary sm" onClick={() => openModal('merge', { taskId: task.id })} title="메인 브랜치에 머지">
                  <I n="git-merge" /> 머지
                </button>
                <button class="btn sm" onClick={() => openModal('pr', { taskId: task.id })} title="PR 만들기">
                  <I n="git-pull-request" /> PR
                </button>
              </>
            )}
            {task.prUrl && (
              <a class="btn ghost sm" href={task.prUrl} target="_blank" rel="noopener noreferrer">
                <I n="external-link" /> PR 열기
              </a>
            )}
            <button class={`btn ghost sm icon ${shellOpen ? 'on' : ''}`} onClick={() => set({ shellOpen: !shellOpen })} title="셸: 이 작업 폴더에서 직접 명령어 실행 (⌃`)" aria-pressed={shellOpen} aria-label="셸">
              <I n="terminal" />
            </button>
            <button class={`btn ghost sm progress-toggle ${progressOpen ? 'on' : ''}`} onClick={() => set({ progressOpen: !progressOpen })} title="진척: 할 일, 서브에이전트, 도구 사용" aria-pressed={progressOpen}>
              <I n="list-check" />
              {progressCount ? <span class="pc">{progressCount}</span> : null}
            </button>
            <button class={`btn ghost sm icon ${history ? 'on' : ''}`} onClick={() => setHistory((h) => !h)} title="보낸 지시 기록" aria-label="기록">
              <I n="history" />
            </button>
            <div class="rel">
              <button class="btn ghost sm icon" onClick={() => setMenu((m) => !m)} aria-label="더보기" aria-expanded={menu}>
                <I n="dots" />
              </button>
              {menu && <RoomMenu task={task} close={() => setMenu(false)} />}
            </div>
          </div>
        </header>

        <div class={`room-main ${progressOpen ? 'with-progress' : ''}`}>
          <div class="room-stage">
            <div class="stage-main">
              {task.watching ? <WatchView task={task} visible={view === 'chat'} /> : <TerminalView task={task} project={project} visible={view === 'chat'} />}
              {view === 'review' && <Review task={task} project={project} />}
              {view === 'files' && <Files task={task} project={project} />}
              {history && <History task={task} close={() => setHistory(false)} />}
            </div>
            {shellOpen && live && (
              <>
                <ShellResizer />
                <ShellPane key={task.id} task={task} height={shellH} />
              </>
            )}
          </div>
          {progressOpen && <ProgressPanel task={task} />}
        </div>

        {live ? (
          <div class="room-foot">
            {task.watching ? (
              <WatchBar task={task} project={project} />
            ) : (
              <>
                {/* The send confirmation takes the strip's place instead of covering the terminal. */}
                {showBanner ? <Banner banner={banner} project={bannerProject} inline /> : <TermBar task={task} project={project} />}
                <Composer key={task.id} task={task} project={project} />
              </>
            )}
          </div>
        ) : (
          <div class="composer" style="display:flex;align-items:center;gap:10px;color:var(--muted)">
            <I n={task.state === 'merged' ? 'git-merge' : 'trash'} />
            <span style="flex:1">{task.reason}</span>
            {!task.archived && (
              <button class="btn sm" onClick={() => archive(task.id)}>
                <I n="archive" /> 목록에서 치우기
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/** Drag to resize the shell under the agent's terminal. */
function ShellResizer() {
  const start = (e) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = Number(get().shellH) || 260;
    const move = (ev) => set({ shellH: Math.max(120, Math.min(window.innerHeight * 0.75, h0 - (ev.clientY - y0))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div class="shell-resizer" onPointerDown={start} role="separator" aria-orientation="horizontal" aria-label="셸 크기 조절" />;
}

export function Banner({ banner, project, floating, inline }) {
  const short = banner.text.split('\n')[0];
  return (
    <div class={`banner ${floating ? 'floating' : ''} ${inline ? 'inline' : ''}`} role="status" style={floating ? roomVars(project.color) : undefined}>
      <Glyph project={project} />
      <div class="txt">
        <b>{project.name}</b>
        {banner.kind === 'create' ? '에서 새 작업을 시작했어요' : '에 보냈어요'}
        <span class="q">“{short}”</span>
      </div>
      <button class="undo" onClick={undoBanner} title={banner.kind === 'create' ? '작업 취소' : '되돌리기: 에이전트를 멈추고 파일을 보내기 전으로'}>
        <I n="arrow-back-up" /> {banner.kind === 'create' ? '취소' : '되돌리기'} <kbd>{undoKey}</kbd>
      </button>
      <span class="bar" style={{ animationDuration: banner.ms + 'ms' }} />
    </div>
  );
}

function RoomMenu({ task, close }) {
  useEffect(() => {
    const h = (e) => !e.target.closest?.('.menu') && close();
    setTimeout(() => window.addEventListener('mousedown', h), 0);
    return () => window.removeEventListener('mousedown', h);
  }, []);
  return (
    <div class="menu" role="menu">
      <MenuItems items={taskItems(task)} close={close} />
    </div>
  );
}

function History({ task, close }) {
  const msgs = [...task.messages].reverse();
  return (
    <div class="history" role="dialog" aria-label="보낸 지시">
      <div class="hh">
        보낸 지시 <span class="sp" />
        <button class="btn ghost sm icon" onClick={close} aria-label="닫기">
          <I n="x" />
        </button>
      </div>
      <div class="scroll" style="flex:1">
        {msgs.map((m, i) => (
          <div class={`it ${m.undone ? 'undone' : ''}`} key={m.id}>
            <div>
              <p>{m.text}</p>
              <small>
                <span class={`src ${m.source || ''}`}>{SOURCE_LABEL[m.source] || (i === msgs.length - 1 ? '처음 지시' : '')}</span>
                {ago(m.at)} 전{m.undone ? ' · 되돌림' : ''}
              </small>
            </div>
            {m.canUndo && (
              <button class="btn sm" onClick={() => undoMessage(task.id, m.id)} title="이 지시를 보내기 직전 상태로 파일을 되돌려요">
                <I n="arrow-back-up" /> 이 전으로
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export { dismissBanner };
