import { useEffect, useRef } from 'preact/hooks';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { onTerm, wsSend, attachTerm } from '../api.js';
import { mix, isMac } from '../util.js';
import { get, set } from '../store.js';
import { resume, showBanner, undoBanner } from '../actions.js';
import { toggleShellKey } from './Shell.jsx';
import { I } from './bits.jsx';

const BASE_THEME = {
  background: '#1a1c21',
  foreground: '#e2e5ea',
  selectionBackground: '#3b404a',
  black: '#2a2e35', brightBlack: '#5b6270',
  red: '#f2706b', brightRed: '#ff8f8a',
  green: '#4cc38a', brightGreen: '#6fe0a8',
  yellow: '#f2c55c', brightYellow: '#ffd77e',
  blue: '#6aa8ff', brightBlue: '#8fc0ff',
  magenta: '#c49cff', brightMagenta: '#d8bcff',
  cyan: '#4fd1d9', brightCyan: '#7de6ec',
  white: '#d5d9e0', brightWhite: '#ffffff',
};

export let focusTerminal = () => {};

// Cell width comes from this font, and its Hangul is exactly two cells wide (see styles.css).
const TERM_FONT = "'Desk Mono', 'D2Coding', 'SF Mono', ui-monospace, Menlo, monospace";

/** ⌘Z on Mac; Ctrl+Alt+Z elsewhere (plain Ctrl+Z belongs to the shell). */
export const isUndoKey = (e) => e.key.toLowerCase() === 'z' && (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.altKey) && !e.shiftKey;

/**
 * The agent's real CLI, and the only place to type. Enter is routed through the daemon so it can
 * snapshot the worktree first; careful rooms need ⌘↵. Everything else goes straight to the PTY.
 */
export function TerminalView({ task, project, visible }) {
  const host = useRef();
  const st = useRef({ seq: 0, waiting: new Map() });
  const projRef = useRef(project);
  projRef.current = project;
  const agentRef = useRef(task?.agent);
  agentRef.current = task?.agent;

  useEffect(() => {
    const term = new Terminal({
      fontFamily: TERM_FONT,
      fontSize: 13.5,
      lineHeight: 1.22,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: BASE_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((e, uri) => window.open(uri, '_blank', 'noopener')));
    term.open(host.current);
    // xterm measures the cell once; measure again when the bundled font has actually loaded.
    document.fonts?.load("13.5px 'Desk Mono'").then(() => {
      try {
        term.options.fontFamily = TERM_FONT + ' ';
        fit.fit();
        if (st.current.task) wsSend({ t: 'resize', task: st.current.task, cols: term.cols, rows: term.rows });
      } catch {}
    });
    Object.assign(st.current, { term, fit, task: null });
    focusTerminal = () => term.focus();

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (toggleShellKey(e)) {
        e.preventDefault();
        set((s) => ({ shellOpen: !s.shellOpen }));
        return false;
      }
      const b = get().banner;
      if (b && b.taskId === st.current.task && isUndoKey(e)) {
        e.preventDefault();
        undoBanner();
        return false;
      }
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return true;
      if (e.shiftKey || e.altKey) {
        // A new line inside the message, the way each CLI understands it (Meta+Enter / Ctrl+J).
        e.preventDefault();
        if (st.current.task) wsSend({ t: 'in', task: st.current.task, d: agentRef.current === 'codex' ? '\n' : '\x1b\r' });
        return false;
      }
      const withMod = e.metaKey || e.ctrlKey;
      e.preventDefault();
      if (projRef.current?.careful && !withMod) {
        set((s) => ({ nudge: s.nudge + 1 })); // the bar under the terminal explains why
        return false;
      }
      const seq = ++st.current.seq;
      st.current.waiting.set(seq, { taskId: st.current.task, projectId: projRef.current?.id });
      wsSend({ t: 'submit', task: st.current.task, seq });
      return false;
    });

    term.onData((d) => st.current.task && wsSend({ t: 'in', task: st.current.task, d }));
    const off = onTerm((m) => {
      if (m.t === 'submitted') {
        const w = st.current.waiting.get(m.seq);
        st.current.waiting.delete(m.seq);
        if (w && m.msgId) showBanner({ kind: 'send', taskId: w.taskId, msgId: m.msgId, projectId: w.projectId, text: m.text });
        return;
      }
      if (m.task !== st.current.task) return;
      if (m.t === 'snap') {
        term.reset();
        if (m.d) term.write(m.d);
      } else if (m.t === 'o') term.write(m.d);
    });
    let raf;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!host.current || host.current.offsetParent === null) return;
        try {
          fit.fit();
        } catch {}
        if (st.current.task) wsSend({ t: 'resize', task: st.current.task, cols: term.cols, rows: term.rows });
      });
    });
    ro.observe(host.current);
    return () => {
      off();
      ro.disconnect();
      wsSend({ t: 'detach', task: st.current.task });
      term.dispose();
      focusTerminal = () => {};
    };
  }, []);

  useEffect(() => {
    const { term, fit } = st.current;
    if (!term || !task) return;
    st.current.task = task.id;
    term.reset();
    try {
      fit.fit();
    } catch {}
    attachTerm(task.id, term.cols, term.rows);
  }, [task?.id]);

  useEffect(() => {
    const { term } = st.current;
    if (!term || !project) return;
    term.options.theme = { ...BASE_THEME, cursor: project.color, cursorAccent: '#1a1c21', selectionBackground: mix(project.color, '#1a1c21', 0.55) };
  }, [project?.color]);

  useEffect(() => {
    if (visible)
      requestAnimationFrame(() => {
        try {
          st.current.fit?.fit();
        } catch {}
      });
  }, [visible]);

  const stopped = task && !task.running && ['exited', 'needs_input', 'review', 'working', 'starting'].includes(task.state);
  const resumeCmd = task?.agent === 'codex' ? 'codex resume --last' : 'claude --continue';
  return (
    <div class="room-body" style={{ display: visible ? 'block' : 'none' }}>
      <div class="term-host" ref={host} onMouseDown={() => setTimeout(() => st.current.term?.focus(), 0)} />
      {stopped && (
        <div class="overlay-msg">
          <div>
            <h3 style="margin:0">세션이 멈춰 있어요</h3>
            <p>{task.reason || '에이전트 프로세스가 끝났어요.'} 같은 작업 폴더에서 대화를 이어서 시작해요.</p>
            <button class="btn primary" onClick={() => resume(task.id)}>
              <I n="player-play" /> 재개 <span style="opacity:.7;font-weight:500;font-family:var(--mono);font-size:11.5px">{resumeCmd}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
