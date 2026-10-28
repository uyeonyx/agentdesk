// Spike copy of the planned hook client: POST {task, agent, payload} over AGENTDESK_SOCK.
// Runs either as plain Node (`node hook.mjs claude`, ELECTRON_RUN_AS_NODE) or imported by the app's main (`--desk-hook`).
import http from 'node:http';
import { fileURLToPath } from 'node:url';

async function readStdin(ms) {
  if (process.stdin.isTTY) return '';
  let s = '';
  process.stdin.setEncoding('utf8');
  return await new Promise((resolve) => {
    const t = setTimeout(() => resolve(s), ms);
    process.stdin.on('data', (d) => (s += d));
    process.stdin.on('end', () => (clearTimeout(t), resolve(s)));
    process.stdin.on('error', () => (clearTimeout(t), resolve(s)));
  });
}

export async function runHook(argv) {
  const sock = process.env.AGENTDESK_SOCK;
  const token = process.env.AGENTDESK_HOOK_TOKEN;
  const task = process.env.AGENTDESK_TASK;
  const mode = argv[0] === 'codex' ? 'codex' : 'claude';
  if (!sock || !token || !task) return;
  const raw = mode === 'codex' ? argv.at(-1) : await readStdin(1500);
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
  } catch {}
  const body = JSON.stringify({ task, agent: mode, payload });
  await new Promise((resolve) => {
    const req = http.request({ socketPath: sock, path: '/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-agentdesk-hook': token }, timeout: 4500 }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.on('timeout', () => (req.destroy(), resolve()));
    req.end(body);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runHook(process.argv.slice(2));
  process.exit(0);
}
