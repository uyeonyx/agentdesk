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
import { ContextMenu } from '../ui/Menu.jsx';
import { Tooltip } from '../ui/Tooltip.jsx';
import { Glyph, I } from '../ui/bits.jsx';

export function App() {
  const s = useStore((s) => ({ screen: s.screen, selected: s.selected, tasks: s.tasks, projects: s.projects, pending: s.pending, loaded: s.loaded, railHidden: s.railHidden, cheat: s.cheat }));
  const task = s.screen === 'task' ? taskOf(s, s.selected) : null;
  const open = task && !task.archived ? task : null;
  const project = open && projectOf(s, open.projectId);

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
      <div class="ambient" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <LensFilter />
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

/**
 * The lens the big glass bars look through: a displacement map that bends what's behind them a
 * little at their edges (backdrop-filter: url(#desk-lens)). Red moves pixels sideways, green up/down;
 * mid-grey moves nothing, so only the rim refracts.
 */
const MAP =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200" preserveAspectRatio="none"><defs><linearGradient id="x" x1="0" x2="1"><stop offset="0" stop-color="#000"/><stop offset=".14" stop-color="#800000"/><stop offset=".86" stop-color="#800000"/><stop offset="1" stop-color="#f00"/></linearGradient><linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset=".22" stop-color="#008000"/><stop offset=".78" stop-color="#008000"/><stop offset="1" stop-color="#0f0"/></linearGradient></defs><rect width="200" height="200" fill="url(#x)"/><rect width="200" height="200" fill="url(#y)" style="mix-blend-mode:screen"/></svg>`
  );

function LensFilter() {
  return (
    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <filter id="desk-lens" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feImage href={MAP} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale="18" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
