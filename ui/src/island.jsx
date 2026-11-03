// The agent island: a small bar at the top of the screen while another app is in front. Who's
// working and on what, and the first thing waiting on me; a permission request unfolds it with the
// card, answerable right there. Always dark, like the notch it sits under.
import './design/island.css';
import { render } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { connect } from './api.js';
import { useStore, projectOf, set, get } from './store.js';
import { deriveTokens, applyTheme, findTheme, DEFAULT_DARK_ID } from './theme/index.js';
import { isBlocked, isLive, compareTasks, askOf, firstLine, stateSince, waited } from './core/status.js';
import { PromptCard } from './features/prompt/PromptCard.jsx';
import { headline } from './features/usage/Usage.jsx';
import { Glyph, I, useNow } from './ui/bits.jsx';

const W = { bar: 420, open: 560 };
const live = (t) => !t.archived && isLive(t) && t.state !== 'exited';
const dotOf = (t) => (isBlocked(t) ? 'b' : t.state === 'needs_input' ? 'r' : t.state === 'review' ? 'v' : ['working', 'starting', 'waiting'].includes(t.state) ? 'w' : '');
const short = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');


function Island() {
  const s = useStore((s) => ({ tasks: s.tasks, projects: s.projects, usage: s.usage, loaded: s.loaded, settings: s.settings }));
  const now = useNow(1000);
  const [open, setOpen] = useState(false);
  const root = useRef();
  const lastBlocked = useRef(0);
  const sessions = s.tasks.filter(live).sort(compareTasks);
  const blocked = sessions.filter(isBlocked);
  const first = blocked[0];
  const on = s.settings.island !== false;
  const auto = s.settings.islandAuto !== false;

  // A new permission request unfolds it; nothing left waiting folds it back.
  useEffect(() => {
    if (blocked.length > lastBlocked.current && auto) setOpen(true);
    if (!blocked.length && lastBlocked.current) setOpen(false);
    lastBlocked.current = blocked.length;
  }, [blocked.length]);
  useEffect(() => window.desk.onIslandBlur(() => setOpen(false)), []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The window is exactly as big as the island.
  const want = on && s.loaded && sessions.length > 0;
  useLayoutEffect(() => {
    const report = () => window.desk.island({ want, open, w: open ? W.open : W.bar, h: Math.ceil(root.current?.getBoundingClientRect().height || 40) + 2 });
    report();
    const ro = new ResizeObserver(report);
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, [want, open]);

  const working = sessions.filter((t) => ['working', 'starting', 'waiting'].includes(t.state));
  const busy = working.sort((a, b) => (b.activity?.since || 0) - (a.activity?.since || 0))[0];
  const { top, wk, h5 } = headline(s.usage);
  const use = h5 || wk;
  return (
    <div ref={root} class={`island ${open ? 'open' : ''}`} data-testid="island">
      <button class="is-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class="is-dots" aria-hidden="true">
          {sessions.slice(0, 12).map((t) => (
            <i key={t.id} class={dotOf(t)} />
          ))}
        </span>
        {first ? (
          <span class="is-tx b">
            <i class="dia" />
            <span class="t">
              {askOf(first)?.short || '허락'} · {short(first.title, 22)} · {waited(now - stateSince(first))}
              {blocked.length > 1 ? ` · 외 ${blocked.length - 1}개` : ''}
            </span>
          </span>
        ) : busy ? (
          <span class="is-tx">
            <Glyph project={projectOf(s, busy.projectId)} size={16} />
            <span class="t">
              {short(busy.title, 16)} · {busy.activity?.current || '생각하는 중'}
            </span>
          </span>
        ) : (
          <span class="is-tx">
            <span class="t">{sessions.some((t) => t.state === 'needs_input' || t.state === 'review') ? `내 차례 ${sessions.filter((t) => t.state === 'needs_input' || t.state === 'review').length}개` : '모두 조용해요'}</span>
          </span>
        )}
        {use && (
          <span class={`is-use ${top >= 80 ? 'hi' : ''}`}>
            <I n="gauge" />
            {use.pct}%
          </span>
        )}
      </button>
      {open && (
        <div class="is-body">
          {first && (
            <div class="is-card" data-testid="island-card">
              <div class="is-ch">
                <Glyph project={projectOf(s, first.projectId)} size={18} />
                <button class="lnk" onClick={() => window.desk.open(first.id)}>
                  {first.title}
                </button>
                <span class="since">
                  <i class="dia" />
                  {waited(now - stateSince(first))}
                </span>
              </div>
              {first.prompt ? <PromptCard task={first} project={projectOf(s, first.projectId)} compact /> : <p class="is-q">{firstLine(first.reason, 160) || '터미널에서 답해야 해요'}</p>}
              {blocked.length > 1 && <p class="more2">다음 {blocked.length - 1}개가 기다려요</p>}
            </div>
          )}
          <div class="is-list">
            {sessions
              .filter((t) => t !== first)
              .slice(0, 8)
              .map((t) => (
                <button key={t.id} class="is-row" onClick={() => window.desk.open(t.id, t.state === 'review' ? 'review' : undefined)}>
                  <Glyph project={projectOf(s, t.projectId)} size={18} />
                  <span class="t">{t.title}</span>
                  <span class={`s ${dotOf(t)}`}>{isBlocked(t) ? askOf(t)?.short || '허락' : t.state === 'needs_input' ? '답장 차례' : t.state === 'review' ? '새 결과' : firstLine(t.activity?.current, 40) || '작업 중'}</span>
                </button>
              ))}
          </div>
          <div class="is-foot">
            {s.usage?.claude?.rows?.length ? <span>{s.usage.claude.rows
                  .filter((r) => r.key.startsWith('current'))
                  .map((r) => `${r.key === 'current-session' ? '5시간' : r.key === 'current-week-all-models' ? '주간' : r.label.replace('이번 주 · ', '')} ${r.pct}%`)
                  .join(' · ')}</span> : <span />}
            <span class="sp" />
            <button class="btn sm" onClick={() => window.desk.open(first?.id || sessions[0]?.id)}>
              <I n="app-window" /> Desk 열기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Always dark: the person's own dark theme, or Desk's.
async function darkTheme() {
  let p = null;
  try {
    p = await window.desk.themePrefs();
  } catch {}
  const t = findTheme(p?.dark) || findTheme(DEFAULT_DARK_ID);
  applyTheme(deriveTokens(t, { accent: p?.accent }), document.documentElement);
}

// Settings changed in the main window reach this one through storage events (same origin).
window.addEventListener('storage', (e) => {
  if (e.key !== 'desk.settings' || !e.newValue) return;
  try {
    set({ settings: { ...get().settings, ...JSON.parse(e.newValue) } });
  } catch {}
});

document.documentElement.classList.add(`os-${window.desk.platform}`);
await darkTheme();
connect();
render(<Island />, document.getElementById('app'));
