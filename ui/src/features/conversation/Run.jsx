// Tool calls between two replies, folded into one line ("명령 3 · 읽기 5 · 수정 2 · 12초") with the
// files they changed always in view. Open it for each call: the command and its output, the diff.
import { useMemo, useState } from 'preact/hooks';
import { runSummary, groupTurns, duration } from '../../core/turns.js';
import { fullEntry } from '../../core/conversation.js';
import { openFileInTask } from '../../actions.js';
import { set } from '../../store.js';
import { Markdown } from '../../md/Markdown.jsx';
import { Ansi } from '../../md/Ansi.jsx';
import { Diff } from '../../md/Diff.jsx';
import { I, Spinner, useNow } from '../../ui/bits.jsx';

export const CAT_ICON = { cmd: 'terminal-2', read: 'file-text', edit: 'pencil', search: 'search', web: 'world', mcp: 'plug', agent: 'users', ask: 'message-circle-question', plan: 'list-check', code: 'code', tool: 'tool', todo: 'checklist' };

export function Run({ tools, task, live, waiting }) {
  const sum = useMemo(() => runSummary(tools), [tools]);
  const [open, setOpen] = useState(null);
  // Failures open by themselves; everything else stays folded until asked.
  const isOpen = open ?? sum.fail > 0;
  const now = useNow();
  const running = live && sum.running;
  const cats = [...new Set(tools.filter((t) => t.kind !== 'todo').map((t) => t.cat || 'tool'))].slice(0, 4);
  return (
    <div class={`run ${isOpen ? 'open' : ''} ${sum.fail ? 'failed' : ''} ${running ? 'live' : ''}`} data-kind="run">
      <button class="run-h" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
        <span class="run-icons">
          {cats.map((c) => (
            <I key={c} n={CAT_ICON[c] || 'tool'} />
          ))}
        </span>
        <span class="run-what">{sum.parts.join(' · ') || '할 일 갱신'}</span>
        {sum.fail > 0 && <span class="run-fail">실패 {sum.fail}</span>}
        {(running ? now - running.at : sum.ms) > 0 && <span class="run-ms num">{duration(running ? now - running.at : sum.ms)}</span>}
        <I n="chevron-down" class="chev" />
      </button>
      {sum.files.length > 0 && !isOpen && (
        <div class="run-files">
          {sum.files.slice(0, 6).map((f) => (
            <button key={f.path} class="fchip" onClick={() => openFileInTask(task.id, f.path)} data-tip={f.path}>
              <I n="file-code" />
              <span class="fn">{f.path.split('/').pop()}</span>
              <b class="a num">+{f.adds}</b>
              <b class="d num">−{f.dels}</b>
            </button>
          ))}
          {sum.files.length > 6 && <span class="more">+{sum.files.length - 6}</span>}
        </div>
      )}
      {running && !isOpen && (
        <div class={`run-now ${waiting ? 'wait' : ''}`}>
          {waiting ? <I n="hand-stop" /> : <Spinner />}
          <span class={waiting ? '' : 'shimmer'}>
            {waiting ? `${waiting} · ` : ''}
            {running.title}
          </span>
        </div>
      )}
      {isOpen && (
        <div class="run-b">
          {tools.map((t) => (
            <ToolRow key={t.id} t={waiting && t.st === 'run' ? { ...t, st: 'wait' } : t} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

const ST = {
  run: { icon: null, label: '진행 중' },
  wait: { icon: 'hand-stop', label: '허락을 기다림' },
  ok: { icon: 'check', label: '' },
  err: { icon: 'x', label: '실패' },
  denied: { icon: 'ban', label: '거절됨' },
  stopped: { icon: 'player-stop', label: '중단됨' },
};

function ToolRow({ t, task }) {
  const [open, setOpen] = useState(t.st === 'err');
  const [full, setFull] = useState(null);
  if (t.kind === 'todo') return <TodoRow t={t} />;
  const st = ST[t.st] || ST.ok;
  const d = full?.detail || t.detail || {};
  const expandable = !!(d.out || d.files?.length || d.command || d.questions || d.plan || d.input || d.url || d.query || d.result);
  const loadFull = async () => {
    try {
      const r = await fullEntry(task.id, t.id);
      setFull(r.entry);
    } catch {}
  };
  return (
    <div class={`tool st-${t.st} ${open ? 'open' : ''}`} data-cat={t.cat}>
      <button class="tool-h" onClick={() => expandable && setOpen(!open)} aria-expanded={expandable ? open : undefined} disabled={!expandable}>
        <I n={CAT_ICON[t.cat] || 'tool'} class="ci" />
        <span class="tt">{t.title || t.tool}</span>
        {t.ms ? <span class="tm num">{duration(t.ms)}</span> : null}
        <span class="ts" data-tip={st.label || undefined}>{t.st === 'run' ? <Spinner /> : st.icon ? <I n={st.icon} /> : null}</span>
      </button>
      {open && (
        <div class="tool-b">
          {t.cat === 'cmd' && (
            <>
              {d.command && (
                <pre class="cmdline selectable">
                  <span class="ps">$</span> {d.command}
                </pre>
              )}
              {d.desc && <div class="tool-desc">{d.desc}</div>}
              {d.out && (
                <div class="out">
                  <Ansi text={d.out} />
                </div>
              )}
              {d.outLines > (d.out || '').split('\n').length && !full && (
                <button class="lnk" onClick={loadFull}>
                  전체 출력 보기 · <span class="num">{d.outLines}</span>줄
                </button>
              )}
              {typeof d.exit === 'number' && d.exit !== 0 && <div class="exit num">종료 코드 {d.exit}</div>}
            </>
          )}
          {d.files?.map((f) => (
            <div key={f.path} class="tool-file">
              <div class="tf-h">
                <button class="lnk" onClick={() => openFileInTask(task.id, f.path)}>
                  {f.path}
                </button>
                <b class="a num">+{f.adds}</b>
                <b class="d num">−{f.dels}</b>
                <span class="sp" />
                <button class="lnk" onClick={() => set((s) => ({ views: { ...s.views, [task.id]: 'review' } }))}>
                  변경 탭에서 보기
                </button>
              </div>
              <Diff hunks={f.hunks} path={f.path} />
            </div>
          ))}
          {d.clipped && !full && (
            <button class="lnk" onClick={loadFull}>
              diff 전체 보기
            </button>
          )}
          {t.cat === 'read' && d.path && (
            <button class="lnk" onClick={() => openFileInTask(task.id, d.path, d.from)}>
              {d.path}
              {d.from ? `:${d.from}${d.to && d.to !== d.from ? '-' + d.to : ''}` : ''}
            </button>
          )}
          {t.cat === 'search' && (
            <div class="kv">
              <span>찾은 것</span>
              <code>{d.pattern}</code>
              {d.count != null && <span class="num">결과 {d.count}개</span>}
            </div>
          )}
          {t.cat === 'web' && (d.url || d.query) && <div class="kv">{d.url ? <a href={d.url}>{d.url}</a> : <code>{d.query}</code>}</div>}
          {t.cat === 'mcp' && (
            <>
              {d.input && <pre class="json selectable">{d.input}</pre>}
              {d.out && <pre class="json selectable">{d.out}</pre>}
            </>
          )}
          {t.cat === 'ask' && d.questions && (
            <ul class="qa">
              {d.questions.map((q) => (
                <li key={q.question}>
                  <span class="q">{q.question}</span>
                  <b>{d.answers?.[q.question] || '—'}</b>
                </li>
              ))}
            </ul>
          )}
          {t.cat === 'plan' && d.plan && <Markdown md={d.plan} compact />}
        </div>
      )}
    </div>
  );
}

function TodoRow({ t }) {
  const items = t.detail?.items || [];
  const done = items.filter((x) => x.status === 'done').length;
  return (
    <div class="tool todo">
      <div class="tool-h">
        <I n="checklist" class="ci" />
        <span class="tt">
          할 일 갱신 · <span class="num">{done}/{items.length}</span>
        </span>
      </div>
    </div>
  );
}

/** A subagent: its own runs and replies nested under the call that started it. */
export function Subagent({ e, task, entries, onFileRef }) {
  const kids = useMemo(() => entries.filter((x) => x.parent === e.id), [entries, e.id]);
  const turns = useMemo(() => groupTurns(kids), [kids]);
  // A background subagent of a session that has since ended never reported back: not running.
  const running = e.st === 'run' && task.running;
  const [open, setOpen] = useState(null);
  const isOpen = open ?? running;
  const d = e.detail || {};
  const tools = kids.filter((x) => x.kind === 'tool').length;
  const now = useNow();
  return (
    <div class={`subagent ${isOpen ? 'open' : ''} ${running ? 'live' : ''}`} data-kind="agent">
      <button class="sa-h" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
        <span class="sa-ic">{running ? <Spinner /> : <I n={e.st === 'err' ? 'x' : 'users'} />}</span>
        <span class="sa-t">
          <b>{d.desc || e.title || '서브에이전트'}</b>
          <span class="sa-ty">{d.type || 'agent'}</span>
        </span>
        {tools > 0 && <span class="sa-n num">도구 {tools}</span>}
        <span class="num sa-ms">{duration(running ? now - e.at : e.ms)}</span>
        <I n="chevron-down" class="chev" />
      </button>
      {isOpen && (
        <div class="sa-b">
          {turns.flatMap((tn) =>
            tn.items.map((it) =>
              it.type === 'run' ? (
                <Run key={it.id} tools={it.tools} task={task} live={running} />
              ) : it.type === 'reply' ? (
                <div key={it.id} class="reply sub">
                  <Markdown md={it.e.md || ''} onFileRef={onFileRef} compact />
                </div>
              ) : null
            )
          )}
          {!running && d.result && (
            <div class="sa-result">
              <span class="lbl">결과</span>
              <Markdown md={d.result} onFileRef={onFileRef} compact />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
