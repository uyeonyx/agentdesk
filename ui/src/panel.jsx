// The quick panel: a small window over whatever you're doing (⌥Space or the menu bar icon) with
// everything that waits on you. Answer, reply or open it in Desk, then get back to work.
import './design/panel.css';
import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { connect } from './api.js';
import { useStore, projectOf } from './store.js';
import { bootTheme } from './app/theme.js';
import { isBlocked, isBusy, compareTasks, whyOf, askOf, firstLine } from './core/status.js';
import { enterAction } from './core/sendPolicy.js';
import { quickSend } from './actions.js';
import { PromptCard } from './features/prompt/PromptCard.jsx';
import { Glyph, I } from './ui/bits.jsx';
import { Tooltip } from './ui/Tooltip.jsx';

function Panel() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, loaded: s.loaded, toasts: s.toasts }));
  const live = s.tasks.filter((t) => !t.archived);
  const items = live.filter((t) => t.state === 'needs_input' || t.state === 'review').sort(compareTasks);
  const working = live.filter(isBusy).length;
  const [focus, setFocus] = useState(0);
  const root = useRef();

  // The window fits its content.
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => window.desk.panel('resize', Math.ceil(root.current.getBoundingClientRect().height)));
    ro.observe(root.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => window.desk.onPanelShown(() => setFocus(0)), []);

  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typing) return document.activeElement.blur();
        return window.desk.panel('hide');
      }
      if (typing || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = items[focus];
      if (e.code === 'KeyJ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocus((f) => Math.min(items.length - 1, f + 1));
      } else if (e.code === 'KeyK' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocus((f) => Math.max(0, f - 1));
      } else if (t && (e.code === 'KeyO' || e.key === 'Enter')) {
        e.preventDefault();
        window.desk.open(t.id, t.state === 'review' ? 'review' : undefined);
      } else if (t && e.code === 'KeyR') {
        e.preventDefault();
        root.current.querySelector(`[data-task-id="${t.id}"] .qr input`)?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div class="panel" ref={root} data-testid="panel">
      <header class="pn-h">
        <b>{items.length ? `기다리는 작업 ${items.length}` : 'Desk'}</b>
        <span class="sp" />
        <button class="ibtn sm" onClick={() => window.desk.panel('hide')} aria-label="닫기" data-tip="닫기" data-kbd="Esc">
          <I n="x" />
        </button>
      </header>
      <div class="pn-list">
        {s.loaded && !items.length && (
          <div class="pn-empty">
            <I n="circle-check" />
            <span>기다리는 작업이 없어요</span>
          </div>
        )}
        {items.map((t, i) => (
          <Item key={t.id} t={t} p={projectOf(s, t.projectId)} focused={i === focus} onFocus={() => setFocus(i)} />
        ))}
      </div>
      {s.toasts.slice(-1).map((t) => (
        <div key={t.id} class={`pn-toast ${t.kind === 'err' ? 'err' : ''}`}>{t.text}</div>
      ))}
      <footer class="pn-f">
        <span>
          작업 중 <b class="num">{working}</b>
        </span>
        <span class="sp" />
        <button class="btn sm ghost" onClick={() => window.desk.open(items[focus]?.id || '')}>
          Desk 열기 <kbd>O</kbd>
        </button>
      </footer>
      <Tooltip />
    </div>
  );
}

function Item({ t, p, focused, onFocus }) {
  const blocked = isBlocked(t);
  const ask = askOf(t);
  return (
    <section class={`pn-item ${focused ? 'focused' : ''} ${blocked ? 'blocked' : ''}`} data-task-id={t.id} onMouseDown={onFocus}>
      <div class="pn-ih">
        <Glyph project={p} size={22} task={t} />
        <span class="pn-id">
          <span class="pn-p">{p?.name}</span>
          <button class="pn-t" onClick={() => window.desk.open(t.id)}>
            {t.title}
          </button>
        </span>
        {ask ? <span class="askchip">{ask.short}</span> : t.state === 'review' ? <span class="pn-tag">검토</span> : <span class="pn-tag">답장</span>}
      </div>
      {blocked && t.prompt ? (
        <PromptCard task={t} project={p} compact focus={focused} />
      ) : t.state === 'review' ? (
        <div class="pn-b">
          <p>{whyOf(t)}</p>
          <button class="btn sm" onClick={() => window.desk.open(t.id, 'review')}>
            <I n="git-compare" /> 검토하기
          </button>
        </div>
      ) : (
        <div class="pn-b">
          <p>{firstLine(t.reply?.md || t.reason, 200)}</p>
          <QuickReply t={t} p={p} />
        </div>
      )}
    </section>
  );
}

function QuickReply({ t, p }) {
  const [v, setV] = useState('');
  return (
    <div class="qr">
      <input
        class="field"
        value={v}
        placeholder="답장 · ↵"
        onInput={(e) => setV(e.currentTarget.value)}
        onKeyDown={async (e) => {
          if (enterAction(e, { careful: !!p?.careful }) !== 'send' || !v.trim()) return;
          e.preventDefault();
          if (await quickSend(t.id, v.trim())) setV('');
        }}
      />
    </div>
  );
}

document.documentElement.classList.add(`os-${window.desk.platform}`);
await bootTheme();
connect();
render(<Panel />, document.getElementById('app'));
