// Nothing open: a launch pad. Say what to do and where; or pick up what's waiting.
import { useStore, set, openModal } from '../store.js';
import { isBlocked } from '../core/status.js';
import { openCommand, startTriage, newTask } from '../actions.js';
import { AddProjectBody } from '../features/sheets/Sheets.jsx';
import { Glyph, I } from '../ui/bits.jsx';
import { keyLabel } from './keys.js';

export function Home() {
  const s = useStore((s) => ({ projects: s.projects, tasks: s.tasks, loaded: s.loaded }));
  if (!s.loaded) return <div class="home" />;
  if (!s.projects.length)
    return (
      <div class="home">
        <div class="home-c">
          <div class="home-mark" aria-hidden="true">
            <i />
          </div>
          <h1>프로젝트부터 추가해 주세요</h1>
          <p class="muted">git 저장소를 고르면 작업마다 별도 worktree에서 에이전트가 일해요. 서로 부딪히지 않아요.</p>
          <div class="home-add glass-2">
            <AddProjectBody />
          </div>
        </div>
      </div>
    );
  const live = s.tasks.filter((t) => !t.archived);
  const yours = live.filter((t) => t.state === 'needs_input' || t.state === 'review');
  const blocked = live.filter(isBlocked);
  const recent = [...s.projects].sort((a, b) => lastUsed(s.tasks, b.id) - lastUsed(s.tasks, a.id)).slice(0, 6);
  return (
    <div class="home">
      <div class="home-c">
        <div class="home-mark" aria-hidden="true">
          <i />
        </div>
        <h1>무엇을 시킬까요?</h1>
        <button class="home-ask glass-2 lens" data-sheen onClick={() => openCommand('new')}>
          <I n="sparkles" />
          <span>에이전트에게 맡길 일을 적어 주세요</span>
          <kbd>{keyLabel('new') || 'N'}</kbd>
        </button>
        {yours.length > 0 && (
          <button class={`home-yours ${blocked.length ? 'hot' : ''}`} onClick={startTriage}>
            <span class="dot" />
            {blocked.length ? `${blocked.length}개가 허락이나 선택을 기다려요` : `내 차례 ${yours.length}개`}
            <span class="muted">· 차례로 처리</span> <kbd>Space</kbd>
          </button>
        )}
        <div class="home-projects">
          {recent.map((p) => (
            <button key={p.id} class="hp glass" data-sheen onClick={() => newTask(p.id)}>
              <Glyph project={p} size={30} />
              <span class="hp-m">
                <b>{p.name}</b>
                <small>{p.desc || p.display}</small>
              </span>
              <I n="plus" class="hp-plus" />
            </button>
          ))}
          <button class="hp ghost" onClick={() => openModal('import', {})}>
            <I n="history" />
            <span class="hp-m">
              <b>세션 불러오기</b>
              <small>다른 터미널이나 지난 대화</small>
            </span>
          </button>
        </div>
      </div>
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
      </div>
    </div>
  );
}
