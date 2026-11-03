// The window's title bar is the app's own: where I am on the left, the command bar in the middle,
// what's waiting on me on the right. Drag anywhere that isn't a control.
import { useStore, set, projectOf, taskOf } from '../store.js';
import { isBlocked } from '../core/status.js';
import { startTriage, openCommand } from '../actions.js';
import { updateAction } from '../api.js';
import { Glyph, I } from '../ui/bits.jsx';
import { keyLabel } from './keys.js';
import { isMac } from '../util.js';
import { UsageChip } from '../features/usage/Usage.jsx';

export function Titlebar() {
  const s = useStore((s) => ({ screen: s.screen, selected: s.selected, tasks: s.tasks, projects: s.projects, filter: s.filter, connected: s.connected, loaded: s.loaded, update: s.update, triage: s.triage }));
  const task = s.screen === 'task' ? taskOf(s, s.selected) : null;
  const project = task ? projectOf(s, task.projectId) : s.filter ? projectOf(s, s.filter) : null;
  const live = s.tasks.filter((t) => !t.archived);
  const blocked = live.filter(isBlocked).length;
  const yours = live.filter((t) => t.state === 'needs_input' || t.state === 'review').length;
  return (
    <header class="titlebar" data-testid="titlebar">
      <div class="tb-left">
        <div class="seg viewsw" role="group" aria-label="보기">
          <button aria-pressed={s.screen === 'overview'} onClick={() => set({ screen: 'overview' })} data-tip="모든 세션을 한눈에" data-kbd={keyLabel('overview')} data-testid="view-overview">
            <I n="layout-grid" />
            관제
          </button>
          <button aria-pressed={s.screen === 'task'} onClick={() => set({ screen: 'task' })} data-tip="세션 하나를 자세히" data-kbd={keyLabel('overview')} data-testid="view-focus">
            <I n="layout-sidebar" />
            집중
          </button>
        </div>
        <nav class="crumbs" aria-label="지금 위치">
          {s.screen === 'overview' ? (
            <span>
              세션 <span class="num">{live.filter((t) => !['merged', 'discarded'].includes(t.state)).length}</span>개
            </span>
          ) : s.screen === 'settings' ? (
            <b>설정</b>
          ) : project ? (
            <>
              <Glyph project={project} size={18} />
              <span class="cr-p">{project.name}</span>
              {task && (
                <>
                  <I n="chevron-right" class="cr-sep" />
                  <span class="cr-t">{task.title}</span>
                </>
              )}
            </>
          ) : (
            <b>Desk</b>
          )}
        </nav>
      </div>
      <button class="cmdpill" onClick={() => openCommand('all')} data-tip="찾기·명령·새 작업" data-kbd={keyLabel('command')}>
        <I n="search" />
        <span>찾거나 새 작업 시작…</span>
        <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <div class="tb-right">
        {s.loaded && !s.connected && (
          <span class="conn" role="status">
            <span class="spin" /> 다시 연결하는 중
          </span>
        )}
        <UpdatePill u={s.update} />
        <UsageChip />
        {yours > 0 && (
          <button class={`turnpill ${blocked ? 'hot' : ''} ${s.triage ? 'on' : ''}`} onClick={startTriage} data-tip={blocked ? `${blocked}개가 허락이나 선택을 기다려요 · 차례로 처리` : '차례로 처리'} data-kbd={keyLabel('triage')} data-testid="yours">
            내 차례 <b class="num">{yours}</b>
          </button>
        )}
        <button class={`ibtn ${s.screen === 'settings' ? 'on' : ''}`} onClick={() => set({ screen: s.screen === 'settings' ? 'task' : 'settings' })} data-tip="설정" data-kbd={keyLabel('settings')} aria-label="설정">
          <I n="settings" />
        </button>
      </div>
    </header>
  );
}

function UpdatePill({ u }) {
  if (!u || u.state === 'none' || u.state === 'checking') return null;
  if (u.state === 'available')
    return (
      <button class="upd ok" onClick={() => updateAction('download')} data-tip={u.notes || '새 버전을 받아요'}>
        <I n="download" /> 새 버전 {u.version}
      </button>
    );
  if (u.state === 'downloading')
    return (
      <span class="upd" role="status">
        <span class="spin" /> 받는 중 <span class="num">{u.progress}%</span>
      </span>
    );
  if (u.state === 'ready')
    return u.pending ? (
      <span class="upd" data-tip="종료하면 새 버전으로 바뀌고, 다음에 열 때 새 버전이 떠요">
        <I n="clock" /> 종료할 때 {u.version} 적용
      </span>
    ) : (
      <button class="upd ok" onClick={() => updateAction('apply')} data-tip="종료할 때도 자동으로 적용돼요">
        <I n="refresh" /> 다시 시작해 {u.version} 적용
      </button>
    );
  if (u.state === 'manual')
    return (
      <button class="upd" onClick={() => updateAction('page')} data-tip="이 위치에서는 앱이 스스로 바꿀 수 없어요. Applications 폴더로 옮기면 다음부터는 버튼 한 번으로 돼요">
        <I n="external-link" /> 새 버전 {u.version} 받기
      </button>
    );
  return (
    <button class="upd" onClick={() => updateAction('check')} data-tip={u.message}>
      <I n="alert-triangle" /> 업데이트 다시 시도
    </button>
  );
}
