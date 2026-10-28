import './styles.css';
import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import { connect, onState, focusWindow, watchUpdates } from './api.js';
import { useStore, get, set, openModal, projectOf, taskOf, setView, toast } from './store.js';
import { roomVars, isTyping, setFavicon, laneOf } from './util.js';
import { undoBanner, select, visibleTasks, newTask, undoMessage } from './actions.js';
import { isUndoKey } from './components/Terminal.jsx';
import { Board } from './components/Board.jsx';
import { Topbar } from './components/Topbar.jsx';
import { Inbox } from './components/Inbox.jsx';
import { RoomArea } from './components/Room.jsx';
import { ModalHost } from './components/Modals.jsx';
import { Glyph, I } from './components/bits.jsx';
import { focusInput as focusComposer } from './focus.js';

function Toasts() {
  const s = useStore((s) => ({ toasts: s.toasts, projects: s.projects }));
  return (
    <div class="toasts" aria-live="polite">
      {s.toasts.map((t) => {
        const p = t.projectId && projectOf(s, t.projectId);
        return (
          <div key={t.id} class={`toast ${t.kind === 'room' && p ? 'tinted' : ''} ${t.kind === 'err' ? 'err' : ''}`} style={p ? roomVars(p.color) : undefined}>
            {t.kind === 'err' ? <I n="alert-triangle" /> : p ? <Glyph project={p} size={22} /> : <I n="info-circle" />}
            <span style="white-space:pre-wrap">{t.text}</span>
            {t.link && (
              <a href={t.link} target="_blank" rel="noopener noreferrer" style="color:inherit;font-weight:700">
                열기
              </a>
            )}
            {t.action && (
              <button class="btn sm" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const seenTasks = new Set();

function App() {
  const s = useStore((s) => ({ selected: s.selected, tasks: s.tasks, projects: s.projects, loaded: s.loaded, filter: s.filter, view: s.view }));
  const task = taskOf(s, s.selected);
  const project = task && projectOf(s, task.projectId);
  for (const t of s.tasks) seenTasks.add(t.id);

  // Browser tab: project color favicon + project name first, so even the tab strip says where you are.
  useEffect(() => {
    const waiting = s.tasks.filter((t) => !t.archived && (t.state === 'needs_input' || t.state === 'review')).length;
    document.title = `${waiting ? `(${waiting}) ` : ''}${project ? `${project.name} · ${task.title}` : 'Desk'}`;
    setFavicon(project?.color || '#7D8FA3', waiting > 0);
  }, [project?.id, project?.color, task?.title, s.tasks]);

  // Drop a selection that no longer exists.
  // (A task just created or imported can be selected a moment before the live state includes it.)
  useEffect(() => {
    if (!s.loaded || !s.selected || task) return;
    const sel = s.selected;
    // Removed (its project was deleted, or archived elsewhere): leave at once. A brand-new task
    // that the live state hasn't delivered yet gets a moment instead.
    if (seenTasks.has(sel)) return set({ selected: null });
    const t = setTimeout(() => {
      const st = get();
      if (st.selected === sel && !taskOf(st, sel)) set({ selected: null });
    }, 2000);
    return () => clearTimeout(t);
  }, [s.loaded, s.selected, !!task]);

  return (
    <div class="app">
      <Topbar />
      {s.view === 'board' ? (
        <Board />
      ) : (
        <div class={`main ${task ? 'has-room' : ''}`}>
          <Inbox />
          <RoomArea />
        </div>
      )}
      <ModalHost />
      <Toasts />
    </div>
  );
}

// ------------------------------------------------------------ keyboard

window.addEventListener('keydown', (e) => {
  const s = get();
  const mod = e.metaKey || e.ctrlKey;
  if (s.modal) return; // modals own the keyboard

  const inTerm = !!document.activeElement?.closest?.('.xterm');
  if (e.key === 'Escape' && s.banner && !inTerm && !isTyping()) {
    e.preventDefault();
    undoBanner();
    return;
  }
  // ⌘Z right after a send takes it back (the terminal handles its own copy of this key).
  if (s.banner && isUndoKey(e) && !inTerm && !(isTyping() && document.activeElement?.value)) {
    e.preventDefault();
    undoBanner();
    return;
  }
  if (e.ctrlKey && !e.metaKey && (e.code === 'Backquote' || e.key === '`') && s.selected) {
    e.preventDefault();
    return set({ shellOpen: !s.shellOpen });
  }
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return openModal('palette');
  }
  if (mod && e.key.toLowerCase() === 'p' && s.selected) {
    e.preventDefault();
    return openModal('quick', { taskId: s.selected });
  }
  if (mod && e.key.toLowerCase() === 'b' && !document.activeElement?.closest?.('.xterm')) {
    e.preventDefault();
    if (s.selected) setView(s.selected, 'files');
    return set((st) => ({ treeOpen: !st.treeOpen }));
  }
  if (e.altKey && !mod && /^Digit[123]$/.test(e.code) && s.selected) {
    e.preventDefault();
    return setView(s.selected, ['chat', 'review', 'files'][+e.code.slice(5) - 1]);
  }
  if (isTyping() || mod || e.altKey) return;
  if (e.key === 'b' || e.key === 'B' || e.key === 'ㅠ') {
    e.preventDefault();
    return set({ view: s.view === 'board' ? 'inbox' : 'board' });
  }
  if (s.view === 'board') {
    if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') {
      e.preventDefault();
      newTask();
    }
    return;
  }

  const list = visibleTasks(s).filter((t) => !s.collapsed[laneKey(t)]);
  const idx = list.findIndex((t) => t.id === s.selected);
  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    const n = list[Math.min(list.length - 1, idx + 1)];
    if (n) select(n.id);
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = list[Math.max(0, idx - 1)];
    if (n) select(n.id);
  } else if (e.key === 'Enter' && s.selected) {
    e.preventDefault();
    focusComposer();
  } else if (e.key === 'n' || e.key === 'N' || e.key === 'ㅜ') {
    e.preventDefault();
    newTask();
  } else if (e.key === '/') {
    e.preventDefault();
    openModal('palette');
  } else if (/^[0-9]$/.test(e.key)) {
    const p = s.projects[+e.key - 1];
    if (e.key === '0') set({ filter: null });
    else if (p) set({ filter: s.filter === p.id ? null : p.id });
  }
});

const laneKey = (t) => laneOf(t);

// ------------------------------------------------------------ notifications

// A prompt that arrived from the phone (Remote Control) shows up here too, with an undo.
onState((prev, next) => {
  if (!prev.loaded) return;
  const seen = new Set(prev.tasks.flatMap((t) => t.messages.map((m) => m.id)));
  for (const t of next.tasks) {
    for (const m of t.messages) {
      if (seen.has(m.id) || (m.source !== 'remote' && m.source !== 'outside')) continue;
      const p = next.projects.find((x) => x.id === t.projectId);
      const short = m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text;
      toast(`${p?.name || ''} · ${m.source === 'remote' ? '폰에서' : '다른 곳에서'} 보낸 지시\n“${short}”`, {
        kind: 'room',
        projectId: t.projectId,
        ms: 9000,
        action: m.canUndo ? { label: '되돌리기', run: () => undoMessage(t.id, m.id) } : undefined,
      });
    }
  }
});

onState((prev, next) => {
  // A desktop window can sit unfocused behind other apps, or be closed to the Dock, without being "hidden".
  if (!prev.loaded || !('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  const before = Object.fromEntries(prev.tasks.map((t) => [t.id, t.state]));
  for (const t of next.tasks) {
    if (before[t.id] === t.state || !['needs_input', 'review'].includes(t.state)) continue;
    const p = next.projects.find((x) => x.id === t.projectId);
    const n = new Notification(`${p?.name || ''} · ${t.title}`, { body: t.state === 'review' ? `검토할 것 · ${t.summary || t.reason}` : `답할 것 · ${t.reason}`, tag: t.id });
    n.onclick = () => {
      focusWindow();
      select(t.id);
      n.close();
    };
  }
});

connect();
watchUpdates();
render(<App />, document.getElementById('app'));
