// The app's shortcuts, all of them (see keys.js for how they're matched and shown).
import { get, set, setView } from '../store.js';
import { key } from './keys.js';
import { isBlocked } from '../core/status.js';
import { select, visibleTasks, openCommand, newTask, archiveAsk, archiveMany, clearPicks, startTriage, stepTriage, endTriage, interrupt, toggleDrawer, undoLastSend, togglePick } from '../actions.js';
import { focusComposer } from './focus.js';
import { taskOf } from '../store.js';

const G = '어디서나';
const N = '목록과 작업';
const T = '차례로 처리';

const sel = () => taskOf(get(), get().selected);

// ---------------------------------------------------------------- everywhere
key('command', { code: 'KeyK', mod: true, scope: 'global', label: '찾기·명령', group: G }, () => openCommand('all'));
key('new', { code: 'KeyN', mod: true, scope: 'global', label: '새 작업', group: G }, () => newTask());
key('files', { code: 'KeyP', mod: true, scope: 'global', label: '파일 열기', group: G }, () => (sel() ? openCommand('files') : false));
key('settings', { code: 'Comma', mod: true, scope: 'global', label: '설정', group: G }, () => set({ screen: get().screen === 'settings' ? 'task' : 'settings' }));
key('tab1', { code: 'Digit1', mod: true, scope: 'global', label: '대화', group: G }, () => (sel() ? (set({ screen: 'task' }), setView(get().selected, 'chat')) : false));
key('tab2', { code: 'Digit2', mod: true, scope: 'global', label: '변경', group: G }, () => (sel() ? (set({ screen: 'task' }), setView(get().selected, 'review')) : false));
key('tab3', { code: 'Digit3', mod: true, scope: 'global', label: '파일', group: G }, () => (sel() ? (set({ screen: 'task' }), setView(get().selected, 'files')) : false));
key('drawer', { code: 'KeyJ', mod: true, scope: 'global', label: '원본 터미널', group: G }, () => (sel() ? toggleDrawer('agent') : false));
key('shell', { code: 'Backquote', ctrl: true, scope: 'global', label: '셸', group: G, hint: '⌃`' }, () => (sel() ? toggleDrawer('shell') : false));
key('interrupt', { code: 'Period', mod: true, scope: 'global', label: '이번 턴 중단', group: G }, () => {
  const t = sel();
  if (!t?.running) return false;
  interrupt(t.id);
});
key('rail', { code: 'Backslash', mod: true, scope: 'global', label: '목록 숨기기·보이기', group: G }, () => set((s) => ({ railHidden: !s.railHidden })));
key('undo', { code: 'KeyZ', mod: true, scope: 'nav', label: '방금 보낸 것 되돌리기', group: G }, () => {
  const l = get().lastSend;
  if (!l || Date.now() - l.at > 30_000) return false;
  undoLastSend();
});

// ---------------------------------------------------------------- list & task (not while typing)
const move = (d) => {
  const list = visibleTasks();
  const i = list.findIndex((t) => t.id === get().selected);
  const n = list[Math.max(0, Math.min(list.length - 1, i + d))];
  if (n) select(n.id);
};
key('down', { code: ['KeyJ', 'ArrowDown'], label: '다음 작업', group: N }, () => (get().screen === 'overview' || get().triage ? false : move(1)));
key('up', { code: ['KeyK', 'ArrowUp'], label: '이전 작업', group: N }, () => (get().screen === 'overview' || get().triage ? false : move(-1)));
key('triage', { code: 'Space', label: '차례로 처리', group: N }, () => (get().triage ? stepTriage(1, 'skipped') : startTriage()));
key('reply', { code: ['KeyR', 'Enter'], label: '답장', group: N }, () => (get().screen === 'task' && sel() ? (focusComposer() ? undefined : false) : false));
key('archive', { code: 'KeyE', label: '보관', group: N }, () => {
  const s = get();
  if (s.screen === 'overview') return false;
  if (s.picked.length) return archiveMany(s.picked);
  if (s.selected) return archiveAsk(s.selected);
  return false;
});
key('pick', { code: 'KeyX', label: '선택', group: N }, () => (get().selected ? togglePick(get().selected) : false));
key('overview', { code: 'KeyB', label: '관제탑', group: N }, () => set({ screen: get().screen === 'overview' ? 'task' : 'overview' }));
key('newNav', { code: 'KeyN', label: '', group: N }, () => newTask());
key('find', { code: 'Slash', label: '찾기', group: N }, () => openCommand('all'));
key('help', { code: 'Slash', shift: true, label: '단축키', group: N, hint: '?' }, () => set({ cheat: !get().cheat }));
for (let i = 0; i <= 9; i++) {
  key(`filter${i}`, { code: `Digit${i}`, alt: true, label: i === 0 ? '모든 프로젝트' : i === 1 ? '프로젝트 1–9로 거르기' : '', group: N, hint: i === 1 ? (navigator.platform.includes('Mac') ? '⌥1–9' : 'Alt+1–9') : undefined }, () => {
    const p = get().projects[i - 1];
    if (i === 0) set({ filter: null });
    else if (p) set({ filter: get().filter === p.id ? null : p.id });
  });
}
key('escape', { code: 'Escape', label: '', group: N }, () => {
  const s = get();
  if (s.cheat) return set({ cheat: false });
  if (s.triage) return endTriage();
  if (s.picked.length) return clearPicks();
  if (s.drawer.open && document.activeElement?.closest?.('.drawer')) return set((st) => ({ drawer: { ...st.drawer, open: false } }));
  return false;
});

// ---------------------------------------------------------------- triage
key('skip', { code: 'KeyS', label: '넘기기', group: T }, () => (get().triage ? stepTriage(1, 'skipped') : false));
key('prev', { code: 'ArrowLeft', label: '이전', group: T }, () => (get().triage ? stepTriage(-1, null) : false));

export { isBlocked };
