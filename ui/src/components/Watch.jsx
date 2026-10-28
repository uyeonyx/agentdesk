import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api.js';
import { set, toast } from '../store.js';
import { ago } from '../util.js';
import { resume } from '../actions.js';
import { Glyph, I, Spinner } from './bits.jsx';
import { FEED_ICON } from './Progress.jsx';
import { runInShell } from './Shell.jsx';

const STATUS = {
  busy: { label: '작업 중', cls: 'busy' },
  waiting: { label: '선택을 기다림', cls: 'wait' },
  idle: { label: '다음 지시를 기다림', cls: 'idle' },
  gone: { label: '닫힘', cls: 'gone' },
};

/** A session running in VS Code / another terminal, followed live from its transcript. */
export function WatchView({ task, visible }) {
  const [data, setData] = useState({ entries: [] });
  const box = useRef();
  const stick = useRef(true);
  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const r = await api('GET', `/api/tasks/${task.id}/transcript`);
        if (alive) setData(r);
      } catch {}
      if (alive) timer = setTimeout(tick, 1200);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [task.id]);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [data.entries.length, data.entries[data.entries.length - 1]?.st]);

  return (
    <div class="room-body watch" style={{ display: visible ? 'block' : 'none' }}>
      <div
        class="wlog scroll"
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!data.entries.length && <div class="wnone">대화 기록을 읽는 중이에요…</div>}
        {data.entries.map((e) =>
          e.role === 'user' ? (
            <div key={e.id} class="wu">
              <span class="who">{task.watching?.where || '다른 곳'}에서 보낸 지시 · {ago(e.at)} 전</span>
              <p>{e.text}</p>
            </div>
          ) : e.role === 'assistant' ? (
            <div key={e.id} class="wa">
              <p>{e.text}</p>
            </div>
          ) : (
            <div key={e.id} class={`wt ${e.st}`}>
              <I n={FEED_ICON[e.kind] || 'tool'} />
              <span>{e.text}</span>
              {e.st === 'run' ? <Spinner /> : e.st === 'err' ? <I n="x" /> : null}
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** Under a followed session: where it runs, its status, and the ways to take part. */
export function WatchBar({ task, project }) {
  const w = task.watching;
  const st = STATUS[w.status] || STATUS.busy;
  const [v, setV] = useState('');
  const fork = async () => {
    try {
      const t = await api('POST', `/api/tasks/${task.id}/fork`);
      set({ selected: t.id });
      toast(`${project.name} · 복사본으로 분기했어요 · 원래 세션은 그대로예요`, { kind: 'room', projectId: project.id, ms: 6000 });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  };
  const auto = (on) => api('POST', `/api/tasks/${task.id}/watch`, { autoTakeover: on }).catch((e) => toast(e.message, { kind: 'err' }));
  const queue = async () => {
    if (!v.trim()) return;
    try {
      await api('POST', `/api/tasks/${task.id}/send`, { text: v.trim() });
      setV('');
      toast(`${project.name} · Codex 세션 대기열에 넣었어요`, { kind: 'room', projectId: project.id });
    } catch (e) {
      toast(e.message, { kind: 'err' });
    }
  };
  return (
    <div class="termbar watchbar">
      <div class="who">
        <Glyph project={project} size={22} />
        <span>
          <b>{project.name}</b>
          <span class="dim"> · {w.where}에서 실행 중인 세션을 보는 중</span>
        </span>
      </div>
      <span class={`wst ${st.cls}`}>
        <span class="dot" />
        {st.label}
      </span>
      {w.canSend && w.status !== 'gone' && (
        <div class="qr wq">
          <input value={v} placeholder="Codex 세션에 보낼 말 (codex queue)" onInput={(e) => setV(e.currentTarget.value)} onKeyDown={(e) => !e.isComposing && e.keyCode !== 229 && e.key === 'Enter' && queue()} />
        </div>
      )}
      {task.commands?.length > 0 && (
        <div class="cmds">
          {task.commands.map((c) => (
            <button key={c} class="cmdchip" onClick={() => runInShell(task.id, c)} title={`셸에 넣기 (실행은 ↵ 로 직접): ${c}`}>
              <I n="terminal-2" />
              <code>{c}</code>
            </button>
          ))}
        </div>
      )}
      <span class="sp" />
      {w.status === 'gone' ? (
        <button class="btn primary sm" onClick={() => resume(task.id)}>
          <I n="player-play" /> 여기서 이어가기
        </button>
      ) : (
        task.agent === 'claude' && (
          <label class="chk" title={`${w.where}에서 세션을 닫는 순간, 같은 대화를 여기서 이어받아요. 그때부터 여기서 지시하고 되돌릴 수 있어요.`}>
            <input type="checkbox" checked={w.autoTakeover} onChange={(e) => auto(e.currentTarget.checked)} /> {w.where}에서 닫으면 여기서 이어받기
          </label>
        )
      )}
      {task.remoteUrl && (
        <a class="btn sm" href={task.remoteUrl} target="_blank" rel="noopener noreferrer" title="이 세션은 Remote Control이 켜져 있어서 claude.ai 웹에서 바로 조작할 수 있어요">
          <I n="external-link" /> claude.ai에서 조작
        </a>
      )}
      <button class="btn sm" onClick={fork} title="원래 세션은 그대로 두고, 같은 대화의 복사본을 여기서 열어요">
        <I n="git-fork" /> 복사본으로 분기
      </button>
    </div>
  );
}
