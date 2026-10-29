import './design/app.css';
import { render } from 'preact';
import { connect, watchUpdates } from './api.js';
import { get } from './store.js';
import { bootTheme, loadUserThemes } from './app/theme.js';
import { dispatch } from './app/keys.js';
import './app/shortcuts.js';
import { watchTasks, watchTitle } from './app/notify.js';
import { App } from './app/App.jsx';
import { openTask } from './actions.js';

/**
 * The light on glass follows the pointer: the nearest [data-sheen] element gets --mx/--my. One
 * listener for the whole app, at most once a frame.
 */
function sheen() {
  let raf = 0;
  let ev = null;
  window.addEventListener(
    'pointermove',
    (e) => {
      ev = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = ev.target.closest?.('[data-sheen]');
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${ev.clientX - r.left}px`);
        el.style.setProperty('--my', `${ev.clientY - r.top}px`);
      });
    },
    { passive: true }
  );
}

/** Platform and window state on <html>: CSS leaves room for the traffic lights or caption buttons. */
function windowChrome() {
  const root = document.documentElement;
  root.classList.add(`os-${window.desk.platform}`);
  window.desk.onFullscreen((on) => root.classList.toggle('fullscreen', on));
  // The aurora rests while nobody's looking.
  const still = () => (document.hasFocus() ? delete root.dataset.still : (root.dataset.still = ''));
  window.addEventListener('focus', still);
  window.addEventListener('blur', still);
  still();
}

window.addEventListener('keydown', (e) => {
  const s = get();
  // Dialogs, the command bar and menus own the keyboard while they're up.
  if (s.modal || s.command || s.ctx || (s.cheat && e.code !== 'Escape' && e.code !== 'Slash')) return;
  dispatch(e);
});

windowChrome();
sheen();
// From the quick panel or a notification: open that task here.
window.desk.onNavigate?.(({ taskId, view }) => taskId && openTask(taskId, view));
await bootTheme();
connect();
watchUpdates();
watchTasks();
watchTitle();
loadUserThemes();
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
render(<App />, document.getElementById('app'));
