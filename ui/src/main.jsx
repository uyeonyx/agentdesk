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

/** Platform and window state on <html>: CSS leaves room for the traffic lights or caption buttons. */
function windowChrome() {
  const root = document.documentElement;
  root.classList.add(`os-${window.desk.platform}`);
  window.desk.onFullscreen((on) => root.classList.toggle('fullscreen', on));
}

window.addEventListener('keydown', (e) => {
  const s = get();
  // Dialogs, the command bar and menus own the keyboard while they're up.
  if (s.modal || s.command || s.ctx || (s.cheat && e.code !== 'Escape' && e.code !== 'Slash')) return;
  dispatch(e);
});

windowChrome();
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
