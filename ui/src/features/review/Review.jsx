import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../../api.js';
import { useStore, toast } from '../../store.js';
import { loadMonaco, editorOptions } from '../../monaco.js';
import { langOf } from '../../util.js';
import { addComment, openFileInTask } from '../../actions.js';
import { focusComposer } from '../../app/focus.js';
import { I } from '../../ui/bits.jsx';

const KIND = { A: '+', M: '~', D: '−', T: '~' };

export function Review({ task, project }) {
  const [files, setFiles] = useState(null);
  const [sel, setSel] = useState(null);
  const [inline, setInline] = useState(() => window.innerWidth < 1200);
  const comments = useStore((s) => s.comments[task.id] || []);
  const sig = `${task.id}:${task.changes.files}:${task.changes.adds}:${task.changes.dels}:${task.state}`;

  useEffect(() => {
    let alive = true;
    api('GET', `/api/tasks/${task.id}/changes`)
      .then((r) => {
        if (!alive) return;
        setFiles(r.files);
        setSel((cur) => (cur && r.files.some((f) => f.path === cur) ? cur : r.files[0]?.path || null));
      })
      .catch((e) => toast(e.message, { kind: 'err' }));
    return () => {
      alive = false;
    };
  }, [sig]);

  if (files && !files.length) {
    return (
      <div class="room-body">
        <div class="overlay-msg" style="background:none">
          <div>
            <h3 style="margin:0">아직 바뀐 파일이 없어요</h3>
            <p>에이전트가 파일을 고치면 여기서 한 줄씩 보고 코멘트를 달 수 있어요.</p>
          </div>
        </div>
      </div>
    );
  }
  const f = files?.find((x) => x.path === sel);
  const commented = new Set(comments.map((c) => c.path));
  return (
    <div class="room-body">
      <div class="split review">
        <div class="filelist scroll" role="listbox" aria-label="바뀐 파일">
          {(files || []).map((x, k, all) => (
            <Fragment key={x.path}>
            {task.multi && x.repo && x.repo !== all[k - 1]?.repo && (
              <div class="repo-h" key={'h' + x.repo}>
                <I n="git-branch" /> {x.repo}
                <span>{all.filter((y) => y.repo === x.repo).length}</span>
              </div>
            )}
            <button key={x.path} class={`frow ${x.path === sel ? 'sel' : ''}`} onClick={() => setSel(x.path)} role="option" aria-selected={x.path === sel} title={x.path}>
              <span class="k">{KIND[x.status] || x.status}</span>
              <span class="n">
                <span>{x.path}</span>
              </span>
              <span class="stat">
                {x.adds > 0 && <span class="a">+{x.adds}</span>}
                {x.dels > 0 && <span class="d">−{x.dels}</span>}
                {commented.has(x.path) && <span class="c" title="코멘트 있음" />}
              </span>
            </button>
            </Fragment>
          ))}
        </div>
        <div class="editor-col">
          <div class="editor-bar">
            <span class="path">{f ? <b>{f.path}</b> : ''}</span>
            <button class="btn ghost sm" onClick={() => setInline((v) => !v)} title="보기 방식 바꾸기">
              <I n={inline ? 'layout-columns' : 'layout-rows'} /> {inline ? '나란히 보기' : '한 줄로 보기'}
            </button>
            {f && f.status !== 'D' && (
              <button class="btn ghost sm" onClick={() => openFileInTask(task.id, f.path, 1)} title="파일 전체 보기">
                <I n="file-text" /> 전체
              </button>
            )}
          </div>
          {f && <DiffEditor key={task.id} task={task} file={f} inline={inline} comments={comments.filter((c) => c.path === f.path)} />}
        </div>
      </div>
    </div>
  );
}

function DiffEditor({ task, file, inline, comments }) {
  const host = useRef();
  const st = useRef({});
  const [act, setAct] = useState(null); // {x,y,start,end}
  const [pop, setPop] = useState(null); // {x,y,start,end}

  useEffect(() => {
    let disposed = false;
    loadMonaco().then((monaco) => {
      if (disposed) return;
      const diff = monaco.editor.createDiffEditor(host.current.firstChild, {
        ...editorOptions,
        renderSideBySide: !inline,
        useInlineViewWhenSpaceIsLimited: false,
        originalEditable: false,
        enableSplitViewResizing: true,
        renderOverviewRuler: false,
        hideUnchangedRegions: { enabled: true, contextLineCount: 4, minimumLineCount: 6, revealLineCount: 12 },
        diffAlgorithm: 'advanced',
      });
      st.current = { monaco, diff, decos: diff.getModifiedEditor().createDecorationsCollection(), hover: diff.getModifiedEditor().createDecorationsCollection() };
      const ed = diff.getModifiedEditor();
      let hoverLine = 0;
      ed.onMouseMove((e) => {
        const ln = e.target.position?.lineNumber || 0;
        if (ln === hoverLine) return;
        hoverLine = ln;
        st.current.hover.set(ln ? [{ range: new monaco.Range(ln, 1, ln, 1), options: { glyphMarginClassName: 'cmt-add', glyphMarginHoverMessage: { value: '코멘트 달기' } } }] : []);
      });
      ed.onMouseLeave(() => {
        hoverLine = 0;
        st.current.hover.set([]);
      });
      ed.onDidChangeCursorSelection(() => placeAction());
      ed.onDidScrollChange(() => placeAction());
      ed.onMouseDown((e) => {
        const T = monaco.editor.MouseTargetType;
        if (e.target.type === T.GUTTER_GLYPH_MARGIN || e.target.type === T.GUTTER_LINE_NUMBERS) {
          const ln = e.target.position?.lineNumber;
          if (ln) openPop(ln, ln);
        }
      });
      ed.addCommand(monaco.KeyCode.KeyC, () => {
        const s = ed.getSelection();
        if (s) openPop(s.startLineNumber, Math.max(s.startLineNumber, s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber));
      });
      load();
    });
    return () => {
      disposed = true;
      const { diff } = st.current;
      if (diff) {
        const m = diff.getModel();
        diff.dispose();
        m?.original?.dispose();
        m?.modified?.dispose();
      }
    };
  }, []);

  useEffect(() => {
    st.current.diff?.updateOptions({ renderSideBySide: !inline });
  }, [inline]);

  useEffect(() => {
    if (st.current.diff) load();
  }, [file.path, file.adds, file.dels]);

  useEffect(() => decorate(), [comments, file.path]);

  async function load() {
    const { monaco, diff } = st.current;
    if (!monaco) return;
    const q = encodeURIComponent(file.path);
    const [base, work] = await Promise.all([
      file.status === 'A' ? { content: '' } : api('GET', `/api/tasks/${task.id}/file?path=${q}&ref=base`),
      file.status === 'D' ? { content: '' } : api('GET', `/api/tasks/${task.id}/file?path=${q}&ref=work`),
    ]).catch((e) => {
      toast(e.message, { kind: 'err' });
      return [{ content: '' }, { content: '' }];
    });
    const lang = langOf(file.path);
    const note = (r) => (r.binary ? '(바이너리 파일)' : r.tooLarge ? '(파일이 너무 커요)' : r.content ?? '');
    const old = diff.getModel();
    diff.setModel({ original: monaco.editor.createModel(note(base), lang), modified: monaco.editor.createModel(note(work), lang) });
    old?.original?.dispose();
    old?.modified?.dispose();
    setAct(null);
    setPop(null);
    decorate();
  }

  function decorate() {
    const { monaco, decos } = st.current;
    if (!monaco || !decos) return;
    decos.set(
      comments.map((c) => ({
        range: new monaco.Range(c.start, 1, c.end, 1),
        options: { isWholeLine: true, className: 'cmt-line', glyphMarginClassName: 'cmt-glyph', glyphMarginHoverMessage: { value: c.text } },
      }))
    );
  }

  function coords(line) {
    const ed = st.current.diff.getModifiedEditor();
    const p = ed.getScrolledVisiblePosition({ lineNumber: line, column: 1 });
    const dom = ed.getDomNode().getBoundingClientRect();
    const hostR = host.current.getBoundingClientRect();
    if (!p) return null;
    return { x: dom.left - hostR.left + Math.min(dom.width - 360, 60), y: p.top + p.height + 4 };
  }

  function placeAction() {
    const ed = st.current.diff?.getModifiedEditor();
    if (!ed) return;
    const s = ed.getSelection();
    if (!s || s.isEmpty()) return setAct(null);
    const end = s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber;
    const c = coords(end);
    setAct(c ? { ...c, start: s.startLineNumber, end } : null);
  }

  function openPop(start, end) {
    const c = coords(end);
    if (!c) return;
    setAct(null);
    setPop({ ...c, start, end });
  }

  return (
    <div class="monaco-host" ref={host}>
      <div />
      {act && !pop && (
        <button class="float-act" style={{ left: act.x + 'px', top: act.y + 'px' }} onMouseDown={(e) => e.preventDefault()} onClick={() => openPop(act.start, act.end)}>
          <I n="message-plus" /> 코멘트 <kbd style="background:rgba(0,0,0,.18);border-color:transparent;color:inherit">C</kbd>
        </button>
      )}
      {pop && (
        <CommentPop
          pop={pop}
          path={file.path}
          onCancel={() => setPop(null)}
          onSave={(text) => {
            addComment(task.id, { path: file.path, start: pop.start, end: pop.end, text });
            setPop(null);
          }}
        />
      )}
    </div>
  );
}

function CommentPop({ pop, path, onCancel, onSave }) {
  const [v, setV] = useState('');
  const ta = useRef();
  useEffect(() => ta.current?.focus(), []);
  return (
    <div class="comment-pop" style={{ left: Math.max(8, pop.x) + 'px', top: pop.y + 'px' }}>
      <div class="lbl">
        {path.split('/').pop()} {pop.start === pop.end ? `${pop.start}행` : `${pop.start}–${pop.end}행`}에 코멘트
      </div>
      <textarea
        ref={ta}
        value={v}
        placeholder="4xx 응답은 재시도하지 마"
        onInput={(e) => setV(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (v.trim()) onSave(v.trim());
          }
        }}
      />
      <div class="row2">
        <button class="btn sm ghost" onClick={onCancel}>
          취소
        </button>
        <button
          class="btn sm primary"
          disabled={!v.trim()}
          onClick={() => {
            onSave(v.trim());
            setTimeout(focusComposer, 0);
          }}
        >
          코멘트 달기
        </button>
      </div>
    </div>
  );
}
