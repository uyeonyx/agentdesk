// ⌘K: one box for everything. Type to find a task, a command or a project; anything that isn't a
// command can start a new task right there (@ picks the project or the agent, Tab cycles projects).
// ⌘P lists the open task's files; "테마" previews themes as you move through them.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useStore, set, get, projectOf, taskOf, openModal } from '../../store.js';
import { api } from '../../api.js';
import { fuzzyFilter, isMac } from '../../util.js';
import { isLive, labelOf } from '../../core/status.js';
import { enterAction } from '../../core/sendPolicy.js';
import { createTask, openTask, startTriage, openFileInTask, toggleDrawer, stop, resume, archiveAsk, openCommand } from '../../actions.js';
import { loadFiles } from '../files/Files.jsx';
import { themeList, previewTheme, endPreview, chooseTheme, currentThemeId } from '../../app/theme.js';
import { Glyph, I, useListNav } from '../../ui/bits.jsx';
import { keyLabel } from '../../app/keys.js';

export function CommandBar() {
  const cmd = useStore((s) => s.command);
  if (!cmd) return null;
  return <Bar key={cmd.mode} mode={cmd.mode} initial={cmd.query || ''} />;
}

const close = () => set({ command: null });

function Bar({ mode: startMode, initial }) {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, filter: s.filter, selected: s.selected, agents: s.agents, prefs: s.prefs }));
  const [mode, setMode] = useState(startMode);
  // Keys typed between ⌘K and the bar appearing went to the proxy input (see openCommand).
  const [q, setQ] = useState(() => {
    const proxy = document.getElementById('cmd-proxy');
    const typed = proxy?.value || '';
    if (proxy) proxy.value = '';
    return initial + typed;
  });
  const [files, setFiles] = useState([]);
  const sel = taskOf(s, s.selected);
  // New tasks go to the filtered project, else the open task's, else the last one used.
  const [pid, setPid] = useState(() => s.filter || sel?.projectId || s.prefs.lastProject || s.projects[0]?.id);
  const [agent, setAgent] = useState(() => s.prefs.agent || 'claude');
  const project = projectOf(s, pid);
  const input = useRef();
  const themeAt = useRef(currentThemeId());

  useLayoutEffect(() => input.current?.focus(), [mode]);
  useEffect(() => {
    if (mode === 'files' && sel) loadFiles(sel.id).then(setFiles, () => {});
  }, [mode, sel?.id]);
  useEffect(() => () => mode === 'theme' && endPreview(), [mode]);

  // "@" at the end of the query: complete a project or an agent.
  const at = q.match(/(?:^|\s)@(\S*)$/);
  const items = useMemo(() => {
    if (mode === 'files') return fuzzyFilter(q, files, (f) => f, 50).map((f) => ({ id: f, icon: 'file', label: f.split('/').pop(), sub: f, run: () => (openFileInTask(sel.id, f), close()) }));
    if (mode === 'theme')
      return fuzzyFilter(q, themeList(), (t) => t.name + ' ' + (t.kind === 'dark' ? '다크 어둡게' : '라이트 밝게'), 80).map((t) => ({
        id: t.id,
        icon: t.kind === 'dark' ? 'moon' : 'sun',
        label: t.name,
        sub: t.kind === 'dark' ? '다크' : '라이트',
        swatch: t,
        run: () => (chooseTheme(t.id), close()),
      }));
    if (at) {
      const w = at[1].toLowerCase();
      const ags = Object.entries(s.agents || {})
        .filter(([k, a]) => a.available !== false && (k.startsWith(w) || (a.label || '').toLowerCase().startsWith(w)))
        .map(([k, a]) => ({ id: 'agent:' + k, icon: 'terminal-2', label: a.label || k, sub: '에이전트', run: () => (setAgent(k), setQ(q.replace(/@\S*$/, ''))) }));
      const ps = fuzzyFilter(w, s.projects, (p) => p.name, 8).map((p) => ({ id: 'p:' + p.id, project: p, label: p.name, sub: '프로젝트', run: () => (setPid(p.id), setQ(q.replace(/@\S*$/, ''))) }));
      return [...ps, ...ags];
    }
    const out = [];
    const text = q.trim();
    const newRow = { id: 'new', icon: 'plus', label: text ? text : '무엇을 시킬까요?', sub: project ? `${project.name}에서 새 작업` : '프로젝트를 먼저 추가해 주세요', isNew: true, run: () => start() };
    if (mode === 'new') return [newRow];
    const tasks = fuzzyFilter(text, s.tasks.filter((t) => !t.archived), (t) => `${t.title} ${projectOf(s, t.projectId)?.name || ''}`, text ? 12 : 8).map((t) => ({
      id: 't:' + t.id,
      task: t,
      project: projectOf(s, t.projectId),
      label: t.title,
      sub: `${projectOf(s, t.projectId)?.name || ''} · ${labelOf(t)}`,
      run: () => (openTask(t.id), close()),
    }));
    const cmds = fuzzyFilter(text, commands(sel), (c) => c.label + ' ' + (c.keys || ''), text ? 8 : 12);
    const projs = text ? fuzzyFilter(text, s.projects, (p) => p.name, 4).map((p) => ({ id: 'pp:' + p.id, project: p, label: p.name, sub: '이 프로젝트만 보기', run: () => (set({ filter: p.id, screen: 'task' }), close()) })) : [];
    if (!text) return [...cmds, ...tasks];
    // Typing a command's name runs the command; anything else is most likely something to do.
    const named = (x) => x.label.toLowerCase().includes(text.toLowerCase());
    if (cmds.some(named) || tasks.some(named) || projs.some(named)) out.push(...cmds.filter(named), ...tasks.filter(named), ...projs.filter(named), newRow, ...cmds.filter((x) => !named(x)), ...tasks.filter((x) => !named(x)));
    else out.push(newRow, ...tasks, ...cmds, ...projs);
    return out;
  }, [mode, q, files, s.tasks, s.projects, pid, agent, sel?.id]);

  const start = () => {
    const text = q.trim();
    if (!text || !project) return;
    api('PATCH', '/api/prefs', { lastProject: project.id, agent }).catch(() => {});
    createTask(project.id, agent, text);
  };
  const [active, setActive, onNav] = useListNav(items.length, (i) => items[i]?.run());

  useEffect(() => {
    setActive(0);
  }, [q, mode]);
  useEffect(() => {
    if (mode === 'theme' && items[active]) previewTheme(items[active].id);
  }, [mode, active, items]);

  const onKeyDown = (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (at) return setQ(q.replace(/@\S*$/, ''));
      if (mode === 'theme') endPreview();
      return close();
    }
    if (e.key === 'Tab' && !at && (mode === 'new' || items[active]?.isNew) && s.projects.length) {
      e.preventDefault();
      const i = s.projects.findIndex((p) => p.id === pid);
      setPid(s.projects[(i + (e.shiftKey ? -1 : 1) + s.projects.length) % s.projects.length].id);
      return;
    }
    if (e.key === 'Backspace' && !q && mode !== 'all') {
      e.preventDefault();
      if (mode === 'theme') endPreview();
      return setMode('all');
    }
    if (e.key === 'Enter' && items[active]?.isNew) {
      const a = enterAction(e, { careful: !!project?.careful });
      e.preventDefault();
      if (a === 'send') start();
      return;
    }
    onNav(e);
  };

  const placeholder = { all: '찾기, 명령, 또는 새로 시킬 일', new: '무엇을 시킬까요? · @로 프로젝트·에이전트, Tab으로 프로젝트 바꾸기', files: '파일 이름', theme: '테마 찾기' }[mode];
  const showPills = mode === 'new' || (mode === 'all' && q.trim() && items[active]?.isNew);

  return (
    <div class="scrim cmd-scrim" onMouseDown={(e) => e.target === e.currentTarget && (mode === 'theme' && endPreview(), close())}>
      <div class="cmdbar glass-3" role="dialog" aria-label="명령" data-testid="command-bar">
        <div class="cb-in">
          {mode !== 'all' && (
            <span class="cb-mode">
              <I n={{ new: 'plus', files: 'file', theme: 'palette' }[mode]} /> {{ new: '새 작업', files: '파일', theme: '테마' }[mode]}
            </span>
          )}
          {showPills && project && (
            <span class="cb-pills">
              <button class="cb-pill" onClick={() => setQ(q + (q && !q.endsWith(' ') ? ' ' : '') + '@')} data-tip="다른 프로젝트 · Tab" style={{ '--room': project.color }}>
                <Glyph project={project} size={16} /> {project.name}
              </button>
              <button class="cb-pill" onClick={() => setAgent(agent === 'codex' ? 'claude' : 'codex')} data-tip="에이전트 바꾸기">
                {agent === 'codex' ? 'Codex' : 'Claude Code'}
              </button>
            </span>
          )}
          <input
            ref={input}
            value={q}
            placeholder={placeholder}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="cb-list"
            aria-activedescendant={items[active] ? `cb-${active}` : undefined}
            spellcheck={false}
          />
        </div>
        <div class="cb-list scroll" id="cb-list" role="listbox">
          {items.map((it, i) => (
            <button key={it.id} id={`cb-${i}`} class={`li cb-row ${i === active ? 'on' : ''} ${it.isNew ? 'new' : ''}`} role="option" aria-selected={i === active} onMouseMove={() => i !== active && setActive(i)} onClick={() => it.run()}>
              {it.project ? <Glyph project={it.project} size={20} task={it.task} /> : it.swatch ? <Swatch t={it.swatch} /> : <I n={it.icon} />}
              <span class="m">
                {it.label}
                {it.sub && <small>{it.sub}</small>}
              </span>
              {it.isNew ? <kbd>{project?.careful ? (isMac ? '⌘↵' : 'Ctrl+↵') : '↵'}</kbd> : it.keys ? <kbd>{it.keys}</kbd> : it.swatch && it.id === themeAt.current ? <I n="check" /> : <span />}
            </button>
          ))}
          {!items.length && <div class="cb-empty">맞는 게 없어요</div>}
        </div>
      </div>
    </div>
  );
}

function Swatch({ t }) {
  const c = t.preview || {};
  return (
    <span class="swatch" style={{ background: c.bg }}>
      <i style={{ background: c.accent }} />
      <i style={{ background: c.ok }} />
      <i style={{ background: c.warn }} />
    </span>
  );
}

/** Commands, the selected task's first. */
function commands(t) {
  const go = (fn) => () => {
    close();
    fn();
  };
  const list = [];
  if (t && isLive(t)) {
    if (t.running) list.push({ id: 'c:stop', icon: 'player-stop', label: '세션 중지', run: go(() => stop(t.id)) });
    else if (!t.watching) list.push({ id: 'c:resume', icon: 'player-play', label: '재개', run: go(() => resume(t.id)) });
    if (t.isolated && t.changes?.files) {
      list.push({ id: 'c:merge', icon: 'git-merge', label: '머지', run: go(() => openModal('merge', { taskId: t.id })) });
      list.push({ id: 'c:pr', icon: 'git-pull-request', label: 'PR 만들기', run: go(() => openModal('pr', { taskId: t.id })) });
    }
    list.push({ id: 'c:term', icon: 'terminal-2', label: '원본 터미널', keys: keyLabel('drawer'), run: go(() => toggleDrawer('agent')) });
    list.push({ id: 'c:shell', icon: 'terminal', label: '셸', keys: keyLabel('shell'), run: go(() => toggleDrawer('shell')) });
    list.push({ id: 'c:rename', icon: 'pencil', label: '이름 바꾸기', run: go(() => openModal('rename', { taskId: t.id })) });
    list.push({ id: 'c:archive', icon: 'archive', label: '보관', keys: 'E', run: go(() => archiveAsk(t.id)) });
    list.push({ id: 'c:discard', icon: 'trash', label: '버리기…', run: go(() => openModal('discard', { taskId: t.id })) });
  }
  list.push(
    { id: 'c:new', icon: 'plus', label: '새 작업', keys: keyLabel('new'), run: () => openCommand('new') },
    { id: 'c:triage', icon: 'player-track-next', label: '차례로 처리', keys: keyLabel('triage'), run: go(startTriage) },
    { id: 'c:overview', icon: 'layout-dashboard', label: '관제탑', keys: keyLabel('overview'), run: go(() => set({ screen: get().screen === 'overview' ? 'task' : 'overview' })) },
    { id: 'c:theme', icon: 'palette', label: '테마 바꾸기', run: () => openCommand('theme') },
    { id: 'c:import', icon: 'history', label: '세션 불러오기', run: go(() => openModal('import', {})) },
    { id: 'c:add', icon: 'folder-plus', label: '프로젝트 추가', run: go(() => openModal('addProject')) },
    { id: 'c:shelf', icon: 'archive', label: '보관함', run: go(() => set({ railView: 'shelf', screen: 'task' })) },
    { id: 'c:files', icon: 'file-search', label: '파일 열기', keys: keyLabel('files'), run: () => openCommand('files') },
    { id: 'c:settings', icon: 'settings', label: '설정', keys: keyLabel('settings'), run: go(() => set({ screen: 'settings' })) },
    { id: 'c:keys', icon: 'keyboard', label: '단축키', keys: '?', run: go(() => set({ cheat: true })) }
  );
  return list;
}
