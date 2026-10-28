// Right-click menus. The room's ⋯ menu and a task's right-click menu share one list of actions.
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useStore, get, set, toast, openModal, projectOf, taskOf } from '../store.js';
import { vscodeLink, isMac, isLive } from '../util.js';
import { stop, resume, setRemote, archive, archiveAsk, archiveMany, restore, resumeMany, clearPicks } from '../actions.js';
import { I } from './bits.jsx';

/**
 * Items: { icon, label, run | href, hint?, danger?, disabled? }, '-' for a separator; falsy ones
 * are skipped so lists can be written with conditions inline.
 */
export function openMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  const list = tidy(items);
  if (list.length) set({ ctx: { x: e.clientX, y: e.clientY, items: list } });
}

export const closeMenu = () => get().ctx && set({ ctx: null });

function tidy(items) {
  const out = [];
  for (const it of items) {
    if (!it) continue;
    if (it === '-') {
      if (out.length && out[out.length - 1] !== '-') out.push(it);
    } else out.push(it);
  }
  while (out[out.length - 1] === '-') out.pop();
  return out;
}

export function MenuItems({ items, close }) {
  return tidy(items).map((it, i) =>
    it === '-' ? (
      <hr key={`-${i}`} />
    ) : (
      <button
        key={it.label}
        class={`li ${it.danger ? 'danger' : ''}`}
        role="menuitem"
        disabled={it.disabled}
        onClick={() => {
          close();
          if (it.href) window.open(it.href, '_blank', 'noopener');
          else it.run();
        }}
      >
        <I n={it.icon || 'point'} />
        <span class="m">{it.label}</span>
        {it.hint ? <kbd>{it.hint}</kbd> : <span />}
      </button>
    )
  );
}

/** The one open right-click menu, wherever it was asked for. */
export function ContextMenu() {
  const m = useStore((s) => s.ctx);
  const box = useRef();

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !m) return;
    // Keep it on screen: past the right edge it moves left, past the bottom it opens upward.
    const r = el.getBoundingClientRect();
    const x = m.x + r.width > innerWidth - 6 ? Math.max(6, innerWidth - r.width - 6) : m.x;
    const y = m.y + r.height > innerHeight - 6 ? Math.max(6, m.y - r.height) : m.y;
    Object.assign(el.style, { left: `${x}px`, top: `${y}px`, visibility: 'visible' });
    el.focus();
  }, [m]);

  // Listening starts with the first paint: an Esc pressed the moment the menu shows must close it.
  useLayoutEffect(() => {
    if (!m) return;
    const outside = (e) => !box.current?.contains(e.target) && closeMenu();
    const key = (e) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const all = [...box.current.querySelectorAll('.li:not([disabled])')];
        const i = all.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? all[(i + 1) % all.length] : all[(i <= 0 ? all.length : i) - 1];
        next?.focus();
      }
    };
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('wheel', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => {
      window.removeEventListener('mousedown', outside, true);
      window.removeEventListener('wheel', outside, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [m]);

  if (!m) return null;
  return (
    <div class="menu ctx" role="menu" ref={box} tabIndex={-1} style="visibility:hidden" onContextMenu={(e) => e.preventDefault()}>
      <MenuItems items={m.items} close={closeMenu} />
    </div>
  );
}

function copy(text) {
  window.desk.copy(text);
  toast(`복사했어요 · ${text}`, { ms: 2500 });
}

/** Everything you can do to one task. `lane` adds "put the whole lane away" in the sidebar. */
export function taskItems(t, { lane } = {}) {
  const p = projectOf(get(), t.projectId);
  const live = isLive(t);
  const here = !t.watching && !t.archived;
  return [
    live && here && (t.running ? { icon: 'player-stop', label: '세션 중지', run: () => stop(t.id) } : { icon: 'player-play', label: '세션 재개', run: () => resume(t.id) }),
    live && t.watching?.status === 'gone' && { icon: 'player-play', label: '여기서 이어가기', run: () => resume(t.id) },
    live && here && t.agent === 'claude' && (t.remote ? { icon: 'device-mobile-off', label: '폰 연결 끄기', run: () => setRemote(t.id, false) } : { icon: 'device-mobile', label: '폰(Claude 앱)에서 이어하기', run: () => setRemote(t.id, true) }),
    t.remoteUrl && { icon: 'external-link', label: 'claude.ai에서 이 세션 열기', href: t.remoteUrl },
    '-',
    { icon: 'pencil', label: '작업 이름 바꾸기', run: () => openModal('rename', { taskId: t.id }) },
    p && { icon: 'settings', label: `${p.name} 설정`, run: () => openModal('project', { id: p.id }) },
    '-',
    t.worktreeAbs && { icon: 'brand-vscode', label: t.adopted || !t.isolated ? 'VS Code에서 폴더 열기' : 'VS Code에서 worktree 열기', href: vscodeLink(t.worktreeAbs) },
    t.worktreeAbs && { icon: 'folder-open', label: isMac ? 'Finder에서 보기' : '탐색기에서 보기', run: () => window.desk.reveal(t.worktreeAbs) },
    t.prUrl && { icon: 'git-pull-request', label: 'PR 열기', href: t.prUrl },
    t.branch && { icon: 'git-branch', label: '브랜치 이름 복사', run: () => copy(t.branch) },
    t.worktreeAbs && { icon: 'copy', label: '폴더 경로 복사', run: () => copy(t.worktreeAbs) },
    '-',
    t.archived
      ? live && { icon: 'archive-off', label: '보관함에서 꺼내기', run: () => restore(t.id) }
      : live
        ? { icon: 'archive', label: '보관하기 · 나중에 이어서', hint: 'E', run: () => archiveAsk(t.id) }
        : { icon: 'archive', label: '목록에서 치우기', hint: 'E', run: () => archive(t.id) },
    lane && lane.ids.length > 1 && { icon: 'archive', label: `'${lane.title}' ${lane.ids.length}개 모두 보관`, run: () => archiveMany(lane.ids) },
    live && !t.archived && (t.adopted ? { icon: 'logout', label: '목록에서 빼기 (파일은 그대로)', run: () => openModal('discard', { taskId: t.id }) } : { icon: 'trash', label: '작업 버리기…', danger: true, run: () => openModal('discard', { taskId: t.id }) }),
  ];
}

/** Several rows picked with ⌘/Ctrl or Shift: what can be done to all of them at once. */
export function pickedItems(ids) {
  const ts = ids.map((id) => taskOf(get(), id)).filter(Boolean);
  const stopped = ts.filter((t) => !t.running && isLive(t) && !t.watching && !t.archived);
  return [
    { icon: 'archive', label: `${ts.length}개 보관하기`, hint: 'E', run: () => archiveMany(ts.map((t) => t.id)) },
    stopped.length > 0 && { icon: 'player-play', label: `멈춘 ${stopped.length}개 재개`, run: () => resumeMany(stopped.map((t) => t.id)) },
    '-',
    { icon: 'x', label: '선택 해제', hint: 'Esc', run: clearPicks },
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
