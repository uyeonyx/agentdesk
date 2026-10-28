import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useStore, set } from '../store.js';
import { sendMessage, removeComment, removeRef } from '../actions.js';
import { mod } from '../util.js';
import { Glyph, I } from './bits.jsx';

export let focusComposer = () => {};

/**
 * The only place you type instructions. It lives inside the room, wears the room's color,
 * and says whose room it is right where your eyes are.
 */
export function Composer({ task, project }) {
  const draft = useStore((s) => s.drafts[task.id] || '');
  const comments = useStore((s) => s.comments[task.id] || []);
  const refs = useStore((s) => s.refs[task.id] || []);
  const [nudge, setNudge] = useState(0);
  const [busy, setBusy] = useState(false);
  const ta = useRef();
  const careful = !!project?.careful;

  focusComposer = () => ta.current?.focus();

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 210) + 'px';
  }, [draft, task.id]);

  const setDraft = (v) => set((s) => ({ drafts: { ...s.drafts, [task.id]: v } }));
  const canSend = !!draft.trim() || comments.length > 0;

  async function doSend() {
    if (!canSend || busy) return;
    setBusy(true);
    await sendMessage(task.id);
    setBusy(false);
    ta.current?.focus();
  }

  function onKey(e) {
    // Korean IME: Enter while composing just commits the syllable.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key !== 'Enter') return;
    const withMod = e.metaKey || e.ctrlKey;
    if (e.shiftKey) return; // newline
    if (careful) {
      if (withMod) {
        e.preventDefault();
        doSend();
      } else {
        // Plain Enter in a careful room never sends; the hint tells you why.
        setNudge((n) => n + 1);
      }
      return;
    }
    e.preventDefault();
    doSend();
  }

  const placeholder = comments.length ? `${project?.name || ''}에게 코멘트와 함께 보낼 말 (비워도 돼요)` : `${project?.name || ''}에게 지시하기…`;

  return (
    <div class="composer">
      {(comments.length > 0 || refs.length > 0) && (
        <div class="attach">
          {comments.map((c) => (
            <span class="pill" key={c.id} title={c.text}>
              <I n="message-2" />
              <span class="p">
                {c.path.split('/').pop()}:{c.start}
                {c.end !== c.start ? `–${c.end}` : ''}
              </span>
              <span class="x">{c.text}</span>
              <button onClick={() => removeComment(task.id, c.id)} aria-label="코멘트 빼기">
                <I n="x" />
              </button>
            </span>
          ))}
          {refs.map((r) => (
            <span class="pill" key={r.id}>
              <I n="code" />
              <span class="p">
                {r.path}:{r.start}
                {r.end !== r.start ? `–${r.end}` : ''}
              </span>
              <button onClick={() => removeRef(task.id, r.id)} aria-label="참고 위치 빼기">
                <I n="x" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div class="composer-box">
        <Glyph project={project} />
        <textarea
          ref={ta}
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label={`${project?.name || ''}에게 보낼 지시`}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={onKey}
          spellcheck={false}
        />
        <div class="send">
          <span key={nudge} class={`hint ${nudge ? 'nudge' : ''}`}>
            {careful ? (
              <>
                신중 모드 · <kbd>{mod}</kbd>
                <kbd>↵</kbd> 보내기
              </>
            ) : (
              <>
                <kbd>↵</kbd> 보내기 · <kbd>⇧↵</kbd> 줄바꿈
              </>
            )}
          </span>
          <button class="btn primary icon" disabled={!canSend || busy} onClick={doSend} title={`${project?.name || ''}에 보내기`} aria-label="보내기">
            <I n={busy ? 'loader-2' : 'arrow-up'} />
          </button>
        </div>
      </div>
    </div>
  );
}
