// When the window isn't watched: system notifications and sounds when an agent turns to me, and a
// toast for prompts that came from elsewhere (the phone). Also clears optimistic patches the core
// has now confirmed.
import { onState, focusWindow } from '../api.js';
import { get, set, toast, clearPending } from '../store.js';
import { askOf, isBlocked, firstLine } from '../core/status.js';
import { select, undoMessage } from '../actions.js';
import { sound } from './sounds.js';

export function watchTasks() {
  // A prompt from the phone (Remote Control) or another place shows up here too, with an undo.
  onState((prev, next) => {
    if (!prev.loaded) return;
    const seen = new Set(prev.tasks.flatMap((t) => (t.messages || []).map((m) => m.id)));
    for (const t of next.tasks) {
      for (const m of t.messages || []) {
        if (seen.has(m.id) || (m.source !== 'remote' && m.source !== 'outside')) continue;
        const p = next.projects.find((x) => x.id === t.projectId);
        const short = m.text.length > 60 ? m.text.slice(0, 60) + '…' : m.text;
        toast(`${p?.name || ''} · ${m.source === 'remote' ? '폰에서' : '다른 곳에서'} 보낸 지시 “${short}”`, { projectId: t.projectId, ms: 9000, action: m.canUndo ? { label: '되돌리기', run: () => undoMessage(t.id, m.id) } : undefined });
      }
    }
  });

  onState((prev, next) => {
    if (!prev.loaded) return;
    // What the core confirms replaces what the window guessed.
    const pend = get().pending;
    for (const id of Object.keys(pend)) {
      const before = prev.tasks.find((t) => t.id === id);
      const after = next.tasks.find((t) => t.id === id);
      if (!after || JSON.stringify(before) !== JSON.stringify(after)) clearPending(id);
    }
    const key = (t) => `${t.state}:${isBlocked(t) ? t.prompt?.id || t.ask : ''}`;
    const before = Object.fromEntries(prev.tasks.map((t) => [t.id, key(t)]));
    const settings = get().settings;
    let arrived = false;
    let finished = false;
    for (const t of next.tasks) {
      if (t.archived || before[t.id] === key(t) || before[t.id] === undefined) continue;
      if (!['needs_input', 'review'].includes(t.state)) continue;
      const blocked = isBlocked(t);
      if (blocked || t.state === 'needs_input') arrived = true;
      else finished = true;
      if (document.hasFocus() || settings.notify === 'off' || (settings.notify === 'blocked' && !blocked)) continue;
      if (!('Notification' in window) || Notification.permission !== 'granted') continue;
      const p = next.projects.find((x) => x.id === t.projectId);
      const ask = askOf(t);
      const body = ask ? `${ask.label} · ${t.prompt?.command?.text || t.prompt?.title || t.reason}` : t.state === 'review' ? `검토할 것 · ${firstLine(t.summary || t.reply?.md || t.reason)}` : `답장 차례 · ${firstLine(t.reply?.md || t.reason)}`;
      // A stuck agent stays on screen until looked at: nothing moves until then.
      const n = new Notification(`${p?.name || ''} · ${t.title}`, { body, tag: t.id, requireInteraction: !!ask, silent: settings.sounds });
      n.onclick = () => {
        focusWindow();
        select(t.id);
        n.close();
      };
    }
    if (arrived) sound('arrive');
    else if (finished) sound('done');
  });
}

/** The window title and the Dock/taskbar badge say how many wait on me. */
export function watchTitle() {
  let last = '';
  onState((_, next) => {
    const live = next.tasks.filter((t) => !t.archived);
    const n = live.filter((t) => t.state === 'needs_input' || t.state === 'review').length;
    const title = n ? `(${n}) Desk` : 'Desk';
    if (title !== last) document.title = last = title;
  });
}
