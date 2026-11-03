import { useEffect } from 'preact/hooks';
import { useStore, get, set, projectOf, taskOf, dismissToast } from '../store.js';
import { Titlebar } from './Titlebar.jsx';
import { Home, CheatSheet } from './Home.jsx';
import { KEYS } from './keys.js';
import { Rail } from '../features/rail/Rail.jsx';
import { TaskView } from '../features/task/TaskView.jsx';
import { Overview } from '../features/overview/Overview.jsx';
import { Settings } from '../features/settings/Settings.jsx';
import { CommandBar } from '../features/command/CommandBar.jsx';
import { SheetHost } from '../features/sheets/Sheets.jsx';
import { TriageDone } from '../features/triage/TriageBar.jsx';
import { Board, useAway } from '../features/recap/Board.jsx';
import { ContextMenu } from '../ui/Menu.jsx';
import { Tooltip } from '../ui/Tooltip.jsx';
import { Glyph, I } from '../ui/bits.jsx';

export function App() {
  const s = useStore((s) => ({ screen: s.screen, selected: s.selected, tasks: s.tasks, projects: s.projects, pending: s.pending, loaded: s.loaded, railHidden: s.railHidden, cheat: s.cheat }));
  const task = s.screen === 'task' ? taskOf(s, s.selected) : null;
  const open = task && !task.archived ? task : null;
  const project = open && projectOf(s, open.projectId);
  useAway();

  // A selection that no longer exists (deleted, or put away elsewhere) falls back to home. A task
  // just created can be selected a moment before the live state has it, so wait a little.
  useEffect(() => {
    if (!s.loaded || !s.selected || open) return;
    const sel = s.selected;
    const t = setTimeout(() => {
      const cur = get();
      const tk = taskOf(cur, sel);
      if (cur.selected === sel && (!tk || tk.archived)) set({ selected: null });
    }, 2000);
    return () => clearTimeout(t);
  }, [s.loaded, s.selected, !!open]);

  return (
    <div class={`app screen-${s.screen}`}>
      <div class="ambient" aria-hidden="true" />
      <Titlebar />
      <div class={`stage ${s.railHidden ? 'no-rail' : ''}`}>
        {s.screen === 'overview' ? (
          <Overview />
        ) : s.screen === 'settings' ? (
          <Settings />
        ) : (
          <>
            {!s.railHidden && <Rail />}
            <main class="pane">{open ? <TaskView key={open.id} task={open} project={project} /> : <Home />}</main>
          </>
        )}
      </div>
      <TriageDone />
      <input id="cmd-proxy" class="sr-only" tabIndex={-1} aria-hidden="true" />
      <CommandBar />
      <SheetHost />
      <Board />
      <Toasts />
      <ContextMenu />
      <Tooltip />
      {s.cheat && <CheatSheet keys={KEYS} />}
    </div>
  );
}

function Toasts() {
  const s = useStore((s) => ({ toasts: s.toasts, projects: s.projects }));
  return (
    <div class="toasts" aria-live="polite">
      {s.toasts.map((t) => {
        const p = t.projectId && projectOf(s, t.projectId);
        return (
          <div key={t.id} class={`toast glass-3 ${t.kind === 'err' ? 'err' : ''}`} role={t.kind === 'err' ? 'alert' : 'status'}>
            {t.kind === 'err' ? <I n="alert-triangle" /> : p ? <Glyph project={p} size={20} /> : <I n="info-circle" />}
            <span class="msg">{t.text}</span>
            {t.link && (
              <a class="btn sm" href={t.link} target="_blank" rel="noopener noreferrer">
                열기
              </a>
            )}
            {t.action && (
              <button
                class="btn sm"
                onClick={() => {
                  dismissToast(t.id);
                  t.action.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

