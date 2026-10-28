// Where agents report back: Claude Code hooks and Codex notify POST here. There is no TCP port;
// the listener is a Unix socket only this user can open, or a per-run named pipe on Windows.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { dataDir, randomHex } from './util.js';
import { httpError } from './projects.js';

const BODY_LIMIT = 4_000_000;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const tempDirs = new Set(); // fallback socket dirs this process made, removed again on close

export function hookSocketPath() {
  if (process.platform === 'win32') return `\\\\.\\pipe\\agentdesk-${os.userInfo().username}-${randomHex(8)}`;
  const p = path.join(dataDir(), 'run', 'desk.sock');
  // sun_path holds 104 bytes on macOS; a long AGENTDESK_HOME falls back to a private dir in tmp.
  if (Buffer.byteLength(p) < 100) return p;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-'));
  tempDirs.add(dir);
  return path.join(dir, 'desk.sock');
}

/** A socket file someone still answers on belongs to a running Desk; one nobody answers is stale. */
function answers(sock) {
  return new Promise((resolve) => {
    const c = net.connect(sock);
    c.once('connect', () => (c.destroy(), resolve(true)));
    c.once('error', () => resolve(false));
  });
}

async function readBody(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/json')) throw httpError(415, 'application/json only');
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > BODY_LIMIT) throw httpError(413, 'body too large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw httpError(400, 'bad json');
  }
}

/**
 * Windows pipe names are per run (unguessable), so a second Desk can't be spotted by them. A fixed
 * name per data dir works as the lock instead: only one process can listen on it.
 */
async function windowsLock() {
  const id = crypto.createHash('sha256').update(dataDir().toLowerCase()).digest('hex').slice(0, 16);
  const lock = net.createServer();
  await new Promise((resolve, reject) => {
    lock.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error('Agent Desk가 이미 실행 중이에요') : e));
    lock.listen(`\\\\.\\pipe\\agentdesk-lock-${id}`, resolve);
  });
  return lock;
}

export async function startHookServer({ auth, tasks, path: want, quiet = false }) {
  const sock = want || hookSocketPath();
  const lock = process.platform === 'win32' ? await windowsLock() : null;
  if (process.platform !== 'win32') {
    fs.mkdirSync(path.dirname(sock), { recursive: true, mode: 0o700 });
    if (fs.existsSync(sock)) {
      if (await answers(sock)) throw new Error('Agent Desk가 이미 실행 중이에요');
      fs.unlinkSync(sock);
    }
  }

  const send = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://desk');
    if (req.method !== 'POST' || url.pathname !== '/hook') return send(res, 404, { error: 'not found' });
    // Two shapes: {task, agent, payload} from hook.mjs, or the raw payload with ?task=&agent= from curl.
    let body = await readBody(req);
    const qTask = url.searchParams.get('task');
    if (qTask) body = { task: qTask, agent: url.searchParams.get('agent') === 'codex' ? 'codex' : 'claude', payload: body };
    // Each task has its own token, so one agent can't report for another.
    if (!auth.hookValid(req, body.task)) return send(res, 403, { error: 'forbidden' });
    const done = tasks.hook(body).catch(() => {});
    // The prompt hook blocks the agent until we answer, so a prompt sent from the phone is
    // snapshotted before the agent acts on it. Everything else is answered right away.
    if (body.payload?.hook_event_name === 'UserPromptSubmit') await Promise.race([done, delay(2500)]);
    return send(res, 200, { ok: true });
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server error' });
      if (!e.status && !quiet) console.error(e);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sock, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') fs.chmodSync(sock, 0o600);

  return {
    path: sock,
    close() {
      server.close();
      lock?.close();
      if (process.platform !== 'win32') {
        try {
          fs.unlinkSync(sock);
          if (tempDirs.delete(path.dirname(sock))) fs.rmdirSync(path.dirname(sock));
        } catch {}
      }
    },
  };
}
