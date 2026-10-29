// What you can do to a task, one list for its ⋯ menu, its right-click menu and the command bar.
import { get, toast, openModal, projectOf, taskOf, set } from '../../store.js';
import { vscodeLink, isMac } from '../../util.js';
import { isLive, isBusy } from '../../core/status.js';
import { keyLabel } from '../../app/keys.js';
import { pickLogo } from '../../logos.js';
import { stop, resume, setRemote, archive, archiveAsk, archiveMany, restore, resumeMany, clearPicks, interrupt, toggleDrawer, newTask, openTask } from '../../actions.js';

function copy(text) {
  window.desk.copy(text);
  toast(`복사했어요 · ${text}`, { ms: 2500 });
}

/** Everything you can do to one task. `group` adds "put the whole group away" in the rail. */
export function taskItems(t, { group } = {}) {
  const p = projectOf(get(), t.projectId);
  const live = isLive(t);
  const here = !t.watching && !t.archived;
  return [
    live && here && t.running && isBusy(t) && { icon: 'hand-stop', label: '이번 턴 중단', hint: keyLabel('interrupt'), run: () => interrupt(t.id) },
    live && here && (t.running ? { icon: 'player-stop', label: '세션 중지', run: () => stop(t.id) } : { icon: 'player-play', label: '재개', run: () => resume(t.id) }),
    live && t.watching?.status === 'gone' && { icon: 'player-play', label: '여기서 재개', run: () => resume(t.id) },
    live && here && t.agent === 'claude' && (t.remote ? { icon: 'device-mobile-off', label: '폰 연결 끄기', run: () => setRemote(t.id, false) } : { icon: 'device-mobile', label: '폰(Claude 앱)에서 이어하기', run: () => setRemote(t.id, true) }),
    t.remoteUrl && { icon: 'external-link', label: 'claude.ai에서 이 세션 열기', href: t.remoteUrl },
    '-',
    { icon: 'pencil', label: '이름 바꾸기', run: () => openModal('rename', { taskId: t.id }) },
    live && here && { icon: 'terminal-2', label: '원본 터미널', hint: keyLabel('drawer'), run: () => (openTask(t.id), toggleDrawer('agent')) },
    '-',
    t.worktreeAbs && { icon: 'brand-vscode', label: t.adopted || !t.isolated ? 'VS Code에서 폴더 열기' : 'VS Code에서 worktree 열기', href: vscodeLink(t.worktreeAbs) },
    t.worktreeAbs && { icon: 'folder-open', label: isMac ? 'Finder에서 보기' : '탐색기에서 보기', run: () => window.desk.reveal(t.worktreeAbs) },
    t.prUrl && { icon: 'git-pull-request', label: 'PR 열기', href: t.prUrl },
    t.branch && { icon: 'git-branch', label: '브랜치 이름 복사', run: () => copy(t.branch) },
    t.worktreeAbs && { icon: 'copy', label: '폴더 경로 복사', run: () => copy(t.worktreeAbs) },
    p && { icon: 'settings', label: `${p.name} 설정`, run: () => set({ screen: 'settings', settingsTab: 'projects', settingsProject: p.id }) },
    '-',
    t.archived
      ? live && { icon: 'archive-off', label: '꺼내기', run: () => restore(t.id) }
      : { icon: 'archive', label: live ? '보관' : '보관 · 목록에서 내리기', hint: 'E', run: () => (live ? archiveAsk(t.id) : archive(t.id)) },
    group && group.ids.length > 1 && { icon: 'archive', label: `'${group.title}' ${group.ids.length}개 모두 보관`, run: () => archiveMany(group.ids) },
    live && !t.archived && (t.adopted ? { icon: 'logout', label: 'Desk에서 빼기 (파일은 그대로)', run: () => openModal('discard', { taskId: t.id }) } : { icon: 'trash', label: '버리기…', danger: true, run: () => openModal('discard', { taskId: t.id }) }),
  ];
}

/** Several rows picked with ⌘/Ctrl or Shift: what can be done to all of them at once. */
export function pickedItems(ids) {
  const ts = ids.map((id) => taskOf(get(), id)).filter(Boolean);
  const stopped = ts.filter((t) => !t.running && isLive(t) && !t.watching && !t.archived);
  return [
    { icon: 'archive', label: `${ts.length}개 보관`, hint: 'E', run: () => archiveMany(ts.map((t) => t.id)) },
    stopped.length > 0 && { icon: 'player-play', label: `멈춘 ${stopped.length}개 재개`, run: () => resumeMany(stopped.map((t) => t.id)) },
    '-',
    { icon: 'x', label: '선택 해제', hint: 'Esc', run: clearPicks },
  ];
}

/** A project's glyph in the rail's filter row. */
export function projectItems(p) {
  return [
    { icon: 'plus', label: `${p.name}에 새 작업`, run: () => newTask(p.id) },
    { icon: 'settings', label: `${p.name} 설정`, run: () => set({ screen: 'settings', settingsTab: 'projects', settingsProject: p.id }) },
    { icon: 'photo', label: '로고 바꾸기…', run: () => pickLogo(p.id, { onDone: () => toast('로고를 바꿨어요', { projectId: p.id }), onError: (e) => toast(e.message, { kind: 'err' }) }) },
    p.path && { icon: 'folder-open', label: isMac ? 'Finder에서 보기' : '탐색기에서 보기', run: () => window.desk.reveal(p.path) },
    '-',
    { icon: 'logout', label: 'Desk에서 빼기 (파일은 그대로)', danger: true, run: () => openModal('removeProject', { projectId: p.id }) },
  ];
}

/** A terminal's own menu: its selection isn't the page's, so the browser's copy wouldn't see it. */
export function termItems(term) {
  const sel = term.hasSelection();
  return [
    { icon: 'copy', label: '복사', hint: isMac ? '⌘C' : '', disabled: !sel, run: () => window.desk.copy(term.getSelection()) },
    {
      icon: 'clipboard',
      label: '붙여넣기',
      hint: isMac ? '⌘V' : '',
      run: () => {
        term.focus();
        window.desk.edit('paste');
      },
    },
    '-',
    { icon: 'select-all', label: '모두 선택', run: () => term.selectAll() },
  ];
}
