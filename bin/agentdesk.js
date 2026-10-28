#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, readJson, VERSION } from '../server/util.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'server', 'main.js');
const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith('-')) || 'open';
const noOpen = args.includes('--no-open');

const dd = dataDir();
const infoFile = path.join(dd, 'daemon.json');
const secret = () => readJson(path.join(dd, 'auth.json'), {}).cliSecret;

async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(800) });
    const j = await r.json();
    return j.app === 'agentdesk' ? j : null;
  } catch {
    return null;
  }
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // gone, or owned by another user (so not ours)
  }
};

/**
 * Is the real daemon on this port? daemon.json can be stale after a crash, and anyone could be
 * listening on that port now, so the daemon must prove it knows our secret before we send it.
 */
async function verified(port, pid) {
  const key = secret();
  if (!key || !pidAlive(pid)) return false;
  const nonce = crypto.randomBytes(24).toString('hex');
  try {
    const r = await fetch(`http://127.0.0.1:${port}/internal/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonce }),
      signal: AbortSignal.timeout(1500),
    });
    const j = await r.json();
    const want = crypto.createHmac('sha256', key).update(`${nonce}:${port}`).digest('hex');
    return typeof j.proof === 'string' && j.proof.length === want.length && crypto.timingSafeEqual(Buffer.from(j.proof), Buffer.from(want)) && j.pid === pid;
  } catch {
    return false;
  }
}

async function running() {
  const d = readJson(infoFile, null);
  if (!d?.port || !d?.pid) return null;
  if (!(await health(d.port))) return null;
  return (await verified(d.port, d.pid)) ? d : null;
}

async function internal(port, what) {
  const r = await fetch(`http://127.0.0.1:${port}/internal/${what}`, {
    method: 'POST',
    headers: { 'x-agentdesk-secret': secret() || '' },
  });
  if (!r.ok) throw new Error(`daemon refused ${what} (${r.status})`);
  return r.json();
}

/** Open the login link without putting it on a command line (visible to other users via ps). */
function openBrowser(url) {
  const file = path.join(dd, 'open.html');
  fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${url}"><title>Desk</title>`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  setTimeout(() => fs.rmSync(file, { force: true }), 15000).unref?.();
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const a = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  try {
    spawn(opener, a, { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

/**
 * 0.1.0 used a single secret and can't answer the proof check, so the new CLI would think nothing
 * is running and start a second copy. Stop the old one once, only if it's the recorded live process.
 */
async function retireLegacy() {
  const auth = readJson(path.join(dd, 'auth.json'), {});
  const d = readJson(infoFile, null);
  if (!auth.secret || auth.cliSecret || !d?.port || !d?.pid || !pidAlive(d.pid)) return;
  const h = await health(d.port);
  if (!h || h.version !== '0.1.0') return;
  try {
    await fetch(`http://127.0.0.1:${d.port}/internal/shutdown`, { method: 'POST', headers: { 'x-agentdesk-secret': auth.secret } });
    console.log('Stopped the previous version (0.1.0).');
    for (let i = 0; i < 20 && pidAlive(d.pid); i++) await new Promise((r) => setTimeout(r, 150));
  } catch {}
}

async function start() {
  const log = fs.openSync(path.join(dd, 'daemon.log'), 'a', 0o600);
  const child = spawn(process.execPath, [MAIN], { detached: true, stdio: ['ignore', log, log], env: process.env, cwd: dd });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const d = await running();
    if (d) return d;
  }
  throw new Error(`Desk가 시작되지 않았어요. 로그: ${path.join(dd, 'daemon.log')}`);
}

async function main() {
  if (cmd === 'version' || args.includes('--version') || args.includes('-v')) return console.log(VERSION);
  if (cmd === 'help' || args.includes('--help') || args.includes('-h')) {
    return console.log(`Agent Desk ${VERSION}

  agentdesk           start (if needed) and open in your browser
  agentdesk stop      stop the background service (running agents stop too)
  agentdesk status    show whether it's running
  agentdesk fg        run in the foreground (logs to this terminal)
  --no-open           print the login link instead of opening the browser`);
  }
  if (cmd === 'fg') {
    const { startServer } = await import('../server/main.js');
    const s = await startServer();
    const url = s.issueLoginUrl();
    console.log(`\n  ${url}\n`);
    if (!noOpen) openBrowser(url);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => s.shutdown(0));
    return;
  }
  if (cmd === 'stop') {
    const d = await running();
    if (!d) return console.log('Agent Desk is not running.');
    await internal(d.port, 'shutdown');
    return console.log('Stopped.');
  }
  if (cmd === 'status') {
    const d = await running();
    return console.log(d ? `running · http://127.0.0.1:${d.port} · pid ${d.pid} · v${d.version}` : 'not running');
  }
  await retireLegacy();
  let d = await running();
  if (d && d.version !== VERSION) {
    console.log(`Restarting Desk (${d.version} → ${VERSION})…`);
    await internal(d.port, 'shutdown').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    d = null;
  }
  if (!d) d = await start();
  const { code } = await internal(d.port, 'login-code');
  const url = `http://127.0.0.1:${d.port}/auth?code=${code}`;
  if (noOpen) console.log(`\n  Agent Desk  →  ${url}\n  (one-time link, valid 2 minutes)\n`);
  else {
    openBrowser(url);
    console.log(`\n  Agent Desk opened in your browser  ·  http://127.0.0.1:${d.port}\n`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
