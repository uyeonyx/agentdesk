import { useEffect, useRef, useState } from 'preact/hooks';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { api, onTerm, wsSend, attachTerm, detachTerm } from '../api.js';
import { set, toast } from '../store.js';
import { I } from './bits.jsx';

export let focusShell = () => {};
export const toggleShellKey = (e) => e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'Backquote' || e.key === '`');

const THEME = { background: '#15171b', foreground: '#d9dde3', cursor: '#d9dde3', selectionBackground: '#3b404a' };
const FONT = "'Desk Mono', 'D2Coding', 'SF Mono', ui-monospace, Menlo, monospace";

/** Put a command the agent asked for on the shell's line (not run), and show the shell. */
export async function runInShell(taskId, cmd) {
  set({ shellOpen: true });
  try {
    await api('POST', `/api/tasks/${taskId}/shell`, { paste: cmd });
    setTimeout(() => focusShell(), 80);
    toast('셸에 넣었어요 · 확인하고 ↵ 로 실행하세요', { ms: 3000 });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

/** A plain login shell in the task's folder, under the agent's terminal. */
export function ShellPane({ task, height }) {
  const host = useRef();
  const st = useRef({ id: null });
  const [info, setInfo] = useState(null);
  const [exited, setExited] = useState(false);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    let alive = true;
    setExited(false);
    api('POST', `/api/tasks/${task.id}/shell`)
      .then((r) => alive && setInfo(r))
      .catch((e) => toast(e.message, { kind: 'err' }));
    return () => {
      alive = false;
    };
  }, [task.id, gen]);

  useEffect(() => {
    if (!info) return;
    const term = new Terminal({ fontFamily: FONT, fontSize: 13, lineHeight: 1.2, cursorBlink: true, scrollback: 3000, macOptionIsMeta: true, theme: THEME, allowProposedApi: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((e, uri) => window.open(uri, '_blank', 'noopener')));
    term.open(host.current);
    st.current = { id: info.id, term, fit };
    focusShell = () => term.focus();
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && toggleShellKey(e)) {
        e.preventDefault();
        set({ shellOpen: false });
        return false;
      }
      return true;
    });
    term.onData((d) => wsSend({ t: 'in', task: info.id, d }));
    const off = onTerm((m) => {
      if (m.task !== info.id) return;
      if (m.t === 'snap') {
        term.reset();
        if (m.d) term.write(m.d);
        if (m.running === false) setExited(true);
      } else if (m.t === 'o') term.write(m.d);
      else if (m.t === 'exit') setExited(true);
    });
    const doFit = () => {
      try {
        fit.fit();
        wsSend({ t: 'resize', task: info.id, cols: term.cols, rows: term.rows });
      } catch {}
    };
    try {
      fit.fit();
    } catch {}
    attachTerm(info.id, term.cols, term.rows);
    document.fonts?.load("13px 'Desk Mono'").then(() => {
      term.options.fontFamily = FONT + ' ';
      doFit();
    });
    let raf;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(doFit);
    });
    ro.observe(host.current);
    setTimeout(() => term.focus(), 30);
    return () => {
      off();
      ro.disconnect();
      detachTerm(info.id);
      term.dispose();
      focusShell = () => {};
    };
  }, [info?.id]);

  return (
    <div class="shell-pane" style={`height:${Math.round(Number(height) || 260)}px`}>
      <div class="shell-h">
        <I n="terminal" />
        <b>셸</b>
        <span class="cwd" title={info?.cwd}>
          {info?.cwd || ''}
        </span>
        <span class="sp" />
        <kbd>⌃`</kbd>
        <button class="btn ghost sm icon" onClick={() => set({ shellOpen: false })} aria-label="셸 닫기" title="셸 닫기 (⌃`) · 셸은 계속 살아 있어요">
          <I n="x" />
        </button>
      </div>
      <div class="shell-body">
        <div class="term-host" ref={host} />
        {exited && (
          <div class="overlay-msg">
            <div>
              <p style="margin:0 0 10px">셸이 끝났어요</p>
              <button class="btn sm" onClick={() => setGen((g) => g + 1)}>
                <I n="refresh" /> 다시 열기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
