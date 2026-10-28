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
  const { startCore, Binary } = await import('../server/core.js');
  const s = await startCore({ quiet: true });
  // What the window gets: a JSON round trip, or an error with the status the core threw.
  const api = async (method, p, body) => {
    try {
      const r = await s.dispatch(method, p, body !== undefined ? JSON.stringify(body) : undefined);
      if (r instanceof Binary) return { status: 200, binary: r };
      return { status: 200, json: JSON.parse(JSON.stringify(r)) };
    } catch (e) {
      return { status: e.status || 500, json: { error: e.message } };
    }
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
  const hook = (opts) => hookPost(s.hookPath, opts);
  return { s, tmp, api, waitTask, hook };
}

/** POST to the hook socket the way curl and hook.mjs do. Resolves with {status, body}; status 'reset' if the server hung up mid-request. */
export function hookPost(sock, { path: p = '/hook', method = 'POST', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    // One connection per request, like each curl / hook.mjs process.
    const req = http.request({ socketPath: sock, method, path: p, agent: false, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => (['EPIPE', 'ECONNRESET'].includes(e.code) ? resolve({ status: 'reset', body: '' }) : reject(e)));
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
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
