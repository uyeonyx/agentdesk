// The raw terminals, in a drawer under the task: the agent's own CLI (for what the cards can't do)
// and a shell in the task's folder. They attach only while the drawer is open.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { api, onTerm, wsSend, attachTerm, detachTerm } from '../../api.js';
import { useStore, set, get, toast } from '../../store.js';
import { undoLastSend } from '../../actions.js';
import { xtermTheme, onTheme } from '../../app/theme.js';
import { openMenu } from '../../ui/Menu.jsx';
import { termItems } from '../task/taskActions.js';
import { I } from '../../ui/bits.jsx';
import { isMac } from '../../util.js';
import { keyLabel } from '../../app/keys.js';

const FONT = "'Desk Mono', 'D2Coding', ui-monospace, Menlo, monospace";

/** ⌘Z on Mac; Ctrl+Alt+Z elsewhere (plain Ctrl+Z belongs to the shell). */
export const isUndoKey = (e) => e.code === 'KeyZ' && (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.altKey) && !e.shiftKey;

function makeTerm(host, color) {
  const term = new Terminal({ fontFamily: FONT, fontSize: 13, lineHeight: 1.22, cursorBlink: true, scrollback: 5000, macOptionIsMeta: true, allowProposedApi: true, theme: xtermTheme(color) });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((e, uri) => window.open(uri, '_blank', 'noopener')));
  term.open(host);
  // xterm measures the cell once; measure again when the bundled font has actually loaded.
  document.fonts?.load("13px 'Desk Mono'").then(() => {
    term.options.fontFamily = FONT + ' ';
    try {
      fit.fit();
    } catch {}
  });
  return { term, fit };
}

export function Drawer({ task, project }) {
  const d = useStore((s) => s.drawer);
  const resize = (e) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = d.h;
    const move = (ev) => set((s) => ({ drawer: { ...s.drawer, h: Math.max(140, Math.min(innerHeight * 0.75, h0 - (ev.clientY - y0))) } }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.documentElement.classList.remove('resizing');
    };
    document.documentElement.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const tab = (t) => set((s) => ({ drawer: { ...s.drawer, tab: t } }));
  return (
    <div class="drawer" style={{ height: d.h + 'px' }} data-testid="drawer">
      <div class="dr-grip" onPointerDown={resize} role="separator" aria-orientation="horizontal" aria-label="터미널 높이" />
      <div class="dr-h">
        <div class="seg" role="tablist">
          <button role="tab" aria-selected={d.tab === 'agent'} onClick={() => tab('agent')} data-kbd={keyLabel('drawer')} data-tip="에이전트의 원래 화면">
            <I n="terminal-2" /> 에이전트
          </button>
          <button role="tab" aria-selected={d.tab === 'shell'} onClick={() => tab('shell')} data-kbd={keyLabel('shell')} data-tip="작업 폴더의 셸">
            <I n="terminal" /> 셸
          </button>
        </div>
        <span class="dr-hint">{d.tab === 'agent' ? '여기서 친 Enter도 보내기 전에 파일 스냅샷을 남겨요' : ''}</span>
        <span class="sp" />
        <button class="ibtn sm" onClick={() => set((s) => ({ drawer: { ...s.drawer, open: false } }))} aria-label="닫기" data-tip="닫기 · 세션과 셸은 계속 살아 있어요">
          <I n="x" />
        </button>
      </div>
      <div class="dr-b">{d.tab === 'agent' ? <AgentTerminal task={task} project={project} /> : <ShellTerminal task={task} project={project} />}</div>
    </div>
  );
}

function AgentTerminal({ task, project }) {
  const host = useRef();
  const st = useRef({});
  const proj = useRef(project);
  proj.current = project;

  useEffect(() => {
    const { term, fit } = makeTerm(host.current, project?.color);
    st.current = { term, fit, task: task.id };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (isUndoKey(e) && get().lastSend?.taskId === task.id) {
        e.preventDefault();
        undoLastSend();
        return false;
      }
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return true;
      if (e.shiftKey || e.altKey) {
        // A new line inside the message, the way each CLI understands it.
        e.preventDefault();
        wsSend({ t: 'in', task: task.id, d: task.agent === 'codex' ? '\n' : '\x1b\r' });
        return false;
      }
      e.preventDefault();
      if (proj.current?.careful && !(e.metaKey || e.ctrlKey)) {
        toast(`신중 모드예요 · ${isMac ? '⌘↵' : 'Ctrl+↵'}로 보내요`, { ms: 2500 });
        return false;
      }
      wsSend({ t: 'submit', task: task.id, seq: Date.now() });
      return false;
    });
    term.onData((d) => wsSend({ t: 'in', task: task.id, d }));
    const off = onTerm((m) => {
      if (m.t === 'submitted') {
        if (m.msgId) set({ lastSend: { taskId: task.id, msgId: m.msgId, at: Date.now(), restore: null } });
        return;
      }
      if (m.task !== task.id) return;
      if (m.t === 'snap') {
        term.reset();
        if (m.d) term.write(m.d);
      } else if (m.t === 'o') term.write(m.d);
    });
    try {
      fit.fit();
    } catch {}
    attachTerm(task.id, term.cols, term.rows);
    let raf;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {}
        wsSend({ t: 'resize', task: task.id, cols: term.cols, rows: term.rows });
      });
    });
    ro.observe(host.current);
    const offTheme = onTheme(() => (term.options.theme = xtermTheme(proj.current?.color)));
    setTimeout(() => term.focus(), 30);
    return () => {
      off();
      offTheme();
      ro.disconnect();
      detachTerm(task.id);
      term.dispose();
    };
  }, [task.id]);

  return (
    <div class="term-wrap">
      <div class="term-host" ref={host} onContextMenu={(e) => st.current.term && openMenu(e, termItems(st.current.term))} />
      {!task.running && (
        <div class="term-off">
          <span>세션이 멈춰 있어요</span>
        </div>
      )}
    </div>
  );
}

/** Put a command the agent suggested on the shell's line (not run), and show the shell. */
export async function runInShell(taskId, cmd) {
  set((s) => ({ drawer: { ...s.drawer, open: true, tab: 'shell' } }));
  try {
    await api('POST', `/api/tasks/${taskId}/shell`, { paste: cmd });
    toast('셸에 넣었어요 · 확인하고 ↵ 로 실행하세요', { ms: 3000 });
  } catch (e) {
    toast(e.message, { kind: 'err' });
  }
}

function ShellTerminal({ task, project }) {
  const host = useRef();
  const st = useRef({});
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
    const { term, fit } = makeTerm(host.current, project?.color);
    st.current = { term };
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
    try {
      fit.fit();
    } catch {}
    attachTerm(info.id, term.cols, term.rows);
    let raf;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          fit.fit();
          wsSend({ t: 'resize', task: info.id, cols: term.cols, rows: term.rows });
        } catch {}
      });
    });
    ro.observe(host.current);
    const offTheme = onTheme(() => (term.options.theme = xtermTheme(project?.color)));
    setTimeout(() => term.focus(), 30);
    return () => {
      off();
      offTheme();
      ro.disconnect();
      detachTerm(info.id);
      term.dispose();
    };
  }, [info?.id]);

  return (
    <div class="term-wrap">
      <div class="term-host" ref={host} onContextMenu={(e) => st.current.term && openMenu(e, termItems(st.current.term))} />
      {info?.cwd && <span class="term-cwd mono">{info.cwd}</span>}
      {exited && (
        <div class="term-off">
          <span>셸이 끝났어요</span>
          <button class="btn sm" onClick={() => setGen((g) => g + 1)}>
            <I n="refresh" /> 다시 열기
          </button>
        </div>
      )}
    </div>
  );
}
