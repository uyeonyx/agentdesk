// One task: its conversation (or its changes, or its files), and at the bottom what it's doing
// now, what it waits on, and where I answer.
import { useEffect, useState } from 'preact/hooks';
import { useStore, set, setView, openModal } from '../../store.js';
import { isLive, isBusy, isBlocked, labelOf, markOf } from '../../core/status.js';
import { duration } from '../../core/turns.js';
import { interrupt, resume, toggleDrawer, openDrawer, rename, setRemote } from '../../actions.js';
import { api } from '../../api.js';
import { toast } from '../../store.js';
import { Conversation } from '../conversation/Conversation.jsx';
import { PromptCard } from '../prompt/PromptCard.jsx';
import { Composer } from '../composer/Composer.jsx';
import { Review } from '../review/Review.jsx';
import { Files } from '../files/Files.jsx';
import { Drawer } from '../terminal/Drawer.jsx';
import { TriageBar } from '../triage/TriageBar.jsx';
import { openMenuAt } from '../../ui/Menu.jsx';
import { I, Spinner, roomVars, useNow } from '../../ui/bits.jsx';
import { keyLabel } from '../../app/keys.js';
import { taskItems } from './taskActions.js';

const TABS = [
  { key: 'chat', label: '대화', icon: 'messages' },
  { key: 'review', label: '변경', icon: 'git-compare' },
  { key: 'files', label: '파일', icon: 'files' },
];

export function TaskView({ task, project }) {
  const s = useStore((s) => ({ view: s.views[task.id], drawer: s.drawer, triage: s.triage }));
  const view = s.view || 'chat';
  const blocked = isBlocked(task);
  const dock = (
    <div class="dock">
      <StatusLine task={task} />
      {blocked && task.prompt && <PromptCard task={task} project={project} focus />}
      {blocked && !task.prompt && <TerminalNeeded task={task} />}
      {task.watching ? <WatchBar task={task} project={project} /> : isLive(task) ? <Composer task={task} project={project} blocked={blocked} /> : <Finished task={task} />}
    </div>
  );
  return (
    <section class="task room-scope" style={roomVars(project?.color)} data-testid="task" data-task-id={task.id} data-state={blocked ? 'blocked' : task.state}>
      <Header task={task} project={project} view={view} />
      {s.triage && !s.triage.done && <TriageBar />}
      <div class="task-body">
        {view === 'chat' && <Conversation task={task} project={project} dock={dock} />}
        {view === 'review' && <Review task={task} project={project} />}
        {view === 'files' && <Files task={task} project={project} />}
      </div>
      {s.drawer.open && <Drawer task={task} project={project} />}
    </section>
  );
}

function Header({ task, project, view }) {
  const [editing, setEditing] = useState(false);
  const canMerge = task.isolated && !task.adopted && task.changes?.files > 0 && isLive(task);
  const menuBtn = (e) => openMenuAt(e.currentTarget, taskItems(task));
  return (
    <header class="th">
      <div class="th-id">
        {editing ? (
          <input
            class="th-title-in"
            autofocus
            defaultValue={task.title}
            onBlur={(e) => {
              setEditing(false);
              if (e.currentTarget.value.trim() !== task.title) rename(task.id, e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              if (e.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                e.currentTarget.value = task.title;
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <h1 class="th-title" onDblClick={() => setEditing(true)} data-tip="두 번 눌러 이름 바꾸기">
            {task.title}
          </h1>
        )}
        <div class="th-meta">
          <span class={`state-pill ${markOf(task)}`}>
            <span class="d" />
            {labelOf(task)}
          </span>
          {task.branch && (
            <span class="meta-i mono" data-tip={task.worktree}>
              <I n="git-branch" /> {task.branch}
            </span>
          )}
          {task.multi && (
            <span class="meta-i" data-tip={task.repos.map((r) => r.name).join(', ')}>
              저장소 {task.repos.length}개
            </span>
          )}
          {!task.isolated && (
            <span class="meta-i" data-tip="worktree 없이 원래 폴더에서 일해요">
              원래 폴더
            </span>
          )}
          <span class="meta-i">{task.agent === 'codex' ? 'Codex' : 'Claude Code'}</span>
          {project?.careful && (
            <span class="meta-i warn" data-tip="신중 모드 · 보내기와 허락은 ⌘와 함께 눌러요">
              <I n="shield-lock" /> 신중
            </span>
          )}
          {task.remote && (
            <button class="meta-i" onClick={() => setRemote(task.id, false)} data-tip={task.remoteUrl ? '폰과 연결됨 · 누르면 끊어요' : '폰 연결 준비 중'}>
              <I n="device-mobile" /> {task.remoteUrl ? '폰 연결됨' : '폰 연결 중'}
            </button>
          )}
        </div>
      </div>
      <div class="seg tabs" role="tablist" aria-label="보기">
        {TABS.map((t, i) => (
          <button key={t.key} role="tab" aria-selected={view === t.key} onClick={() => setView(task.id, t.key)} data-tip={t.label} data-kbd={keyLabel(`tab${i + 1}`)}>
            <I n={t.icon} />
            {t.label}
            {t.key === 'review' && task.changes?.files > 0 && <span class="n num">{task.changes.files}</span>}
          </button>
        ))}
      </div>
      <div class="th-act">
        {canMerge && (
          <>
            <button class="btn sm" onClick={() => openModal('pr', { taskId: task.id })}>
              <I n="git-pull-request" /> PR
            </button>
            <button class="btn sm primary" onClick={() => openModal('merge', { taskId: task.id })}>
              <I n="git-merge" /> 머지
            </button>
          </>
        )}
        {task.prUrl && (
          <a class="btn sm ghost" href={task.prUrl} target="_blank" rel="noopener noreferrer">
            <I n="external-link" /> PR
          </a>
        )}
        <button class="ibtn" onClick={() => toggleDrawer('agent')} data-tip="원본 터미널" data-kbd={keyLabel('drawer')} aria-label="원본 터미널">
          <I n="terminal-2" />
        </button>
        <button class="ibtn" onClick={menuBtn} data-tip="더 보기" aria-label="더 보기">
          <I n="dots" />
        </button>
      </div>
    </header>
  );
}

/** What the agent is doing right now, with a way to stop the turn. */
function StatusLine({ task }) {
  const now = useNow();
  if (!task.running || !isBusy(task)) return null;
  const waiting = task.state === 'waiting';
  const since = task.activity?.since || task.updatedAt;
  const what = waiting ? task.reason || '백그라운드 작업을 기다려요' : task.activity?.current || (task.state === 'starting' ? '시작하는 중' : '생각하는 중');
  return (
    <div class={`statusline glass ${waiting ? 'waiting' : ''}`} role="status" aria-live="polite">
      <span class="breath" aria-hidden="true" />
      <span class="what">{what}</span>
      {!waiting && <span class="num el">{duration(now - since)}</span>}
      <span class="sp" />
      <button class="btn sm ghost" onClick={() => interrupt(task.id)} data-tip="이번 턴만 멈춰요 · 세션은 그대로" data-kbd={keyLabel('interrupt')}>
        <I n="hand-stop" /> 중단
      </button>
    </div>
  );
}

function TerminalNeeded({ task }) {
  // Only the CLI's own terminal can answer this one: open it right away, once.
  useEffect(() => {
    if (task.ask === 'terminal') openDrawer('agent', task.id);
  }, [task.id, task.ask === 'terminal']);
  return (
    <div class="pcard glass-2" role="region" aria-label="터미널에서 답하기">
      <div class="pc-h">
        <span class="pc-ic">
          <I n="terminal-2" />
        </span>
        <span class="pc-title">{task.reason || '터미널에서 답해야 해요'}</span>
      </div>
      <div class="pc-f">
        <button class="btn sm primary" onClick={() => toggleDrawer('agent')}>
          <I n="terminal-2" /> 원본 터미널 열기 <kbd>{keyLabel('drawer')}</kbd>
        </button>
      </div>
    </div>
  );
}

function Finished({ task }) {
  return (
    <div class="finished glass">
      <I n={task.state === 'merged' ? 'git-merge' : 'trash'} />
      <span>{task.state === 'merged' ? `${task.mergedInto || '메인'}에 머지했어요` : '버린 작업이에요'}</span>
    </div>
  );
}

/** A session running somewhere else (VS Code, another terminal): followed here, answered there. */
function WatchBar({ task, project }) {
  const w = task.watching;
  const [v, setV] = useState('');
  const fork = async () => {
    try {
      const t = await api('POST', `/api/tasks/${task.id}/fork`);
      set({ selected: t.id });
      toast(`${project.name} · 복사본으로 분기했어요 · 원래 세션은 그대로예요`, { projectId: project.id, ms: 6000 });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  };
  const queue = async () => {
    if (!v.trim()) return;
    try {
      await api('POST', `/api/tasks/${task.id}/send`, { text: v.trim() });
      setV('');
      toast('Codex 세션 대기열에 넣었어요', { projectId: project.id });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  };
  const status = { busy: '작업 중', waiting: '선택을 기다림', idle: '다음 지시를 기다림', gone: '닫힘' }[w.status] || '작업 중';
  return (
    <div class="watchbar glass-2">
      <span class={`wst ${w.status || 'busy'}`}>
        <span class="d" /> {w.where}에서 {status}
      </span>
      {w.canSend && w.status !== 'gone' && (
        <input class="field" value={v} placeholder="Codex 세션에 보낼 말 (codex queue)" onInput={(e) => setV(e.currentTarget.value)} onKeyDown={(e) => !e.isComposing && e.keyCode !== 229 && e.key === 'Enter' && queue()} />
      )}
      <span class="sp" />
      {w.status === 'gone' ? (
        <button class="btn sm primary" onClick={() => resume(task.id)}>
          <I n="player-play" /> 여기서 재개
        </button>
      ) : (
        task.agent === 'claude' && (
          <label class="chk" data-tip={`${w.where}에서 세션을 닫는 순간, 같은 대화를 여기서 이어받아요`}>
            <input type="checkbox" checked={w.autoTakeover} onChange={(e) => api('POST', `/api/tasks/${task.id}/watch`, { autoTakeover: e.currentTarget.checked }).catch((er) => toast(er.message, { kind: 'err' }))} /> 닫히면 여기서 이어받기
          </label>
        )
      )}
      {task.remoteUrl && (
        <a class="btn sm" href={task.remoteUrl} target="_blank" rel="noopener noreferrer">
          <I n="external-link" /> claude.ai에서 조작
        </a>
      )}
      <button class="btn sm" onClick={fork} data-tip="원래 세션은 그대로 두고, 같은 대화의 복사본을 여기서 열어요">
        <I n="git-fork" /> 복사본으로 분기
      </button>
    </div>
  );
}
