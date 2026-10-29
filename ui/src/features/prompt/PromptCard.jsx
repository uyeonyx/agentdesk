// What the agent is waiting on, as a card I can answer: the exact command, the diff of the edit,
// its questions, the plan. Digits answer like in the CLI. Careful projects take two presses.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { answer } from '../../actions.js';
import { permissionButtons, menuButtons, translate } from '../../core/prompts.js';
import { ASK } from '../../core/status.js';
import { Markdown } from '../../md/Markdown.jsx';
import { Diff } from '../../md/Diff.jsx';
import { I } from '../../ui/bits.jsx';
import { isMac } from '../../util.js';

const ARM_MS = 3000;

/** Careful projects: the first press arms a button for a moment, the second (or ⌘+digit) sends. */
function useArming(careful) {
  const [armed, setArmed] = useState(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  const arm = (id, sure, go) => {
    if (!careful || sure || armed === id) {
      setArmed(null);
      return go(true);
    }
    setArmed(id);
  };
  return [armed, arm];
}

export function PromptCard({ task, project, compact = false, focus = false }) {
  const p = task.prompt;
  const careful = !!project?.careful;
  const [armed, arm] = useArming(careful);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(null); // text box for "거절하고 다르게 지시하기" / "계획 더 다듬기"
  const box = useRef();

  const send = async (body) => {
    if (busy) return;
    setBusy(true);
    await answer(task.id, p, { ...body, confirm: careful ? true : undefined });
    setBusy(false);
  };

  // Digits answer the visible card, like the CLI's own menu (handled here so it's per card).
  // Listening from the commit, not after paint: a digit pressed as the card appears still counts.
  useLayoutEffect(() => {
    if (!focus) return;
    const onKey = (e) => {
      if (e.isComposing || !/^Digit[1-9]$/.test(e.code) || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.closest?.('.xterm, .monaco-editor'))) return;
      const n = Number(e.code.slice(5));
      const btn = box.current?.querySelectorAll('[data-n]')[n - 1];
      if (!btn) return;
      e.preventDefault();
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: e.metaKey, ctrlKey: e.ctrlKey }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, p?.id]);

  if (!p) return null;
  const kind = p.kind === 'question' && p.questions?.length ? 'question' : p.kind;
  const ask = ASK[kind] || ASK.menu;
  const sure = (e) => (isMac ? e.metaKey : e.ctrlKey);
  let body = null;
  let buttons = [];

  if (kind === 'permission') {
    buttons = permissionButtons(p).map((b) => ({ ...b, run: (e) => (b.needsText ? setReason({ action: 'no', placeholder: '무엇을 다르게 할지 적어 주세요' }) : arm(b.action, sure(e), () => send({ action: b.action }))) }));
    body = (
      <>
        {p.command && (
          <div class="pc-cmd">
            <pre class="selectable">{p.command.text}</pre>
            {p.command.desc && <div class="pc-desc">{p.command.desc}</div>}
          </div>
        )}
        {p.edit?.files?.map((f) => (
          <div key={f.path} class="pc-file">
            <div class="pc-fh">
              <I n={f.op === 'create' ? 'file-plus' : 'file-pencil'} />
              <span>{f.path}</span>
              <b class="a num">+{f.adds}</b>
              <b class="d num">−{f.dels}</b>
            </div>
            <Diff hunks={f.hunks} path={f.path} />
          </div>
        ))}
        {p.edit?.clipped && <div class="pc-desc">diff가 길어서 앞부분만 보여요</div>}
        {p.target && (
          <div class="pc-target">
            <span class="lbl">{p.target.label}</span>
            <code class="selectable">{p.target.value}</code>
          </div>
        )}
      </>
    );
  } else if (kind === 'plan') {
    buttons = (p.screen?.plan || []).map((c) => ({
      key: c.key,
      label: c.ko,
      raw: c.label,
      primary: c.action === 'approve' && c === p.screen.plan.find((x) => x.action === 'approve'),
      run: (e) => (c.action === 'keep' ? setReason({ action: 'keep', option: c.key, placeholder: '계획에서 바꿀 점을 적어 주세요 (비워 두면 그냥 더 다듬어요)', optional: true }) : arm(c.key, sure(e), () => send({ action: 'approve', option: c.key }))),
    }));
    body = p.plan ? (
      <div class={`pc-plan ${compact ? 'compact' : ''}`}>
        <Markdown md={p.plan} compact />
      </div>
    ) : null;
  } else if (kind === 'question') {
    return <QuestionCard task={task} p={p} careful={careful} compact={compact} send={send} busy={busy} focus={focus} />;
  } else {
    // A menu read off the screen, or a question the agent asked (elicitation): its own options.
    buttons = menuButtons(task.menu).map((b) => ({ ...b, run: (e) => arm(b.key, sure(e), () => send({ action: 'key', key: b.key })) }));
    body = p.message && p.message !== p.title ? <div class="pc-desc">{p.message}</div> : null;
  }

  const ready = p.screen?.ready !== false;
  return (
    <div class={`pcard glass-2 ${compact ? 'compact' : ''} ${careful ? 'careful' : ''}`} ref={box} role="region" aria-label={ask.label} data-testid="prompt-card" data-kind={kind}>
      <div class="pc-h">
        <span class="pc-ic">
          <I n={ask.icon} />
        </span>
        <span class="pc-title">{p.title || task.reason || ask.label}</span>
        {p.by?.agentId && <span class="pc-by">서브에이전트 · {p.by.type || 'agent'}</span>}
        {careful && (
          <span class="pc-careful" data-tip="신중 모드 · 두 번 누르거나 ⌘와 함께 눌러요">
            <I n="shield-lock" /> 신중
          </span>
        )}
      </div>
      {body && <div class="pc-b">{body}</div>}
      {reason ? (
        <ReasonBox
          {...reason}
          onCancel={() => setReason(null)}
          onSend={(text) => {
            if (!text && !reason.optional) return;
            setReason(null);
            send(reason.action === 'keep' ? { action: 'keep', option: reason.option, text } : { action: 'no', text });
          }}
        />
      ) : (
        <div class="pc-f">
          {!ready && <span class="pc-wait">화면에 선택지가 뜨기를 기다리는 중…</span>}
          {buttons.map((b, i) => (
            <OptionButton key={b.key || b.action} n={i + 1} b={b} busy={busy} disabled={!ready} armed={armed === (b.action && b.action !== 'key' ? b.action : b.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

function OptionButton({ n, b, busy, disabled, armed }) {
  return (
    <button class={`btn opt ${b.primary ? 'primary' : ''} ${b.quiet ? 'ghost' : ''} ${armed ? 'armed' : ''}`} data-n={n} disabled={busy || disabled} onClick={b.run} data-tip={b.raw && b.raw !== b.label ? b.raw : undefined}>
      <kbd>{n}</kbd>
      {armed ? '한 번 더 누르면 확정' : b.label}
    </button>
  );
}

function ReasonBox({ placeholder, onSend, onCancel, optional }) {
  const [v, setV] = useState('');
  const ref = useRef();
  useEffect(() => ref.current?.focus(), []);
  return (
    <div class="pc-reason">
      <textarea
        ref={ref}
        class="field"
        rows={2}
        value={v}
        placeholder={placeholder}
        onInput={(e) => setV(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend(v.trim());
          }
        }}
      />
      <div class="pc-f">
        <button class="btn ghost sm" onClick={onCancel}>
          취소
        </button>
        <button class="btn sm primary" onClick={() => onSend(v.trim())} disabled={!optional && !v.trim()}>
          보내기 <kbd>↵</kbd>
        </button>
      </div>
    </div>
  );
}

/** AskUserQuestion: one question at a time ("질문 1/3"), radio or check cards, or my own words. */
function QuestionCard({ task, p, careful, compact, send, busy, focus }) {
  const qs = p.questions;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState(() => qs.map(() => ({ pick: [], text: '' })));
  const [own, setOwn] = useState(false);
  const [armed, setArmed] = useState(false);
  const q = qs[i];
  const a = answers[i];
  const last = i === qs.length - 1;
  const put = (patch) => setAnswers((all) => all.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const finish = (all = answers) => {
    if (careful && !armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), ARM_MS);
      return;
    }
    send({ action: 'answer', answers: all.map((x) => (x.text.trim() ? { text: x.text.trim() } : { pick: x.pick })) });
  };
  const next = (all) => (last ? finish(all) : (setI(i + 1), setOwn(false)));
  const pick = (label) => {
    if (q.multi) return put({ pick: a.pick.includes(label) ? a.pick.filter((x) => x !== label) : [...a.pick, label], text: '' });
    const all = answers.map((x, k) => (k === i ? { pick: [label], text: '' } : x));
    setAnswers(all);
    next(all);
  };
  const box = useRef();
  useLayoutEffect(() => {
    if (!focus) return;
    const onKey = (e) => {
      if (e.isComposing || e.altKey || e.metaKey || e.ctrlKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.closest?.('.xterm, .monaco-editor'))) return;
      const m = e.code.match(/^Digit([1-9])$/);
      if (!m) return;
      const opt = q.options[Number(m[1]) - 1];
      if (opt) {
        e.preventDefault();
        pick(opt.label);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div class={`pcard glass-2 q ${compact ? 'compact' : ''}`} ref={box} role="region" aria-label="질문" data-testid="prompt-card" data-kind="question">
      <div class="pc-h">
        <span class="pc-ic">
          <I n="message-circle-question" />
        </span>
        <span class="pc-title">{q.question}</span>
        {qs.length > 1 && (
          <span class="pc-step num">
            질문 {i + 1}/{qs.length}
          </span>
        )}
      </div>
      {qs.length > 1 && (
        <div class="pc-tabs">
          {qs.map((x, k) => (
            <button key={k} class={`${k === i ? 'on' : ''} ${answers[k].pick.length || answers[k].text ? 'done' : ''}`} onClick={() => setI(k)}>
              {x.header || `질문 ${k + 1}`}
            </button>
          ))}
        </div>
      )}
      <div class="pc-opts" role={q.multi ? 'group' : 'radiogroup'}>
        {q.options.map((o, k) => {
          const on = a.pick.includes(o.label);
          return (
            <button key={o.label} class={`qopt ${on ? 'on' : ''}`} role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => pick(o.label)} disabled={busy}>
              <span class="qk">{q.multi ? <I n={on ? 'square-check-filled' : 'square'} /> : <kbd>{k + 1}</kbd>}</span>
              <span class="ql">
                <b>{translate(o.label)}</b>
                {o.desc && <small>{o.desc}</small>}
              </span>
            </button>
          );
        })}
        {own ? (
          <div class="qown">
            <input
              class="field"
              autofocus
              value={a.text}
              placeholder="직접 답을 적어 주세요"
              onInput={(e) => put({ text: e.currentTarget.value, pick: [] })}
              onKeyDown={(e) => {
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter' && a.text.trim()) {
                  e.preventDefault();
                  next(answers);
                }
              }}
            />
          </div>
        ) : (
          <button class="qopt own" onClick={() => setOwn(true)}>
            <span class="qk">
              <I n="pencil" />
            </span>
            <span class="ql">
              <b>직접 입력</b>
            </span>
          </button>
        )}
      </div>
      {(q.multi || own || last) && (
        <div class="pc-f">
          {i > 0 && (
            <button class="btn ghost sm" onClick={() => setI(i - 1)}>
              <I n="arrow-left" /> 이전
            </button>
          )}
          <span class="sp" />
          <button class={`btn sm primary ${armed ? 'armed' : ''}`} disabled={busy || (!a.pick.length && !a.text.trim())} onClick={() => next(answers)}>
            {last ? (armed ? '한 번 더 누르면 제출' : '답 제출') : '다음'} <kbd>↵</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
