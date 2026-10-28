// The hook client for Claude Code hooks and Codex notify when curl can't be used (Windows, or no curl).
// Runs as `node hook.mjs <claude|codex>` or inside the app (`Agent Desk --desk-hook <claude|codex>`).
// Never blocks or fails the agent: always finishes quickly and prints nothing.
// .mjs on purpose: inside the packaged app this file sits next to no package.json that says "module".
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

function readStdin(ms) {
  return new Promise((resolve) => {
    let data = '';
    const done = () => resolve(data);
    const t = setTimeout(done, ms);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      clearTimeout(t);
      done();
    });
    process.stdin.on('error', done);
  });
}

/** @param {string[]} argv `[mode, ...]`; Codex appends its JSON as the last argument. */
export async function runHook(argv) {
  const sock = process.env.AGENTDESK_SOCK;
  const token = process.env.AGENTDESK_HOOK_TOKEN;
  const task = process.env.AGENTDESK_TASK;
  if (!sock || !token || !task) return;
  const mode = argv[0] === 'codex' ? 'codex' : 'claude';
  let payload = {};
  try {
    if (mode === 'codex') payload = JSON.parse(argv[argv.length - 1]);
    // Inside the app binary process.stdin isn't wired up on Windows (a GUI binary); the inherited
    // handle still reads fine as fd 0. Claude closes stdin after writing the event.
    else payload = JSON.parse((process.versions.electron ? fs.readFileSync(0, 'utf8') : await readStdin(1500)) || '{}');
  } catch {}
  // The server holds UserPromptSubmit for up to 2.5 s; Claude's hook timeout is 5 s.
  await new Promise((resolve) => {
    const req = http.request(
      { socketPath: sock, path: '/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-agentdesk-hook': token }, timeout: 4500 },
      (res) => {
        res.resume();
        res.on('end', resolve);
      }
    );
    req.on('error', resolve);
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.end(JSON.stringify({ task, agent: mode, payload }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runHook(process.argv.slice(2)).finally(() => process.exit(0));
}
