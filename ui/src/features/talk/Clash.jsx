// Two sessions changing the same files, and their talk. Desk only carries words between them; what
// they decide is their own. Shown on a 관제 panel, above the composer in 집중, and in the side column.
import { useState } from 'preact/hooks';
import { api } from '../../api.js';
import { toast, useStore, taskOf } from '../../store.js';
import { openTask } from '../../actions.js';
import { I } from '../../ui/bits.jsx';

const base = (f) => f.split('/').pop();
const short = (s, n = 18) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

export async function startTalk(id, other) {
  try {
    await api('POST', `/api/tasks/${id}/talk`, { with: other });
    toast('두 세션에게 서로의 변경을 보냈어요 · 말은 Desk가 옮겨요');
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function holdFor(id, other) {
  try {
    await api('POST', `/api/tasks/${id}/hold`, { with: other });
    toast('이 세션에게 그 파일은 기다리라고 했어요');
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

export async function stopTalk(id, other) {
  await api('POST', `/api/tasks/${id}/talk-stop`, { with: other }).catch(() => {});
}

/** The clash worth showing first: an open talk, then a fresh overlap, then a finished talk. */
export function firstClash(t) {
  const list = t.clash || [];
  return list.find((c) => c.talk?.state === 'talking') || list.find((c) => !c.talk) || list[0] || null;
}

/** An unresolved overlap: nobody has talked or waited yet. */
export const openClash = (t) => (t.clash || []).some((c) => !c.talk || c.talk.state === 'talking');

/** Who said it: "이 세션" for the one on screen, the other by its title. */
function Who({ id, me }) {
  const title = useStore((s) => taskOf(s, id)?.title);
  return <b class="who">{id === me ? '이 세션' : short(title, 28)}</b>;
}

/**
 * One line: who else changes which file, and the buttons; or the last thing said; or how it ended.
 * `big`: the 집중 view's version above the composer, with room for both buttons and the file names.
 */
export function ClashLine({ t, big = false }) {
  const c = firstClash(t);
  const [busy, setBusy] = useState(false);
  if (!c) return null;
  const go = async (fn) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };
  const files = c.files.map(base);
  const fileText = files.length > 2 || c.more ? `${files.slice(0, 2).join(', ')} 외 ${files.length - 2 + c.more}개` : files.join(', ');
  if (!c.talk)
    return (
      <div class={`clash ${big ? 'big' : ''}`} data-testid="clash">
        <I n="alert-triangle" />
        <span class="tx" title={c.files.join('\n')}>
          <span class="f">{fileText}</span> · <button class="lnk" onClick={() => openTask(c.with)}>{short(c.title, big ? 40 : 18)}</button>도 고쳐요
        </span>
        <button class="btn sm" disabled={busy} onClick={() => go(() => startTalk(t.id, c.with))} data-tip="두 세션에게 서로의 변경을 보내고, 서로에게 하는 말을 옮겨 줘요" data-testid="talk-start">
          <I n="arrows-exchange" /> 협의시키기
        </button>
        {big && (
          <button class="btn sm ghost" disabled={busy} onClick={() => go(() => holdFor(t.id, c.with))} data-tip="이 세션에게 그 파일은 상대가 끝날 때까지 건드리지 말라고 해요">
            <I n="player-pause" /> 기다리게
          </button>
        )}
      </div>
    );
  if (c.talk.state === 'talking') {
    const last = c.talk.msgs.at(-1);
    return (
      <div class={`clash talk ${big ? 'big' : ''}`} data-testid="clash" data-talk="talking">
        <I n="arrows-exchange" />
        <span class="tx">
          {last ? (
            <>
              <Who id={last.from} me={t.id} /> {last.text}
            </>
          ) : (
            <>
              <b class="who">{short(c.title, 20)}</b>와 협의하는 중 · 서로의 변경을 읽고 있어요
            </>
          )}
        </span>
        {big && (
          <button class="btn sm ghost" onClick={() => stopTalk(t.id, c.with)}>
            그만 옮기기
          </button>
        )}
      </div>
    );
  }
  return (
    <div class={`clash ok ${big ? 'big' : ''}`} data-testid="clash" data-talk="done">
      <I n="check" />
      <span class="tx">
        <b>협의 끝</b> · {c.talk.result}
      </span>
    </div>
  );
}

/** The 집중 side column: what the two said to each other, in order. */
export function TalkThread({ task }) {
  const c = (task.clash || []).find((x) => x.talk?.msgs?.length || x.talk?.state === 'talking');
  if (!c) return null;
  const tk = c.talk;
  return (
    <section class="fs" data-testid="talk-thread">
      <h3 class="lbl">
        협의 <span>{c.files.map(base).slice(0, 2).join(', ')} · {tk.state === 'talking' ? '진행 중' : '끝남'}</span>
      </h3>
      <div class="thread">
        {tk.msgs.length ? (
          tk.msgs.map((m, i) => (
            <div key={i} class={`m ${m.from === task.id ? 'me' : ''}`}>
              <Who id={m.from} me={task.id} />
              <span>{m.text}</span>
            </div>
          ))
        ) : (
          <span class="empty">서로의 변경을 받고 확인하는 중이에요</span>
        )}
      </div>
      {tk.result && <p class="tres">{tk.result}</p>}
    </section>
  );
}
