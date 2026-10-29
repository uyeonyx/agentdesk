// The conversation, drawn by the app from the agent's own transcript: what I said, what it
// answered (as a document), and its tool calls folded into runs I can open.
import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useConversation } from '../../core/conversation.js';
import { groupTurns, latestPlan, duration } from '../../core/turns.js';
import { useStore, set, get } from '../../store.js';
import { isBlocked } from '../../core/status.js';
import { openFileInTask, undoMessage } from '../../actions.js';
import { vscodeLink, isMac, SOURCE_LABEL } from '../../util.js';
import { Markdown } from '../../md/Markdown.jsx';
import { I, ago } from '../../ui/bits.jsx';
import { Run, Subagent } from './Run.jsx';
import { PlanStrip } from './PlanStrip.jsx';

const FIRST_TURNS = 40;
const WAIT_LABEL = { permission: '허락을 기다려요', question: '답을 기다려요', plan: '승인을 기다려요', elicitation: '답을 기다려요', menu: '선택을 기다려요' };
// Scroll positions per task, so coming back lands where I left.
const scrolls = new Map();

export function Conversation({ task, project, dock }) {
  const c = useConversation(task.id);
  const top = useMemo(() => c.list.filter((e) => !e.parent), [c.ver, c.list]);
  const turns = useMemo(() => groupTurns(top), [top]);
  const plan = useMemo(() => latestPlan(top), [top]);
  const [shown, setShown] = useState(FIRST_TURNS);
  const box = useRef();
  const stick = useRef(true);
  const [fresh, setFresh] = useState(0);
  const lastCount = useRef(0);
  const messages = task.messages || [];

  // Opening a task: back to where I was, or to the start of its last reply (read from the top).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !c.loaded) return;
    const saved = scrolls.get(task.id);
    if (saved != null) {
      el.scrollTop = saved;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    } else {
      const last = el.querySelector('.turn:last-of-type .reply:last-of-type');
      if (last && last.offsetHeight > el.clientHeight * 0.6) el.scrollTop = last.offsetTop - 24;
      else el.scrollTop = el.scrollHeight;
      stick.current = true;
    }
    lastCount.current = c.list.length;
    setFresh(0);
  }, [task.id, c.loaded]);

  // New entries: follow them if I was at the bottom, else count them on a pill.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const added = c.list.length - lastCount.current;
    lastCount.current = c.list.length;
    if (stick.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setFresh((n) => n + added);
  }, [c.ver]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (stick.current && fresh) setFresh(0);
    scrolls.set(task.id, el.scrollTop);
  };
  const toBottom = () => {
    const el = box.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setFresh(0);
  };

  const onFileRef = (path, line, end) => (isMac ? window.event?.metaKey : window.event?.ctrlKey) ? window.open(vscodeLink(task.worktreeAbs + '/' + path, line), '_blank') : openFileInTask(task.id, path, line);
  const visible = turns.slice(Math.max(0, turns.length - shown));

  return (
    <div class="convo" data-testid="conversation">
      {plan && <PlanStrip items={plan} />}
      <div class="convo-scroll scroll" ref={box} onScroll={onScroll} role="log" aria-label="대화">
        <div class="convo-col">
          {(turns.length > shown || c.more) && (
            <button
              class="btn sm ghost earlier"
              onClick={() => {
                if (turns.length > shown) setShown((n) => n + FIRST_TURNS);
                else c.earlier();
              }}
            >
              <I n="arrow-up" /> 이전 대화 더 보기
            </button>
          )}
          {!c.loaded && <Skeleton />}
          {c.loaded && !top.length && <ConvoEmpty task={task} />}
          {visible.map((t, i) => (
            <Turn key={t.id} turn={t} task={task} messages={messages} last={i === visible.length - 1} onFileRef={onFileRef} entries={c.list} ver={c.ver} />
          ))}
        </div>
      </div>
      {fresh > 0 && (
        <button class="fresh glass-2" onClick={toBottom}>
          <I n="arrow-down" /> 새 내용 <span class="num">{fresh}</span>
        </button>
      )}
      {dock}
    </div>
  );
}

const Turn = memo(function Turn({ turn, task, messages, last, onFileRef, entries }) {
  return (
    <article class="turn">
      {turn.user && <UserMsg e={turn.user} task={task} messages={messages} />}
      {turn.items.map((it) => {
        if (it.type === 'reply') return <Reply key={it.id} e={it.e} onFileRef={onFileRef} />;
        if (it.type === 'run') return <Run key={it.id} tools={it.tools} task={task} live={last && task.running} waiting={last && isBlocked(task) ? WAIT_LABEL[task.prompt?.kind] || '답을 기다려요' : ''} />;
        if (it.type === 'agent') return <Subagent key={it.id} e={it.e} task={task} entries={entries} onFileRef={onFileRef} />;
        if (it.type === 'thinking') return <Thinking key={it.id} e={it.e} />;
        if (it.type === 'compact')
          return (
            <div key={it.id} class="notice compact">
              <I n="arrows-minimize" /> 대화를 요약해서 이어가요{it.e.pre ? <span class="num"> · {Math.round(it.e.pre / 1000)}k 토큰</span> : ''}
            </div>
          );
        if (it.type === 'notice')
          return (
            <div key={it.id} class={`notice ${it.e.level === 'warn' ? 'warn' : ''}`}>
              <I n={it.e.level === 'warn' ? 'alert-triangle' : 'info-circle'} /> {it.e.text}
            </div>
          );
        return null;
      })}
      {turn.end && <TurnEnd turn={turn} />}
    </article>
  );
});

function UserMsg({ e, task, messages }) {
  const m = (e.msgId && messages.find((x) => x.id === e.msgId)) || messages.findLast?.((x) => x.text && e.text && x.text.slice(0, 200) === e.text.slice(0, 200));
  const source = m?.source && !['composer', 'start'].includes(m.source) ? SOURCE_LABEL[m.source] || '' : '';
  const copy = () => window.desk.copy(e.text);
  const rewrite = () => set((s) => ({ drafts: { ...s.drafts, [task.id]: e.text } }));
  return (
    <div class={`umsg ${m?.undone ? 'undone' : ''}`} data-kind="user">
      <div class="umsg-meta">
        <span class="num">{ago(e.at)}</span>
        {source && <span class="src">{source}에서</span>}
        {m?.undone && <span class="src">되돌림</span>}
        <span class="sp" />
        <span class="umsg-act">
          {m?.canUndo && (
            <button class="ibtn sm" onClick={() => undoMessage(task.id, m.id, { text: m.text })} data-tip="되돌리기 · 에이전트를 멈추고 파일을 이 지시 전으로">
              <I n="arrow-back-up" />
            </button>
          )}
          <button class="ibtn sm" onClick={rewrite} data-tip="입력창에 다시 쓰기">
            <I n="pencil" />
          </button>
          <button class="ibtn sm" onClick={copy} data-tip="복사">
            <I n="copy" />
          </button>
        </span>
      </div>
      <div class="umsg-text selectable">{e.text}</div>
    </div>
  );
}

function Reply({ e, onFileRef }) {
  return (
    <div class="reply" data-kind="reply">
      <Markdown md={e.md || e.text || ''} onFileRef={onFileRef} />
    </div>
  );
}

function Thinking({ e }) {
  const [open, setOpen] = useState(false);
  const first = String(e.md || e.text || '').split('\n')[0];
  return (
    <div class={`thinking ${open ? 'open' : ''}`}>
      <button class="th-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <I n="brain" /> 생각 <span class="first">{first}</span>
        <I n="chevron-down" class="chev" />
      </button>
      {open && <Markdown md={e.md || e.text || ''} compact />}
    </div>
  );
}

function TurnEnd({ turn }) {
  const files = new Map();
  for (const it of turn.items) {
    if (it.type !== 'run') continue;
    for (const t of it.tools) for (const f of t.detail?.files || []) {
      const cur = files.get(f.path) || { adds: 0, dels: 0 };
      cur.adds += f.adds || 0;
      cur.dels += f.dels || 0;
      files.set(f.path, cur);
    }
  }
  const adds = [...files.values()].reduce((a, f) => a + f.adds, 0);
  const dels = [...files.values()].reduce((a, f) => a + f.dels, 0);
  const ms = turn.end?.ms;
  if (!files.size && !ms) return null;
  return (
    <div class="turn-end">
      {files.size > 0 && (
        <span>
          파일 {files.size}개 수정 <b class="a num">+{adds}</b> <b class="d num">−{dels}</b>
        </span>
      )}
      {ms ? <span class="num">{duration(ms)}</span> : null}
      {files.size > 0 && (
        <button class="lnk" onClick={() => set((s) => ({ views: { ...s.views, [get().selected]: 'review' } }))}>
          변경 보기 <I n="arrow-right" />
        </button>
      )}
    </div>
  );
}

function ConvoEmpty({ task }) {
  return (
    <div class="empty convo-empty">
      <I n="messages" style="font-size:24px;color:var(--text-3)" />
      <p>{task.running ? '에이전트가 첫 답을 준비하고 있어요' : '이 세션의 대화 기록을 찾지 못했어요'}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div class="skeleton" aria-hidden="true">
      <i style="width:42%" />
      <i style="width:88%" />
      <i style="width:76%" />
      <i style="width:64%" />
    </div>
  );
}
