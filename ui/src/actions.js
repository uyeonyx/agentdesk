import { api } from './api.js';
import { get, set, toast, projectOf, taskOf, setView, openModal } from './store.js';
import { buildMessage, laneOf, LANES, isLive } from './util.js';

const BANNER_MS = 4500;
let bannerTimer;

export function showBanner(b) {
  clearTimeout(bannerTimer);
  set({ banner: { ...b, at: Date.now(), ms: BANNER_MS } });
  bannerTimer = setTimeout(() => set({ banner: null }), BANNER_MS);
}
export function dismissBanner() {
  clearTimeout(bannerTimer);
  set({ banner: null });
}

export function select(taskId) {
  const s = get();
  if (s.selected === taskId) return;
  set({ selected: taskId });
}

export function visibleTasks(s = get()) {
  const order = Object.fromEntries(LANES.map((l, i) => [l.key, i]));
  return s.tasks
    .filter((t) => !t.archived && (!s.filter || t.projectId === s.filter))
    .sort((a, b) => order[laneOf(a)] - order[laneOf(b)] || b.updatedAt - a.updatedAt);
}

/** Put-away tasks that can still be resumed: 보관함. */
export const shelved = (tasks, filter) => tasks.filter((t) => t.archived && isLive(t) && (!filter || t.projectId === filter));

export async function sendMessage(taskId) {
  const s = get();
  const t = taskOf(s, taskId);
  if (!t) return false;
  const text = s.drafts[taskId] || '';
  const comments = s.comments[taskId] || [];
  const refs = s.refs[taskId] || [];
  const msg = buildMessage(text, comments, refs);
  if (!msg.trim()) return false;
  try {
    const m = await api('POST', `/api/tasks/${taskId}/send`, { text: msg });
    set((st) => ({
      drafts: { ...st.drafts, [taskId]: '' },
      comments: { ...st.comments, [taskId]: [] },
      refs: { ...st.refs, [taskId]: [] },
    }));
    showBanner({ kind: 'send', taskId, msgId: m.id, projectId: t.projectId, text: msg, restore: { text, comments, refs } });
    return true;
  } catch (e) {
    if (e.status === 409 && /재개/.test(e.message)) {
      toast(e.message, { kind: 'err', action: { label: '재개', run: () => resume(taskId) } });
    } else toast(e.message, { kind: 'err' });
    return false;
  }
}

export async function undoBanner() {
  const b = get().banner;
  if (!b) return;
  dismissBanner();
  const p = projectOf(get(), b.projectId);
  try {
    if (b.kind === 'create') {
      await api('POST', `/api/tasks/${b.taskId}/discard`);
      await api('POST', `/api/tasks/${b.taskId}/archive`).catch(() => {});
      toast(`${p?.name || ''} 새 작업을 취소했어요`, { kind: 'room', projectId: b.projectId });
    } else {
      await api('POST', `/api/tasks/${b.taskId}/undo`, { msgId: b.msgId });
      if (b.restore) {
        // Composer send: put the draft and the review comments back exactly as they were.
        const r = b.restore;
        set((st) => ({
          drafts: { ...st.drafts, [b.taskId]: r.text },
          comments: { ...st.comments, [b.taskId]: r.comments },
          refs: { ...st.refs, [b.taskId]: r.refs },
        }));
        toast(`${p?.name || ''}에 보낸 지시를 되돌렸어요 · 파일도 그 전으로 복원`, { kind: 'room', projectId: b.projectId, ms: 5000 });
      } else {
        // Typed in the terminal: offer to put the text back into the agent's input box.
        toast(`${p?.name || ''}에 보낸 지시를 되돌렸어요 · 파일도 그 전으로 복원`, {
          kind: 'room',
          projectId: b.projectId,
          ms: 9000,
          action: { label: '입력창에 다시 넣기', run: () => pasteText(b.taskId, b.text) },
        });
      }
    }
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function undoMessage(taskId, msgId) {
  const t = taskOf(get(), taskId);
  const p = projectOf(get(), t?.projectId);
  try {
    await api('POST', `/api/tasks/${taskId}/undo`, { msgId });
    toast(`${p?.name || ''} · 그 지시 직전 상태로 되돌렸어요`, { kind: 'room', projectId: t?.projectId });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function createTask(projectId, agent, prompt, opts = {}) {
  try {
    const t = await api('POST', '/api/tasks', { projectId, agent, prompt, ...opts });
    set({ selected: t.id, modal: null });
    setView(t.id, 'chat');
    showBanner({ kind: 'create', taskId: t.id, projectId, text: prompt });
    return t;
  } catch (e) {
    toast(e.message, { kind: 'err' });
    return null;
  }
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
    toast(`${r.into}에 머지했어요`, { kind: 'room', projectId: t?.projectId });
    set({ modal: null });
  } catch (e) {
    toast(e.message, { kind: 'err', ms: 8000 });
  }
}

export async function pr(taskId) {
  const id = toast('브랜치를 올리고 PR을 만드는 중…', { ms: 20000 });
  try {
    const r = await api('POST', `/api/tasks/${taskId}/pr`);
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    toast(r.url ? 'PR을 만들었어요' : 'PR을 만들었어요 (주소를 못 읽었어요)', { kind: 'room', projectId: taskOf(get(), taskId)?.projectId, link: r.url, ms: 9000 });
  } catch (e) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    toast(e.message, { kind: 'err', ms: 9000 });
  }
}

export async function discard(taskId) {
  try {
    const t = taskOf(get(), taskId);
    await api('POST', `/api/tasks/${taskId}/discard`);
    // Gone in one step: move on to the next task instead of leaving the room behind.
    const next = get().selected === taskId ? visibleTasks().find((x) => x.id !== taskId && isLive(x)) : null;
    set(get().selected === taskId ? { modal: null, selected: next?.id || null } : { modal: null });
    toast(t?.adopted ? '목록에서 뺐어요 · 파일은 그대로예요' : '작업을 버렸어요', { kind: 'room', projectId: t?.projectId });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function archive(taskId) {
  const t = taskOf(get(), taskId);
  try {
    await api('POST', `/api/tasks/${taskId}/archive`);
    if (get().selected === taskId) {
      const next = visibleTasks().find((x) => x.id !== taskId && isLive(x));
      set({ selected: next?.id || null });
    }
    // Finished ones (merged, discarded) just leave the list; anything else waits in 보관함.
    if (t && isLive(t)) toast('보관했어요 · 보관함에서 언제든 꺼낼 수 있어요', { kind: 'room', projectId: t.projectId, action: { label: '꺼내기', run: () => restore(taskId) } });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

/** A working agent gets asked first: putting it away stops it mid-turn. */
export function archiveAsk(taskId) {
  const t = taskOf(get(), taskId);
  if (!t || t.archived) return;
  if (t.running && (t.state === 'working' || t.state === 'starting')) openModal('archive', { taskId });
  else archive(taskId);
}

/** Out of 보관함 and straight back to work: the agent resumes the same conversation. */
export async function restore(taskId) {
  const t = taskOf(get(), taskId);
  try {
    await api('POST', `/api/tasks/${taskId}/unarchive`);
    set({ selected: taskId, view: 'inbox' });
    if (t && isLive(t) && !t.watching) await api('POST', `/api/tasks/${taskId}/resume`);
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export function newTask(projectId) {
  const s = get();
  openModal('new', { projectId: projectId ?? s.filter ?? null });
}

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

export function openFileInTask(taskId, path, line, ref = 'work') {
  set((s) => ({ openFile: { ...s.openFile, [taskId]: { path, line, ref } } }));
  setView(taskId, 'files');
}

// ------------------------------------------------------------ terminal & widgets

/** Put text into the agent's own input box (not sent; the user presses Enter). */
export async function pasteText(taskId, text) {
  try {
    await api('POST', `/api/tasks/${taskId}/paste`, { text });
    return true;
  } catch (e) {
    toast(e.message, { kind: 'err' });
    return false;
  }
}

/** Review comments and file refs go into the agent's input box for a final look. */
export async function pasteAttachments(taskId) {
  const s = get();
  const msg = buildMessage('', s.comments[taskId] || [], s.refs[taskId] || []);
  if (!msg.trim()) return false;
  if (await pasteText(taskId, msg)) {
    set((st) => ({ comments: { ...st.comments, [taskId]: [] }, refs: { ...st.refs, [taskId]: [] } }));
    return true;
  }
  return false;
}

export async function choose(taskId, key) {
  try {
    await api('POST', `/api/tasks/${taskId}/choose`, { key });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

/** Quick reply from a widget: same snapshot + undo banner as any other send. */
export async function quickSend(taskId, text) {
  const t = taskOf(get(), taskId);
  if (!t || !text.trim()) return false;
  try {
    const m = await api('POST', `/api/tasks/${taskId}/send`, { text });
    if (t.watching) {
      toast('Codex 세션 대기열에 넣었어요', { kind: 'room', projectId: t.projectId });
      return true;
    }
    showBanner({ kind: 'send', taskId, msgId: m.id, projectId: t.projectId, text, restore: { text, comments: [], refs: [] } });
    return true;
  } catch (e) {
    toast(e.message, { kind: 'err' });
    return false;
  }
}

export function openTask(taskId) {
  set({ selected: taskId, view: 'inbox' });
}

/** Turn Remote Control (Claude app on a phone) on or off for a task. */
export async function setRemote(taskId, on) {
  try {
    const r = await api('POST', `/api/tasks/${taskId}/remote`, { on });
    const t = taskOf(get(), taskId);
    if (on) toast(r.applied === 'now' ? '폰의 Claude 앱 · Code 탭에서 이 세션을 열 수 있어요' : r.hint || '다음에 세션을 시작할 때 폰과 연결해요', { kind: 'room', projectId: t?.projectId, ms: 6000 });
    else toast(r.applied === 'now' ? '폰 연결을 껐어요' : '다음에 세션을 시작할 때부터 폰과 연결하지 않아요', { projectId: t?.projectId });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

/** Open an existing agent session (another terminal, background, or a past conversation) as a task. */
export async function importSession(s, mode) {
  try {
    const t = await api('POST', '/api/tasks', { import: { agent: s.agent, sessionId: s.sessionId, mode } });
    set({ selected: t.id, modal: null, view: 'inbox' });
    setView(t.id, 'chat');
    const p = projectOf(get(), t.projectId);
    const how = t.imported?.mode === 'fork' ? '복사본으로 열었어요 · 원래 세션은 그대로예요' : t.imported?.mode === 'takeover' ? '원래 세션을 멈추고 여기서 이어받았어요' : '여기서 이어서 열었어요';
    toast(`${p?.name || ''} · ${how}`, { kind: 'room', projectId: t.projectId, ms: 6000 });
    return t;
  } catch (e) {
    toast(e.message, { kind: 'err' });
    return null;
  }
}

export function setWidget(taskId, patch) {
  set((s) => ({ widgets: { ...s.widgets, [taskId]: { ...(s.widgets[taskId] || {}), ...patch } } }));
}
