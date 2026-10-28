import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pty from '@lydell/node-pty';

const here = path.dirname(fileURLToPath(import.meta.url));
const win = process.platform === 'win32';
const results = [];
const report = (check, ok, extra = {}) => {
  const r = { check, ok, ...extra };
  results.push(r);
  console.log(JSON.stringify(r));
};

// 1. node-pty inside the utility process
await new Promise((resolve) => {
  const [file, args] = win ? ['cmd.exe', ['/c', 'echo PTY_OK']] : ['/bin/sh', ['-c', 'echo PTY_OK']];
  let out = '';
  const p = pty.spawn(file, args, { cols: 80, rows: 24 });
  p.onData((d) => (out += d));
  p.onExit((e) => {
    report('pty-spawn', out.includes('PTY_OK'), { exit: e.exitCode, execPath: process.execPath });
    resolve();
  });
});

// 2. hook channel: http over a Unix socket / named pipe, reached the way agents will reach it
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-spike-'));
const sock = win ? `\\\\.\\pipe\\agentdesk-spike-${process.pid}` : path.join(dir, 'desk.sock');
const got = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    got.push({ url: req.url, token: req.headers['x-agentdesk-hook'], body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => server.listen(sock, r));
const env = { ...process.env, AGENTDESK_SOCK: sock, AGENTDESK_HOOK_TOKEN: 'tok123', AGENTDESK_TASK: 't_spike' };
delete env.ELECTRON_RUN_AS_NODE;

const run = (file, args, { input, shell } = {}) =>
  new Promise((resolve) => {
    const c = spawn(file, args, { env, shell, windowsVerbatimArguments: false });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('error', (e) => resolve({ code: -1, out: String(e) }));
    c.on('close', (code) => resolve({ code, out }));
    if (input !== undefined) c.stdin.end(input);
    else c.stdin.end();
  });

const expectHook = async (check, fn, match) => {
  const before = got.length;
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  await new Promise((x) => setTimeout(x, 200));
  const hit = got.slice(before).find(match);
  report(check, !!hit, { ms, code: r.code, out: r.out.slice(0, 300) });
};

const claudePayload = JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', note: 'quote " amp & pipe | pct % caret ^ 한글' });
const codexPayload = JSON.stringify({ type: 'agent-turn-complete', 'last-assistant-message': 'done " & | % ^ 한글' });
const isClaude = (h) => h.token === 'tok123' && h.body.includes('한글') && (h.url.includes('agent=claude') || h.body.includes('"agent":"claude"'));
const isCodex = (h) => h.token === 'tok123' && h.body.includes('한글') && (h.url.includes('agent=codex') || h.body.includes('"agent":"codex"'));

// Exec form on both OSes: the app binary itself is the hook client (no shell, no ELECTRON_RUN_AS_NODE).
const exe = process.env.SPIKE_MAIN_EXEC;
const appArg = process.env.SPIKE_APP; // dev only: a packaged app needs no script argument
await expectHook('exec-app-claude-stdin', () => run(exe, [appArg, '--desk-hook', 'claude'], { input: claudePayload }), isClaude);
await expectHook('exec-app-codex-argv', () => run(exe, [appArg, '--desk-hook', 'codex', codexPayload]), isCodex);

if (!win) {
  const curl = '/usr/bin/curl';
  const claudeCmd = `"${curl}" -s -m 5 --unix-socket "$AGENTDESK_SOCK" -X POST -H "x-agentdesk-hook: $AGENTDESK_HOOK_TOKEN" -H "content-type: application/json" --data-binary @- "http://desk/hook?task=$AGENTDESK_TASK&agent=claude" >/dev/null 2>&1 || true`;
  await expectHook('mac-claude-curl', () => run('/bin/sh', ['-c', claudeCmd], { input: claudePayload }), isClaude);
  const notify = ['/bin/sh', '-c', `printf %s "$1" | "${curl}" -s -m 5 --unix-socket "$AGENTDESK_SOCK" -X POST -H "x-agentdesk-hook: $AGENTDESK_HOOK_TOKEN" -H "content-type: application/json" --data-binary @- "http://desk/hook?task=$AGENTDESK_TASK&agent=codex" >/dev/null 2>&1 || true`, 'desk'];
  await expectHook('mac-codex-notify-curl', () => run(notify[0], [...notify.slice(1), codexPayload]), isCodex);
} else {
  // Fallback candidate: a .cmd launcher that runs the app binary as Node (needs the RunAsNode fuse).
  const hook = path.join(here, 'hook.mjs');
  const launcher = path.join(dir, 'desk-hook.cmd');
  fs.writeFileSync(launcher, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" "${hook}" %*\r\n`);
  const fwd = launcher.replace(/\\/g, '/');
  const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find((p) => fs.existsSync(p));
  report('win-git-bash-present', !!gitBash, { gitBash });
  if (gitBash) await expectHook('win-launcher-bash', () => run(gitBash, ['-c', `"${fwd}" claude`], { input: claudePayload }), isClaude);
  await expectHook('win-launcher-powershell', () => run('powershell.exe', ['-NoProfile', '-Command', `& '${launcher}' claude`], { input: claudePayload }), isClaude);
  await expectHook('win-launcher-codex-direct', () => run(launcher, ['codex', codexPayload]), isCodex);
}

server.close();
const failed = results.filter((r) => !r.ok && !r.check.startsWith('win-launcher'));
process.exit(failed.length ? 1 : 0);
