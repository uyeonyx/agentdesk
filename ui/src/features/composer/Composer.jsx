// Where I talk to the agent: a floating glass capsule under the conversation. ↵ sends (⌘↵ in a
// careful project), ⇧↵ is a new line, @ mentions a file, / runs one of the agent's commands,
// pasted images go along by path.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useStore, set, get } from '../../store.js';
import { sendMessage, attachImage, removeComment, removeRef, removeAttachment, quickSend, openDrawer } from '../../actions.js';
import { enterAction } from '../../core/sendPolicy.js';
import { isLive } from '../../core/status.js';
import { fuzzyFilter, isMac } from '../../util.js';
import { setComposer } from '../../app/focus.js';
import { loadFiles } from '../files/Files.jsx';
import { I, useListNav } from '../../ui/bits.jsx';

// Commands that open their own screen in the CLI: after sending, the raw terminal opens to show it.
const INTERACTIVE = new Set(['/model', '/config', '/mcp', '/resume', '/agents', '/permissions', '/login', '/logout', '/hooks', '/memory', '/status', '/doctor', '/ide', '/theme', '/approvals']);
const SLASH = {
  claude: [
    ['/compact', '대화를 요약해서 문맥을 비워요'],
    ['/clear', '대화를 새로 시작해요'],
    ['/model', '모델 바꾸기'],
    ['/cost', '이번 세션 비용'],
    ['/context', '문맥 사용량'],
    ['/review', '변경 리뷰'],
    ['/init', 'CLAUDE.md 만들기'],
    ['/memory', '메모리 파일 편집'],
    ['/permissions', '권한 규칙'],
    ['/mcp', 'MCP 서버'],
    ['/agents', '서브에이전트 관리'],
    ['/hooks', '훅 설정'],
    ['/config', '설정'],
    ['/status', '상태'],
  ],
  codex: [
    ['/compact', '대화를 요약해서 문맥을 비워요'],
    ['/new', '대화를 새로 시작해요'],
    ['/model', '모델 바꾸기'],
    ['/approvals', '승인 방식'],
    ['/diff', '변경 보기'],
    ['/review', '변경 리뷰'],
    ['/init', 'AGENTS.md 만들기'],
    ['/status', '상태'],
    ['/mcp', 'MCP 서버'],
  ],
};

export function Composer({ task, project, blocked }) {
  const s = useStore((s) => ({ draft: s.drafts[task.id] || '', comments: s.comments[task.id] || [], refs: s.refs[task.id] || [], images: s.attachments[task.id] || [], quick: s.settings.quickReplies }));
  const ta = useRef();
  const [busy, setBusy] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [pop, setPop] = useState(null); // { kind: 'file'|'slash', q, start }
  const careful = !!project?.careful;
  const stopped = !task.running && isLive(task) && !task.watching;
  const yourTurn = task.state === 'needs_input' && !blocked;

  useEffect(() => {
    setComposer(ta.current);
    return () => setComposer(null);
  }, [task.id]);

  // Grows with the text, up to 40% of the window.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, innerHeight * 0.4) + 'px';
  }, [s.draft, task.id]);

  const setDraft = (v) => set((st) => ({ drafts: { ...st.drafts, [task.id]: v } }));
  // A screen only the terminal can answer (trusting a folder…): typed text would pick whatever is highlighted.
  const gated = task.ask === 'terminal';
  const canSend = !gated && (!!s.draft.trim() || s.comments.length > 0 || s.images.length > 0);

  async function doSend() {
    if (!canSend || busy) return;
    const first = s.draft.trim().split(/\s/)[0];
    setBusy(true);
    const ok = await sendMessage(task.id);
    setBusy(false);
    if (ok && INTERACTIVE.has(first)) openDrawer('agent', task.id);
    ta.current?.focus();
  }

  const onInput = (e) => {
    const v = e.currentTarget.value;
    setDraft(v);
    const at = e.currentTarget.selectionStart;
    const before = v.slice(0, at);
    const m = before.match(/(^|\s)@([^\s@]*)$/);
    if (m) return setPop({ kind: 'file', q: m[2], start: at - m[2].length - 1 });
    const sl = before.match(/^\/(\S*)$/);
    if (sl) return setPop({ kind: 'slash', q: sl[1], start: 0 });
    if (pop) setPop(null);
  };

  const insert = (text) => {
    const v = s.draft;
    const at = ta.current.selectionStart;
    const next = v.slice(0, pop.start) + text + ' ' + v.slice(at);
    setDraft(next);
    setPop(null);
    requestAnimationFrame(() => {
      const pos = pop.start + text.length + 1;
      ta.current?.setSelectionRange(pos, pos);
      ta.current?.focus();
    });
  };

  const onKeyDown = (e) => {
    if (pop && popKeys.current?.(e)) return;
    if (e.key === 'Escape') {
      if (pop) {
        e.preventDefault();
        return setPop(null);
      }
      ta.current.blur();
      return;
    }
    const a = enterAction(e, { careful });
    if (!a || a === 'newline') return;
    e.preventDefault();
    if (a === 'blocked') {
      setNudge(true);
      setTimeout(() => setNudge(false), 1600);
      return;
    }
    doSend();
  };

  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) attachImage(task.id, f);
  };
  const onDrop = (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      if (f.type.startsWith('image/')) attachImage(task.id, f);
      else {
        const p = window.desk.pathOf?.(f);
        if (p) setDraft((get().drafts[task.id] || '') + (get().drafts[task.id] ? ' ' : '') + p);
      }
    }
  };

  const popKeys = useRef();
  const placeholder = task.watching ? '' : gated ? '원본 터미널에서 먼저 답해 주세요' : stopped ? '보내면 세션을 재개하고 이어서 지시해요' : yourTurn ? '답장을 적어 주세요' : task.state === 'working' ? '작업 중이에요 · 보내면 다음 지시로 이어가요' : '에이전트에게 지시하기';
  const pills = s.comments.length + s.refs.length + s.images.length;

  return (
    <div class={`composer glass-2 lens ${nudge ? 'nudge' : ''}`} data-testid="composer" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      {pills > 0 && (
        <div class="cp-pills">
          {s.comments.map((c) => (
            <span key={c.id} class="pill-chip" data-tip={c.text}>
              <I n="message" /> {c.path.split('/').pop()}:{c.start}
              <button onClick={() => removeComment(task.id, c.id)} aria-label="빼기">
                <I n="x" />
              </button>
            </span>
          ))}
          {s.refs.map((r) => (
            <span key={r.id} class="pill-chip">
              <I n="code" /> {r.path.split('/').pop()}:{r.start}
              <button onClick={() => removeRef(task.id, r.id)} aria-label="빼기">
                <I n="x" />
              </button>
            </span>
          ))}
          {s.images.map((a) => (
            <span key={a.id} class="pill-chip" data-tip={a.path}>
              <I n="photo" /> {a.name}
              <button onClick={() => removeAttachment(task.id, a.id)} aria-label="빼기">
                <I n="x" />
              </button>
            </span>
          ))}
        </div>
      )}
      {yourTurn && !s.draft && s.quick?.length > 0 && (
        <div class="cp-chips">
          {s.quick.map((q) => (
            <button key={q} class="chip" onClick={() => quickSend(task.id, q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <div class="cp-row">
        <textarea
          ref={ta}
          rows={1}
          value={s.draft}
          placeholder={placeholder}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setTimeout(() => setPop(null), 120)}
          aria-label="에이전트에게 보낼 말"
          spellcheck={false}
        />
        <button class={`send ${canSend ? 'on' : ''}`} onClick={doSend} disabled={!canSend || busy} data-tip={careful ? '보내기 (신중 모드)' : '보내기'} data-kbd={careful ? (isMac ? '⌘↵' : 'Ctrl+↵') : '↵'} aria-label="보내기">
          <I n={stopped ? 'player-play' : 'arrow-up'} />
        </button>
      </div>
      {nudge && <div class="cp-nudge">신중 모드예요 · {isMac ? '⌘↵' : 'Ctrl+↵'}로 보내요</div>}
      {pop?.kind === 'file' && <FilePop task={task} q={pop.q} onPick={(p) => insert('@' + p)} keys={popKeys} />}
      {pop?.kind === 'slash' && <SlashPop agent={task.agent} q={pop.q} onPick={(c) => insert(c)} keys={popKeys} />}
    </div>
  );
}

function FilePop({ task, q, onPick, keys }) {
  const [files, setFiles] = useState([]);
  useEffect(() => {
    loadFiles(task.id).then(setFiles, () => {});
  }, [task.id]);
  const list = useMemo(() => fuzzyFilter(q, files, (f) => f, 8), [q, files]);
  return <Pop items={list.map((f) => ({ key: f, label: f.split('/').pop(), sub: f }))} onPick={(it) => onPick(it.key)} keys={keys} empty="맞는 파일이 없어요" />;
}

function SlashPop({ agent, q, onPick, keys }) {
  const list = (SLASH[agent] || SLASH.claude).filter(([c]) => c.slice(1).startsWith(q.toLowerCase()));
  return <Pop items={list.map(([c, d]) => ({ key: c, label: c, sub: d }))} onPick={(it) => onPick(it.key)} keys={keys} empty="그런 명령은 없어요 · 그대로 보내도 돼요" />;
}

function Pop({ items, onPick, keys, empty }) {
  const [active, setActive, onKeyDown] = useListNav(items.length, (i) => items[i] && onPick(items[i]));
  // The textarea keeps focus; it hands ↑ ↓ ↵ Tab here while the list is up.
  keys.current = (e) => {
    if (!items.length) return false;
    if (e.key === 'Tab') {
      e.preventDefault();
      onPick(items[active]);
      return true;
    }
    if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
      onKeyDown(e);
      return true;
    }
    return false;
  };
  return (
    <div class="cp-pop glass-3" role="listbox">
      {!items.length && <div class="cp-pop-empty">{empty}</div>}
      {items.map((it, i) => (
        <button key={it.key} class={`li ${i === active ? 'on' : ''}`} role="option" aria-selected={i === active} onMouseDown={(e) => (e.preventDefault(), onPick(it))} onMouseEnter={() => setActive(i)}>
          <I n={it.key.startsWith('/') ? 'slash' : 'file'} />
          <span class="m">
            {it.label}
            {it.sub && it.sub !== it.label && <small>{it.sub}</small>}
          </span>
          <span />
        </button>
      ))}
    </div>
  );
}
