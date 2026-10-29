import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api } from '../../api.js';
import { useStore, set, toast } from '../../store.js';
import { loadMonaco, editorOptions } from '../../monaco.js';
import { langOf, mod } from '../../util.js';
import { isLive } from '../../core/status.js';
import { addRef, openFileInTask, openCommand } from '../../actions.js';
import { focusComposer } from '../../app/focus.js';
import { I } from '../../ui/bits.jsx';
import { vscodeLink } from '../../util.js';

export const fileCache = new Map(); // taskId -> string[]

export async function loadFiles(taskId, force) {
  if (!force && fileCache.has(taskId)) return fileCache.get(taskId);
  const r = await api('GET', `/api/tasks/${taskId}/files`);
  fileCache.set(taskId, r.files);
  return r.files;
}

export function Files({ task, project }) {
  const s = useStore((s) => ({ open: s.openFile[task.id], treeOpen: s.treeOpen, tasks: s.tasks }));
  const [files, setFiles] = useState(fileCache.get(task.id) || null);
  const open = s.open || null;
  const ref = open?.ref || 'work';

  useEffect(() => {
    loadFiles(task.id, true)
      .then((f) => {
        setFiles(f);
        if (!open) {
          const first = f.find((p) => /^readme\.md$/i.test(p)) || f[0];
          if (first) openFileInTask(task.id, first, 1);
        }
      })
      .catch((e) => toast(e.message, { kind: 'err' }));
  }, [task.id, task.changes.files]);

  const siblings = s.tasks.filter((t) => t.projectId === task.projectId && t.id !== task.id && isLive(t) && t.isolated);
  const versions = [
    { ref: 'work', label: '이 작업' },
    { ref: 'main', label: '메인' },
    ...(task.isolated ? [{ ref: 'base', label: '시작 시점' }] : []),
    ...siblings.slice(0, 4).map((t) => ({ ref: 'task:' + t.id, label: t.title.slice(0, 14) })),
  ];

  const setRef = (r) => open && set((st) => ({ openFile: { ...st.openFile, [task.id]: { ...open, ref: r } } }));
  const absRoot = ref === 'main' ? project.path : ref.startsWith('task:') ? s.tasks.find((t) => 'task:' + t.id === ref)?.worktreeAbs : task.worktreeAbs;

  return (
    <div class="room-body">
      <div class={`split ${s.treeOpen ? '' : 'notree'}`}>
        <div class="filelist scroll tree" style={{ visibility: s.treeOpen ? 'visible' : 'hidden' }}>
          {files && <Tree files={files} current={open?.path} onOpen={(p) => openFileInTask(task.id, p, 1, ref)} />}
        </div>
        <div class="editor-col">
          <div class="editor-bar">
            <button class="btn ghost sm icon" onClick={() => set((st) => ({ treeOpen: !st.treeOpen }))} title={`파일 트리 (${mod}B)`} aria-label="파일 트리">
              <I n="layout-sidebar" />
            </button>
            <button class="btn ghost sm" onClick={() => openCommand('files')} title="파일 열기">
              <I n="search" /> <kbd>{mod}P</kbd>
            </button>
            <span class="path">{open ? <b>{open.path}</b> : '파일을 고르세요'}</span>
            <div class="seg" role="tablist" aria-label="버전">
              {versions.map((v) => (
                <button key={v.ref} class={ref === v.ref ? 'on' : ''} onClick={() => setRef(v.ref)} role="tab" aria-selected={ref === v.ref} title={v.ref.startsWith('task:') ? '같은 프로젝트의 다른 작업' : ''}>
                  {v.label}
                </button>
              ))}
            </div>
            {open && absRoot && (
              <a class="btn ghost sm" href={vscodeLink(absRoot + '/' + open.path, open.line || 1)} title="VS Code에서 열기">
                <I n="external-link" /> VS Code
              </a>
            )}
          </div>
          {open && <Viewer task={task} open={open} />}
        </div>
      </div>
    </div>
  );
}

function Viewer({ task, open }) {
  const host = useRef();
  const st = useRef({});
  const [act, setAct] = useState(null);
  const [missing, setMissing] = useState(null);

  useEffect(() => {
    let disposed = false;
    loadMonaco().then((monaco) => {
      if (disposed) return;
      const ed = monaco.editor.create(host.current.firstChild, { ...editorOptions, glyphMargin: false });
      st.current = { monaco, ed };
      ed.onDidChangeCursorSelection(() => place());
      ed.onDidScrollChange(() => place());
      ed.addCommand(monaco.KeyCode.KeyA, () => ask());
      load();
    });
    return () => {
      disposed = true;
      const m = st.current.ed?.getModel();
      st.current.ed?.dispose();
      m?.dispose();
    };
  }, []);

  useEffect(() => {
    if (st.current.ed) load();
  }, [open.path, open.ref, task.changes.adds, task.changes.dels]);

  async function load() {
    const { monaco, ed } = st.current;
    try {
      const r = await api('GET', `/api/tasks/${task.id}/file?path=${encodeURIComponent(open.path)}&ref=${encodeURIComponent(open.ref || 'work')}`);
      const text = r.binary ? '(바이너리 파일)' : r.tooLarge ? '(파일이 너무 커요)' : r.content;
      setMissing(text == null ? (open.ref === 'base' ? '시작 시점에는 없던 파일이에요' : '이 버전에는 없는 파일이에요') : null);
      const old = ed.getModel();
      ed.setModel(monaco.editor.createModel(text ?? '', langOf(open.path)));
      old?.dispose();
      if (open.line > 1) {
        ed.revealLineInCenter(open.line);
        ed.setPosition({ lineNumber: open.line, column: 1 });
      }
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  }

  function sel() {
    const s = st.current.ed?.getSelection();
    if (!s || s.isEmpty()) return null;
    const end = s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber;
    return { start: s.startLineNumber, end };
  }

  function place() {
    const ed = st.current.ed;
    const s = sel();
    if (!ed || !s) return setAct(null);
    const p = ed.getScrolledVisiblePosition({ lineNumber: s.end, column: 1 });
    setAct(p ? { x: 64, y: p.top + p.height + 4, ...s } : null);
  }

  function ask() {
    const s = sel() || { start: st.current.ed.getPosition().lineNumber, end: st.current.ed.getPosition().lineNumber };
    addRef(task.id, { path: open.path, start: s.start, end: s.end });
    setAct(null);
    setTimeout(focusComposer, 0);
  }

  return (
    <div class="monaco-host" ref={host}>
      <div />
      {missing && (
        <div class="overlay-msg" style="background:rgba(26,28,33,.6)">
          <div>
            <p style="margin:0">{missing}</p>
          </div>
        </div>
      )}
      {act && (
        <button class="float-act" style={{ left: act.x + 'px', top: act.y + 'px' }} onMouseDown={(e) => e.preventDefault()} onClick={ask}>
          <I n="message-chatbot" /> 에이전트에게 묻기 <kbd style="background:rgba(0,0,0,.18);border-color:transparent;color:inherit">A</kbd>
        </button>
      )}
    </div>
  );
}

function Tree({ files, current, onOpen }) {
  const root = useMemo(() => {
    const r = { dirs: new Map(), files: [] };
    for (const f of files) {
      const parts = f.split('/');
      let n = r;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { dirs: new Map(), files: [] });
        n = n.dirs.get(parts[i]);
      }
      n.files.push(f);
    }
    return r;
  }, [files]);
  const [openDirs, setOpenDirs] = useState(() => new Set(current ? ancestors(current) : []));
  useEffect(() => {
    if (current) setOpenDirs((s) => new Set([...s, ...ancestors(current)]));
  }, [current]);
  const toggle = (p) => setOpenDirs((s) => {
    const n = new Set(s);
    n.has(p) ? n.delete(p) : n.add(p);
    return n;
  });
  const render = (node, prefix, depth) => [
    ...[...node.dirs.keys()].sort().map((d) => {
      const p = prefix ? `${prefix}/${d}` : d;
      const isOpen = openDirs.has(p);
      return (
        <div key={p}>
          <button class="frow dir" style={{ paddingLeft: 8 + depth * 12 + 'px' }} onClick={() => toggle(p)}>
            <I n={isOpen ? 'folder-open' : 'folder'} />
            <span class="n">
              <span>{d}</span>
            </span>
          </button>
          {isOpen && render(node.dirs.get(d), p, depth + 1)}
        </div>
      );
    }),
    ...node.files.sort().map((f) => (
      <button key={f} class={`frow ${f === current ? 'sel' : ''}`} style={{ paddingLeft: 8 + depth * 12 + 'px' }} onClick={() => onOpen(f)} title={f}>
        <I n="file" />
        <span class="n">
          <span>{f.split('/').pop()}</span>
        </span>
      </button>
    )),
  ];
  return <div>{render(root, '', 0)}</div>;
}

const ancestors = (p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'));
