import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function boot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-test-'));
  process.env.AGENTDESK_HOME = path.join(tmp, 'home');
  process.env.AGENTDESK_CLAUDE_BIN = path.join(here, 'mock-claude');
  process.env.AGENTDESK_CODEX_BIN = path.join(here, 'mock-codex');
  process.env.MOCK_WORK_MS = '300';
  process.env.MOCK_TRANSCRIPT_DIR = path.join(tmp, 'transcripts');
  fs.mkdirSync(process.env.MOCK_TRANSCRIPT_DIR, { recursive: true });
  process.env.AGENTDESK_TRANSCRIPT_ROOTS = process.env.MOCK_TRANSCRIPT_DIR;
  process.env.CODEX_HOME = path.join(tmp, 'codex-home');
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-home');
  process.env.MOCK_LIVE_FILE = path.join(tmp, 'live.json');
  process.env.MOCK_STOP_LOG = path.join(tmp, 'stopped.log');
  process.env.MOCK_QUEUE_LOG = path.join(tmp, 'queue.log');
  process.env.MOCK_REMOTE_DIR = path.join(tmp, 'phone');
  fs.mkdirSync(process.env.MOCK_REMOTE_DIR, { recursive: true });
  const { startServer } = await import('../server/main.js');
  const s = await startServer({ quiet: true });
  const base = `http://127.0.0.1:${s.port}`;
  const r = await fetch(s.issueLoginUrl(), { redirect: 'manual' });
  const setCookie = r.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];
  const html = await r.text();
  const location = (html.match(/url=([^"]+)"/) || [])[1];
  const key = (location.match(/#k=([0-9a-f]{64})/) || [])[1];
  const H = { cookie, origin: base, 'x-desk-key': key, 'content-type': 'application/json' };
  const api = async (method, p, body, headers = H) => {
    const res = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let json = {};
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json };
  };
  const waitTask = async (id, pred, ms = 10000) => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      const { json } = await api('GET', '/api/state');
      last = json.tasks.find((t) => t.id === id);
      if (last && pred(last)) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timeout waiting for task ${id}; last=${JSON.stringify(last && { state: last.state, reason: last.reason, changes: last.changes })}`);
  };
  return { s, tmp, base, cookie, setCookie, location, key, H, api, waitTask, port: s.port };
}

export function makeRepo(dir, files = { 'README.md': '# repo\n' }) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  execSync('git init -q -b main && git add . && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });
  return dir;
}

/** Raw HTTP so tests can forge Host / Origin headers like an attacker would. */
export function raw(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Attempt a WebSocket upgrade with arbitrary headers; resolves with the HTTP status line. */
export function wsTry(port, headers) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/ws',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on('response', (res) => resolve(res.statusCode));
    req.on('error', () => resolve('error'));
    req.end();
  });
}
