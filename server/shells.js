// A plain shell next to the agent, in the task's folder: for the commands an agent asks you to
// run yourself (logins, sudo, anything interactive).
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import pty from '@lydell/node-pty';
import { randomId, which } from './util.js';
import { httpError } from './projects.js';

const require = createRequire(import.meta.url);
const WIN = process.platform === 'win32';
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

export const isShellId = (id) => typeof id === 'string' && /^sh_[a-z0-9]{6,40}$/.test(id);

export class Shells {
  constructor(store) {
    this.store = store;
    /** shellId -> { id, taskId, proc, term, ser, cwd, exited } */
    this.byId = new Map();
    /** peer (a window's connection) -> shellId */
    this.viewers = new Map();
  }

  forTask(taskId) {
    for (const s of this.byId.values()) if (s.taskId === taskId) return s;
    return null;
  }

  /** The task's shell, started on first use (again if it was closed). */
  open(task) {
    let s = this.forTask(task.id);
    if (s && !s.exited) return s;
    if (s) this.byId.delete(s.id);
    const cwd = fs.existsSync(task.cwd) ? task.cwd : os.homedir();
    // Windows: PowerShell 7 if installed, else Windows PowerShell. A POSIX $SHELL (Git Bash, MSYS) isn't a Windows program path.
    const shell = WIN ? which('pwsh') || 'powershell.exe' : process.env.SHELL || '/bin/bash';
    // The agents' hook token and Desk's own variables never reach a shell the person types into.
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    for (const k of Object.keys(env)) if (/^(AGENTDESK_|CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CODEX_SANDBOX|CODEX_THREAD|ELECTRON_|CHROME_)/.test(k)) delete env[k];
    const cols = 120;
    const rows = 14;
    const proc = pty.spawn(shell, WIN ? [] : ['-l'], { name: 'xterm-256color', cols, rows, cwd, env, ...(WIN ? { useConptyDll: true } : {}) });
    const term = new Terminal({ cols, rows, scrollback: 3000, allowProposedApi: true });
    const ser = new SerializeAddon();
    term.loadAddon(ser);
    s = { id: 'sh_' + randomId('').replace(/[^a-z0-9]/g, '').slice(0, 16), taskId: task.id, proc, term, ser, cwd, exited: false };
    // "Ready" once the shell has printed its prompt and gone quiet: a paste before that lands
    // before line editing is on and shows up as raw escape codes.
    let quiet;
    s.ready = new Promise((resolve) => {
      s.markReady = resolve;
      setTimeout(resolve, 3000);
    });
    this.byId.set(s.id, s);
    proc.onData((d) => {
      clearTimeout(quiet);
      quiet = setTimeout(s.markReady, 250);
      term.write(d);
      this.broadcast(s.id, { t: 'o', task: s.id, d });
    });
    proc.onExit(({ exitCode }) => {
      s.exited = true;
      this.broadcast(s.id, { t: 'exit', task: s.id, code: exitCode });
    });
    return s;
  }

  /** Put a command on the shell's line without running it: the person reads it and presses Enter. */
  async paste(task, text) {
    const s = this.open(task);
    await s.ready;
    const clean = String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
      .replace(/\n+$/, '')
      .slice(0, 4000);
    if (!clean) return s;
    // First clear the half-typed line (Ctrl+U; Esc in PowerShell), so the command replaces it instead of joining it.
    // PowerShell gets one line: without bracketed paste a newline would run it.
    if (WIN) s.proc.write('\x1b' + clean.replace(/\n/g, '; '));
    else s.proc.write('\x15\x1b[200~' + clean.replace(/\n/g, '\r') + '\x1b[201~');
    return s;
  }

  attach(ws, id, cols, rows) {
    const s = this.byId.get(id);
    if (!s) return;
    this.viewers.set(ws, id);
    this.resize(id, cols, rows);
    ws.send(JSON.stringify({ t: 'snap', task: id, d: s.ser.serialize({ scrollback: 1000 }), running: !s.exited }));
  }

  detach(ws) {
    this.viewers.delete(ws);
  }

  input(id, data) {
    const s = this.byId.get(id);
    if (s && !s.exited && typeof data === 'string') s.proc.write(data);
  }

  resize(id, cols, rows) {
    const s = this.byId.get(id);
    if (!s || s.exited || !(cols > 10 && rows > 2)) return;
    cols = Math.min(400, cols | 0);
    rows = Math.min(200, rows | 0);
    try {
      s.proc.resize(cols, rows);
      s.term.resize(cols, rows);
    } catch {}
  }

  broadcast(id, msg) {
    const str = JSON.stringify(msg);
    for (const [ws, sid] of this.viewers) if (sid === id && ws.readyState === 1) ws.send(str);
  }

  /** The task is gone (merged, discarded): its shell goes too. */
  close(taskId) {
    const s = this.forTask(taskId);
    if (!s) return;
    try {
      s.proc.kill();
    } catch {}
    this.byId.delete(s.id);
  }

  /** Closes every shell; resolves once their terminals have closed. */
  shutdown() {
    const closed = [];
    for (const s of this.byId.values()) {
      if (s.exited) continue;
      closed.push(new Promise((resolve) => s.proc.onExit(() => resolve())));
      try {
        s.proc.kill();
      } catch {}
    }
    return Promise.all(closed);
  }
}

/**
 * Commands the agent asked the person to run, read from its last reply: fenced shell blocks and
 * inline `code` that starts like a command. Shown as one-click "put it in my shell" chips.
 */
const CMD = /^(\$\s*)?(sudo\s+)?(npm|pnpm|yarn|npx|bun|bunx|node|deno|git|gh|brew|pip3?|pipx|uv|poetry|python3?|cargo|rustup|go|docker|docker-compose|kubectl|helm|make|cd|export|ssh|scp|curl|wget|open|xcodebuild|xcrun|pod|bundle|rails|ruby|gem|expo|eas|vercel|netlify|supabase|firebase|aws|gcloud|az|terraform|tofu|flutter|dart|java|mvn|gradle|\.\/gradlew|chmod|chown|mkdir|cp|mv|ln|ls|cat|source|claude|codex|flyctl|fly|railway|heroku|psql|mysql|redis-cli|sqlite3|ollama)\b/;

export function commandsIn(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  const add = (c) => {
    const cmd = c.replace(/^\$\s*/, '').trim();
    if (cmd && cmd.length <= 300 && !out.includes(cmd)) out.push(cmd);
  };
  for (const m of text.matchAll(/```(\w*)\n([\s\S]*?)```/g)) {
    const lang = m[1].toLowerCase();
    const lines = m[2].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (['bash', 'sh', 'shell', 'zsh', 'console', 'terminal', ''].includes(lang)) {
      for (const l of lines) if (lang || CMD.test(l)) add(l);
    }
  }
  for (const m of text.matchAll(/(?<!`)`([^`\n]{2,300})`(?!`)/g)) if (CMD.test(m[1].trim())) add(m[1]);
  return out.slice(0, 4);
}

export function needShellTask(store, id) {
  const t = store.task(id);
  if (!t) throw httpError(404, '작업을 찾을 수 없어요');
  return t;
}
