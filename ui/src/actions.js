// Everything the person does to tasks, in one place: the rail, the task view, the overview, the
// command bar and the quick panel all call these.
import { api } from './api.js';
import { get, set, toast, projectOf, taskOf, setView, openModal, closeModal, optimistic, clearPending } from './store.js';
import { buildMessage } from './util.js';
import { GROUPS, grouped, groupOf, isLive, isBusy, isBlocked } from './core/status.js';
import { sound } from './app/sounds.js';

// ------------------------------------------------------------ where the person is

export function select(taskId) {
  const s = get();
  if (s.selected === taskId && s.screen === 'task') return;
  set({ selected: taskId, screen: 'task' });
}

export function openTask(taskId, view) {
  set({ selected: taskId, screen: 'task', railView: 'list' });
  if (view) setView(taskId, view);
}

/** Tasks in the order the rail shows them (folded groups skipped), for J/K and Shift-click ranges. */
export function visibleTasks(s = get()) {
  const g = grouped(s.tasks.filter((t) => !t.archived && (!s.filter || t.projectId === s.filter)));
  return GROUPS.flatMap((x) => (s.collapsed[x.key] ? [] : g[x.key]));
}

/** Put-away tasks that can still be resumed: 보관함. */
export const shelved = (tasks, filter) => tasks.filter((t) => t.archived && isLive(t) && (!filter || t.projectId === filter));

export function openCommand(mode = 'all', query = '') {
  set({ command: { mode, query } });
  // The bar draws a moment later; what's typed in between lands here and carries over.
  const proxy = document.getElementById('cmd-proxy');
  if (proxy) {
    proxy.value = '';
    proxy.focus();
  }
}
export function newTask(projectId) {
  if (projectId) set({ filter: projectId });
  openCommand('new');
}

// ------------------------------------------------------------ talking to the agent

/** Send what's in the composer (with review comments, refs and attached images). */
export async function sendMessage(taskId) {
  const s = get();
  const t = taskOf(s, taskId);
  if (!t) return false;
  const text = s.drafts[taskId] || '';
  const comments = s.comments[taskId] || [];
  const refs = s.refs[taskId] || [];
  const images = s.attachments[taskId] || [];
  let msg = buildMessage(text, comments, refs);
  if (images.length) msg = [msg, ...images.map((a) => `첨부한 이미지: ${a.path}`)].filter(Boolean).join('\n\n');
  if (!msg.trim()) return false;
  const restore = { text, comments, refs, images };
  set((st) => ({
    drafts: { ...st.drafts, [taskId]: '' },
    comments: { ...st.comments, [taskId]: [] },
    refs: { ...st.refs, [taskId]: [] },
    attachments: { ...st.attachments, [taskId]: [] },
  }));
  try {
    if (!t.running && !t.watching && isLive(t)) {
      // A stopped session: start it again, then send.
      await api('POST', `/api/tasks/${taskId}/resume`);
      await waitRunning(taskId);
    }
    optimistic(taskId, { state: 'working', reason: '', prompt: null, ask: '' });
    const m = await api('POST', `/api/tasks/${taskId}/send`, { text: msg });
    sound('sent');
    if (!t.watching) set({ lastSend: { taskId, msgId: m.id, at: Date.now(), restore, projectId: t.projectId } });
    else toast('Codex 세션 대기열에 넣었어요', { projectId: t.projectId });
    nextInTriage(taskId, 'replied');
    return true;
  } catch (e) {
    clearPending(taskId);
    // Nothing was sent: the draft comes back.
    set((st) => ({ drafts: { ...st.drafts, [taskId]: text }, comments: { ...st.comments, [taskId]: comments }, refs: { ...st.refs, [taskId]: refs }, attachments: { ...st.attachments, [taskId]: images } }));
    toast(e.message, { kind: 'err' });
    return false;
  }
}

async function waitRunning(taskId, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (taskOf(get(), taskId)?.running) return;
    await new Promise((r) => setTimeout(r, 120));
  }
}

/** One line from a tile, the panel or a quick-reply chip: same undo as any other send. */
export async function quickSend(taskId, text) {
  if (!text.trim()) return false;
  set((s) => ({ drafts: { ...s.drafts, [taskId]: text } }));
  return sendMessage(taskId);
}

export const UNDO_MS = 10_000;

/** ⌘Z right after a send: the agent stops, files go back, the draft returns. */
export async function undoLastSend() {
  const l = get().lastSend;
  if (!l || Date.now() - l.at > UNDO_MS * 3) return false;
  set({ lastSend: null });
  return undoMessage(l.taskId, l.msgId, l.restore);
}

export async function undoMessage(taskId, msgId, restore) {
  const t = taskOf(get(), taskId);
  try {
    await api('POST', `/api/tasks/${taskId}/undo`, { msgId });
    if (restore) {
      set((s) => ({
        drafts: { ...s.drafts, [taskId]: restore.text },
        comments: { ...s.comments, [taskId]: restore.comments || [] },
        refs: { ...s.refs, [taskId]: restore.refs || [] },
        attachments: { ...s.attachments, [taskId]: restore.images || [] },
      }));
    }
    toast('되돌렸어요 · 파일도 그 전으로 돌아갔어요', { projectId: t?.projectId });
    return true;
  } catch (e) {
    toast(e.message, { kind: 'err' });
    return false;
  }
}

/**
 * A button on a prompt card. On a careful project the first press only arms it (the card does
 * that); `confirm` says it was pressed twice. When the screen isn't what the card expected, the
 * terminal drawer opens so the person can answer there.
 */
export async function answer(taskId, prompt, body) {
  const t = taskOf(get(), taskId);
  optimistic(taskId, { state: 'working', prompt: null, ask: '', reason: '' });
  try {
    const r = await api('POST', `/api/tasks/${taskId}/answer`, { promptId: prompt.id, ...body });
    if (!r.ok) {
      clearPending(taskId);
      toast(r.error || '터미널에서 직접 답해 주세요', { kind: 'err', ms: 7000 });
      openDrawer('agent', taskId);
      return false;
    }
    sound('answered');
    if (r.reasonPending && body.text) {
      // The input box didn't come back in time: the reason waits there, unsent.
      await api('POST', `/api/tasks/${taskId}/paste`, { text: body.text }).catch(() => {});
      toast('거절했어요 · 이유는 입력창에 넣어 뒀어요', { projectId: t?.projectId });
    }
    if (r.message) set({ lastSend: { taskId, msgId: r.message.id, at: Date.now(), restore: { text: body.text || '' }, projectId: t?.projectId } });
    nextInTriage(taskId, body.action === 'no' ? 'denied' : 'answered');
    return true;
  } catch (e) {
    clearPending(taskId);
    toast(e.message, { kind: 'err' });
    return false;
  }
}

/** ⌘. — stop the current turn, keep the session. */
export async function interrupt(taskId) {
  await api('POST', `/api/tasks/${taskId}/interrupt`).catch((e) => toast(e.message, { kind: 'err' }));
}

export async function attachImage(taskId, file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('이미지만 붙일 수 있어요', { kind: 'err' });
  if (file.size > 5_000_000) return toast('이미지는 5MB까지 붙일 수 있어요', { kind: 'err' });
  const data = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  try {
    const { path } = await api('POST', `/api/tasks/${taskId}/attachments`, { type: file.type, data });
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ attachments: { ...s.attachments, [taskId]: [...(s.attachments[taskId] || []), { id, path, name: file.name || '붙여넣은 이미지' }] } }));
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

/** Put text into the agent's own input box (not sent; the person presses Enter there). */
export async function pasteText(taskId, text) {
  try {
    await api('POST', `/api/tasks/${taskId}/paste`, { text });
    return true;
  } catch (e) {
    toast(e.message, { kind: 'err' });
    return false;
  }
}

// ------------------------------------------------------------ lifecycle

export async function createTask(projectId, agent, prompt, opts = {}) {
  try {
    const t = await api('POST', '/api/tasks', { projectId, agent, prompt, ...opts });
    set({ selected: t.id, screen: 'task', command: null, modal: null });
    setView(t.id, 'chat');
    sound('sent');
    const p = projectOf(get(), projectId);
    toast(`${p?.name || ''}에서 새 작업을 시작했어요`, { projectId, action: { label: '되돌리기', run: () => cancelCreate(t.id) } });
    return t;
  } catch (e) {
    toast(e.message, { kind: 'err' });
    return null;
  }
}

async function cancelCreate(taskId) {
  await api('POST', `/api/tasks/${taskId}/discard`).catch(() => {});
  await api('POST', `/api/tasks/${taskId}/archive`).catch(() => {});
  toast('새 작업을 되돌렸어요');
}

export async function resume(taskId) {
  try {
    await api('POST', `/api/tasks/${taskId}/resume`);
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function stop(taskId) {
  await api('POST', `/api/tasks/${taskId}/stop`).catch((e) => toast(e.message, { kind: 'err' }));
}

export async function merge(taskId) {
  try {
    const r = await api('POST', `/api/tasks/${taskId}/merge`);
    const t = taskOf(get(), taskId);
    toast(`${r.into}에 머지했어요`, { projectId: t?.projectId });
    closeModal();
  } catch (e) {
    toast(e.message, { kind: 'err', ms: 8000 });
  }
}

export async function pr(taskId) {
  const id = toast('브랜치를 올리고 PR을 만드는 중…', { ms: 20000 });
  try {
    const r = await api('POST', `/api/tasks/${taskId}/pr`);
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    toast(r.url ? 'PR을 만들었어요' : 'PR을 만들었어요 (주소를 못 읽었어요)', { projectId: taskOf(get(), taskId)?.projectId, link: r.url, ms: 9000 });
  } catch (e) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    toast(e.message, { kind: 'err', ms: 9000 });
  }
}

export async function discard(taskId) {
  try {
    const t = taskOf(get(), taskId);
    await api('POST', `/api/tasks/${taskId}/discard`);
    const next = get().selected === taskId ? visibleTasks().find((x) => x.id !== taskId && isLive(x)) : null;
    set(get().selected === taskId ? { modal: null, selected: next?.id || null } : { modal: null });
    toast(t?.adopted ? 'Desk에서 뺐어요 · 파일은 그대로예요' : '작업을 버렸어요', { projectId: t?.projectId });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function archive(taskId) {
  const t = taskOf(get(), taskId);
  try {
    optimistic(taskId, { archived: true });
    await api('POST', `/api/tasks/${taskId}/archive`);
    if (get().selected === taskId) set({ selected: visibleTasks().find((x) => x.id !== taskId && isLive(x))?.id || null });
    if (t && isLive(t)) toast('보관했어요 · 보관함에서 꺼내면 같은 대화로 이어가요', { projectId: t.projectId, action: { label: '꺼내기', run: () => restore(taskId) } });
  } catch (e) {
    clearPending(taskId);
    toast(e.message, { kind: 'err' });
  }
}

/** A working agent gets asked first: putting it away stops it mid-turn (or its background work). */
export function archiveAsk(taskId) {
  const t = taskOf(get(), taskId);
  if (!t || t.archived) return;
  if (t.running && isBusy(t)) openModal('archive', { taskIds: [taskId] });
  else archive(taskId);
}

/** Several at once (picked rows, a whole group). Working agents among them are asked about first. */
export async function archiveMany(ids, { confirmed = false } = {}) {
  const ts = ids.map((id) => taskOf(get(), id)).filter((t) => t && !t.archived);
  if (ts.length === 1) {
    clearPicks();
    return confirmed ? archive(ts[0].id) : archiveAsk(ts[0].id);
  }
  if (!ts.length) return;
  if (!confirmed && ts.some((t) => t.running && isBusy(t))) return openModal('archive', { taskIds: ts.map((t) => t.id) });
  const done = [];
  for (const t of ts) {
    try {
      await api('POST', `/api/tasks/${t.id}/archive`);
      done.push(t);
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  }
  const gone = new Set(done.map((t) => t.id));
  const patch = { picked: [], pickAnchor: null };
  if (gone.has(get().selected)) patch.selected = visibleTasks().find((x) => !gone.has(x.id) && isLive(x))?.id || null;
  set(patch);
  if (!done.length) return;
  const back = done.filter(isLive);
  const running = new Set(done.filter((t) => t.running).map((t) => t.id));
  toast(`${done.length}개 보관했어요`, back.length ? { ms: 7000, action: { label: '되돌리기', run: () => unarchiveMany(back.map((t) => t.id), running) } } : {});
}

async function unarchiveMany(ids, running) {
  for (const id of ids) {
    try {
      await api('POST', `/api/tasks/${id}/unarchive`);
      if (running.has(id)) await api('POST', `/api/tasks/${id}/resume`);
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  }
}

export async function resumeMany(ids) {
  clearPicks();
  for (const id of ids) await resume(id);
}

/** Out of 보관함 and straight back to work: the agent resumes the same conversation. */
export async function restore(taskId) {
  const t = taskOf(get(), taskId);
  try {
    await api('POST', `/api/tasks/${taskId}/unarchive`);
    set({ selected: taskId, screen: 'task', railView: 'list' });
    if (t && isLive(t) && !t.watching) await api('POST', `/api/tasks/${taskId}/resume`);
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function rename(taskId, title) {
  const v = String(title || '').trim();
  if (!v) return;
  optimistic(taskId, { title: v });
  await api('POST', `/api/tasks/${taskId}/rename`, { title: v }).catch((e) => toast(e.message, { kind: 'err' }));
}

/** Turn Remote Control (Claude app on a phone) on or off for a task. */
export async function setRemote(taskId, on) {
  try {
    const r = await api('POST', `/api/tasks/${taskId}/remote`, { on });
    const t = taskOf(get(), taskId);
    if (on) toast(r.applied === 'now' ? '폰의 Claude 앱 · Code 탭에서 이 세션을 열 수 있어요' : r.hint || '다음에 세션을 시작할 때 폰과 연결해요', { projectId: t?.projectId, ms: 6000 });
    else toast(r.applied === 'now' ? '폰 연결을 껐어요' : '다음에 세션을 시작할 때부터 폰과 연결하지 않아요', { projectId: t?.projectId });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

/** Open an existing agent session (another terminal, background, or a past conversation) as a task. */
export async function importSession(s, mode) {
  try {
    const t = await api('POST', '/api/tasks', { import: { agent: s.agent, sessionId: s.sessionId, mode } });
    set({ selected: t.id, modal: null, screen: 'task' });
    setView(t.id, 'chat');
    const p = projectOf(get(), t.projectId);
    const how = t.imported?.mode === 'fork' ? '복사본으로 열었어요 · 원래 세션은 그대로예요' : t.imported?.mode === 'takeover' ? '원래 세션을 멈추고 여기서 이어받았어요' : '여기서 이어서 열었어요';
    toast(`${p?.name || ''} · ${how}`, { projectId: t.projectId, ms: 6000 });
    return t;
  } catch (e) {
    toast(e.message, { kind: 'err' });
    return null;
  }
}

// ------------------------------------------------------------ picking several rows

/** ⌘/Ctrl-click toggles one; the open task joins the pick the first time, the way Finder does it. */
export function togglePick(taskId) {
  const s = get();
  const cur = s.picked.length ? s.picked : s.selected && s.selected !== taskId ? [s.selected] : [];
  set({ picked: cur.includes(taskId) ? cur.filter((x) => x !== taskId) : [...cur, taskId], pickAnchor: taskId });
}

/** Shift-click: everything between the last picked (or the open) row and this one, as the rail shows them. */
export function pickRange(taskId) {
  const s = get();
  const order = visibleTasks(s).map((t) => t.id);
  const from = order.indexOf(order.includes(s.pickAnchor) ? s.pickAnchor : s.selected);
  const to = order.indexOf(taskId);
  if (from < 0 || to < 0) return togglePick(taskId);
  set({ picked: order.slice(Math.min(from, to), Math.max(from, to) + 1), pickAnchor: s.pickAnchor || order[from] });
}

export function clearPicks() {
  if (get().picked.length) set({ picked: [], pickAnchor: null });
}

// ------------------------------------------------------------ review notes

export function addComment(taskId, c) {
  set((s) => ({ comments: { ...s.comments, [taskId]: [...(s.comments[taskId] || []), { id: Math.random().toString(36).slice(2), ...c }] } }));
}
export function removeComment(taskId, id) {
  set((s) => ({ comments: { ...s.comments, [taskId]: (s.comments[taskId] || []).filter((c) => c.id !== id) } }));
}
export function addRef(taskId, r) {
  set((s) => ({ refs: { ...s.refs, [taskId]: [...(s.refs[taskId] || []), { id: Math.random().toString(36).slice(2), ...r }] } }));
}
export function removeRef(taskId, id) {
  set((s) => ({ refs: { ...s.refs, [taskId]: (s.refs[taskId] || []).filter((c) => c.id !== id) } }));
}
export function removeAttachment(taskId, id) {
  set((s) => ({ attachments: { ...s.attachments, [taskId]: (s.attachments[taskId] || []).filter((c) => c.id !== id) } }));
}

export function openFileInTask(taskId, path, line, ref = 'work') {
  set((s) => ({ openFile: { ...s.openFile, [taskId]: { path, line, ref } } }));
  setView(taskId, 'files');
}

// ------------------------------------------------------------ the drawer (raw terminal, shell)

export function openDrawer(tab = 'agent', taskId) {
  if (taskId && get().selected !== taskId) select(taskId);
  set((s) => ({ drawer: { ...s.drawer, open: true, tab } }));
}
export function toggleDrawer(tab) {
  set((s) => ({ drawer: { ...s.drawer, open: !(s.drawer.open && (!tab || s.drawer.tab === tab)), tab: tab || s.drawer.tab } }));
}

// ------------------------------------------------------------ 차례로: everything waiting on me, one by one

/** The queue: stuck agents first, then replies, then reviews (the rail's own order). */
export function triageQueue(s = get()) {
  const g = grouped(s.tasks.filter((t) => !t.archived && (!s.filter || t.projectId === s.filter)));
  return g.yours.map((t) => t.id);
}

export function startTriage() {
  const queue = triageQueue();
  if (!queue.length) return toast('기다리는 작업이 없어요');
  set({ triage: { queue, at: 0, tally: { answered: 0, denied: 0, replied: 0, skipped: 0 }, from: get().selected }, selected: queue[0], screen: 'task' });
  setView(queue[0], 'chat');
}

export function stepTriage(dir = 1, how = 'skipped') {
  const tr = get().triage;
  if (!tr) return;
  const tally = { ...tr.tally };
  if (how) tally[how] = (tally[how] || 0) + 1;
  let queue = tr.queue;
  if (how === 'skipped' && dir > 0) queue = [...queue.slice(0, tr.at), ...queue.slice(tr.at + 1), queue[tr.at]];
  const at = how === 'skipped' && dir > 0 ? tr.at : Math.max(0, tr.at + dir);
  // Done: everything went through once (skipped ones went to the back and came around again).
  if (at >= queue.length || (how === 'skipped' && tally.skipped >= queue.length)) return set({ triage: { ...tr, queue, at: queue.length, tally, done: true } });
  set({ triage: { ...tr, queue, at, tally }, selected: queue[at] });
  setView(queue[at], 'chat');
}

/** After an answer or a reply during triage, move on (a beat later, so the receipt shows). */
export function nextInTriage(taskId, how) {
  const tr = get().triage;
  if (!tr || tr.queue[tr.at] !== taskId) return;
  setTimeout(() => {
    const cur = get().triage;
    if (!cur || cur.queue[cur.at] !== taskId) return;
    const tally = { ...cur.tally, [how]: (cur.tally[how] || 0) + 1 };
    const at = cur.at + 1;
    if (at >= cur.queue.length) return set({ triage: { ...cur, at, tally, done: true } });
    set({ triage: { ...cur, at, tally }, selected: cur.queue[at] });
    setView(cur.queue[at], 'chat');
  }, 520);
}

export function endTriage() {
  const tr = get().triage;
  if (!tr) return;
  set({ triage: null, selected: tr.from && taskOf(get(), tr.from) ? tr.from : get().selected });
}

export { groupOf, isBlocked };
