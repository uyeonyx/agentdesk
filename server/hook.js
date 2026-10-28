// Invoked by Claude Code hooks and Codex notify. Forwards the event to the local daemon.
// Never blocks or fails the agent: always exits 0 quickly and prints nothing.
const mode = process.argv[2];
const url = process.env.AGENTDESK_URL;
const token = process.env.AGENTDESK_HOOK_TOKEN;
const task = process.env.AGENTDESK_TASK;

async function readStdin(ms) {
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

async function main() {
  if (!url || !token || !task) return;
  let payload = {};
  try {
    if (mode === 'codex') payload = JSON.parse(process.argv[process.argv.length - 1]);
    else payload = JSON.parse((await readStdin(1500)) || '{}');
  } catch {}
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(`${url}/hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agentdesk-hook': token },
      body: JSON.stringify({ task, agent: mode, payload }),
      signal: ctrl.signal,
    });
  } catch {}
  clearTimeout(t);
}

main().finally(() => process.exit(0));
