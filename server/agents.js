// Adapters: everything agent-specific is here. An agent is just a CLI in a PTY.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { which, realPath } from './util.js';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook.mjs');
const q = (s) => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;

/** argv that runs the hook client; the app sets its own binary (`--desk-hook`), tests and dev use node. */
let hookClient = [process.execPath, HOOK];
export function configureHooks({ client }) {
  hookClient = client;
}

// curl is ~5 ms to start (the hook client ~100 ms); it reaches the Unix socket directly.
// Windows has no Unix socket for curl to use, so it always takes the hook client.
const curlBin = () => (process.platform === 'win32' ? null : which('curl'));
const curlTo = (curl, agent) =>
  `${q(curl)} -s -m 4 --unix-socket "$AGENTDESK_SOCK" -X POST -H "x-agentdesk-hook: $AGENTDESK_HOOK_TOKEN" -H "content-type: application/json" --data-binary @- "http://desk/hook?task=$AGENTDESK_TASK&agent=${agent}" >/dev/null 2>&1 || true`;

/** One Claude Code hook entry. The token comes from the environment, never the command line. */
function claudeHook() {
  const curl = curlBin();
  if (curl) return { type: 'command', command: curlTo(curl, 'claude') };
  const [exe, ...rest] = hookClient;
  // Exec form: no shell on any platform, so Git Bash, PowerShell or sh all run it the same way.
  return { type: 'command', command: exe, args: [...rest, 'claude'] };
}

/** Codex runs notify as a program and appends its JSON as the last argument. */
function codexNotify() {
  const curl = curlBin();
  if (curl) return ['/bin/sh', '-c', `printf %s "$1" | ${curlTo(curl, 'codex')}`, 'desk'];
  return [...hookClient, 'codex'];
}

export const AGENTS = {
  claude: {
    label: 'Claude Code',
    bin: () => process.env.AGENTDESK_CLAUDE_BIN || which('claude'),
    idleMs: 12000,
    remote: true,
    /**
     * @param {{prompt?:string, resume?:boolean, sessionId?:string, fork?:boolean, newSessionId?:string, remote?:string|false, name?:string}} o
     */
    args({ prompt, resume, sessionId, fork, newSessionId, remote, name }) {
      const hook = claudeHook();
      const sync = [{ hooks: [{ ...hook, timeout: 5 }] }];
      // Tool and subagent events only feed the progress view, so they never block the agent.
      const bg = [{ matcher: '*', hooks: [{ ...hook, timeout: 5, async: true }] }];
      const bgNoMatcher = [{ hooks: [{ ...hook, timeout: 5, async: true }] }];
      const settings = JSON.stringify({
        hooks: {
          UserPromptSubmit: sync,
          Notification: sync,
          Stop: sync,
          // Only to know a prompt is open; an async hook can't answer it, so the person still decides.
          PermissionRequest: bg,
          PreToolUse: bg,
          PostToolUse: bg,
          PostToolUseFailure: bg,
          SubagentStart: bgNoMatcher,
          SubagentStop: bgNoMatcher,
        },
      });
      const args = ['--settings', settings];
      // `=` form: these take optional values and would otherwise swallow the prompt.
      if (name) args.push(`--name=${flagValue(name)}`);
      if (remote) args.push(`--remote-control=${flagValue(remote)}`);
      if (resume && sessionId) {
        args.push(`--resume=${sessionId}`);
        if (fork) args.push('--fork-session');
      } else if (resume) args.push('--continue');
      else {
        if (newSessionId) args.push(`--session-id=${newSessionId}`);
        if (prompt) args.push(safePositional(prompt));
      }
      return args;
    },
  },
  codex: {
    label: 'Codex',
    bin: () => process.env.AGENTDESK_CODEX_BIN || which('codex'),
    idleMs: 5000,
    remote: false,
    args({ prompt, resume, sessionId, fork }) {
      const notify = `notify=[${codexNotify().map((s) => JSON.stringify(s)).join(',')}]`;
      const args = ['-c', notify];
      if (resume && sessionId) args.push(fork ? 'fork' : 'resume', sessionId);
      else if (resume) args.push('resume', '--last');
      else if (prompt) args.push(safePositional(prompt));
      return args;
    },
  },
};

function safePositional(s) {
  // A prompt starting with "-" would be parsed as a flag.
  return s.startsWith('-') ? ' ' + s : s;
}

/** A display name as one flag value: single line, no leading dash, bounded. */
function flagValue(s) {
  return String(s).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/^[-\s]+/, '').trim().slice(0, 80) || 'Agent Desk';
}

export function availability() {
  const out = {};
  for (const [k, a] of Object.entries(AGENTS)) out[k] = { label: a.label, available: !!a.bin(), remote: !!a.remote };
  return out;
}

/** Last assistant text from a Claude Code transcript (JSONL). Reads only the tail. */
function transcriptRoots() {
  const home = os.homedir();
  const roots = [path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects')];
  for (const r of (process.env.AGENTDESK_TRANSCRIPT_ROOTS || '').split(path.delimiter)) if (r) roots.push(r);
  return roots;
}

export function lastAssistantText(transcriptPath) {
  try {
    if (typeof transcriptPath !== 'string' || !transcriptPath.endsWith('.jsonl')) return undefined;
    // Only read real Claude Code transcripts, never an arbitrary path an agent reports.
    const real = realPath(transcriptPath);
    const ok = transcriptRoots().some((r) => {
      try {
        const rr = realPath(r);
        return real.startsWith(rr + path.sep);
      } catch {
        return false;
      }
    });
    if (!ok) return undefined;
    const st = fs.lstatSync(real);
    if (!st.isFile()) return undefined;
    transcriptPath = real;
    const len = Math.min(st.size, 512 * 1024);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.trim()) continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (j.type !== 'assistant') continue;
      const content = j.message?.content;
      const text = Array.isArray(content) ? content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : typeof content === 'string' ? content : '';
      if (text.trim()) return text.trim();
    }
  } catch {}
  return undefined;
}

export function summarize(text) {
  if (!text) return undefined;
  const clean = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[#*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.slice(0, 220);
}
