import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Auth, hostAllowed, originAllowed, securityHeaders } from './security.js';
import { Store } from './store.js';
import { Tasks } from './tasks.js';
import { addProject, updateProject, removeProject, discoverRepos, listDirs, httpError, PALETTE, ICONS, autofill, backfill } from './projects.js';
import { safeLogo } from './describe.js';
import { availability } from './agents.js';
import { listSessions } from './sessions.js';
import { Shells, isShellId, needShellTask } from './shells.js';
import { dataDir, writeJsonAtomic, resolveInside, VERSION, tilde } from './util.js';
import os from 'node:os';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export async function startServer({ port: wantPort, quiet = false } = {}) {
  const auth = new Auth();
  const store = new Store();
  try {
    backfill(store);
  } catch {}
  let port = 0;
  let broadcastTimer;
  const sockets = new Set();

  const publicState = () => ({
    t: 'state',
    version: VERSION,
    home: os.homedir(),
    agents: availability(),
    palette: PALETTE,
    icons: ICONS,
    prefs: store.prefs,
    projects: store.projects.map((p) => ({ ...p, display: tilde(p.path) })),
    tasks: store.tasks.map((t) => tasks.view(t)),
  });

  const changed = () => {
    clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => {
      const s = JSON.stringify(publicState());
      for (const ws of sockets) if (ws.readyState === 1) ws.send(s);
    }, 60);
  };

  const tasks = new Tasks(store, auth, () => port, changed);
  const shells = new Shells(store);
  tasks.onGone = (id) => shells.close(id);

  // ---------------------------------------------------------------- HTTP

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (!res.headersSent) send(res, status, { error: e.status ? e.message : '서버 오류가 났어요' });
      if (!e.status && !quiet) console.error(e);
    }
  });

  function baseHeaders(res) {
    for (const [k, v] of Object.entries(securityHeaders(port))) res.setHeader(k, v);
  }

  function send(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }

  function page(res, status, title, body) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:15px/1.6 -apple-system,system-ui,sans-serif;background:#111113;color:#e8e8ea;display:grid;place-items:center;height:100vh;margin:0}div{max-width:420px;text-align:center}code{background:#222;padding:2px 6px;border-radius:5px}</style><div><h2>${title}</h2><p>${body}</p></div>`
    );
  }

  async function readBody(req, limit = 1_000_000) {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/json')) throw httpError(415, 'application/json only');
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw httpError(413, 'body too large');
      chunks.push(c);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw httpError(400, 'bad json');
    }
  }

  async function handle(req, res) {
    // 1. Host check first: blocks DNS-rebinding before anything else runs.
    if (!hostAllowed(req.headers.host, port)) {
      res.writeHead(421, { 'Content-Type': 'text/plain' });
      return res.end('Misdirected request');
    }
    baseHeaders(res);
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = url.pathname;
    const method = req.method || 'GET';
    const origin = req.headers.origin;

    if (p === '/healthz' && method === 'GET') return send(res, 200, { ok: true, app: 'agentdesk', version: VERSION });

    // 2. Machine-to-machine endpoints: never callable from a browser (browsers always send Origin on POST).
    if (p === '/hook' || p.startsWith('/internal/')) {
      if (method !== 'POST' || origin !== undefined) return send(res, 403, { error: 'forbidden' });
      if (p === '/hook') {
        // Two shapes: {task, agent, payload} from hook.js, or the raw payload with ?task=&agent= from curl.
        let body = await readBody(req, 4_000_000);
        const qTask = url.searchParams.get('task');
        if (qTask) body = { task: qTask, agent: url.searchParams.get('agent') === 'codex' ? 'codex' : 'claude', payload: body };
        // Each task has its own token, so one agent can't report for another.
        if (!auth.hookValid(req, body.task)) return send(res, 403, { error: 'forbidden' });
        const done = tasks.hook(body).catch(() => {});
        // The prompt hook blocks the agent until we answer, so a prompt sent from the phone is
        // snapshotted before the agent acts on it. Everything else is answered right away.
        if (body.payload?.hook_event_name === 'UserPromptSubmit') await Promise.race([done, new Promise((r) => setTimeout(r, 2500))]);
        return send(res, 200, { ok: true });
      }
      // The CLI checks this proof before it ever sends the secret (a stale port could be squatted).
      if (p === '/internal/hello') {
        const body = await readBody(req, 4096);
        if (typeof body.nonce !== 'string' || !/^[0-9a-f]{32,128}$/.test(body.nonce)) return send(res, 400, { error: 'bad nonce' });
        return send(res, 200, { proof: auth.prove(body.nonce), port, pid: process.pid });
      }
      if (!auth.cliValid(req)) return send(res, 403, { error: 'forbidden' });
      if (p === '/internal/login-code') return send(res, 200, { code: auth.issueLoginCode(), port });
      if (p === '/internal/shutdown') {
        send(res, 200, { ok: true });
        setTimeout(() => shutdown(0), 50);
        return;
      }
      return send(res, 404, { error: 'not found' });
    }

    // 3. One-time login link → session cookie + page key. The key rides in the URL fragment,
    //    which browsers never send to a server; the page moves it into this origin's storage.
    if (p === '/auth' && method === 'GET') {
      if (!auth.consumeLoginCode(url.searchParams.get('code'))) {
        return page(res, 403, '링크가 만료됐어요', '터미널에서 <code>agentdesk</code> 를 다시 실행하면 새 링크가 열려요.');
      }
      const sess = auth.newSession();
      // Not a 303: when the login was opened from a local file (how the CLI opens it), the browser
      // treats the redirect as cross-site and withholds the SameSite=Strict cookie on the next request.
      // A same-origin hop through this tiny page makes the next navigation same-site.
      res.writeHead(200, { 'Set-Cookie': sess.setCookie, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/#k=${sess.key}"><title>Desk</title><style>body{background:#1a1c21;color:#a3a9b4;font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0}</style>여는 중…`
      );
    }

    // 4. Everything else needs the session cookie.
    if (!auth.cookieValid(req)) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'unauthorized' });
      return page(
        res,
        401,
        '로그인이 필요해요',
        '터미널에서 <code>agentdesk</code> 를 실행하면 로그인된 창이 열려요.<br><br>그래도 이 화면이 보이면 <code>agentdesk --no-open</code> 을 실행하고, 나온 링크를 주소창에 붙여넣으세요.'
      );
    }
    // 5. State-changing requests must come from our own page.
    if (method !== 'GET' && method !== 'HEAD') {
      if (!originAllowed(origin, port)) return send(res, 403, { error: 'bad origin' });
    }
    // Other localhost ports count as "same-site"; only our own origin (or a typed URL) is fine.
    const sfs = req.headers['sec-fetch-site'];
    if (sfs !== undefined && sfs !== 'same-origin' && sfs !== 'none') return send(res, 403, { error: 'cross-origin' });

    if (p.startsWith('/api/')) {
      // The cookie alone is never enough for the API: the page key must match too.
      if (!auth.fullyValid(req, req.headers['x-desk-key'])) return send(res, 401, { error: 'unauthorized' });
      return api(req, res, url, method);
    }
    return serveStatic(res, p);
  }

  function serveStatic(res, p) {
    const rel = p === '/' || !path.extname(p) ? 'index.html' : p.replace(/^\/+/, '');
    if (!fs.existsSync(DIST)) return page(res, 500, 'UI가 빌드되지 않았어요', '<code>npm run build</code> 를 실행하세요.');
    const abs = resolveInside(DIST, rel);
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream', 'Cache-Control': rel === 'index.html' ? 'no-store' : 'private, max-age=3600' });
    fs.createReadStream(abs).pipe(res);
  }

  async function api(req, res, url, method) {
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const [a, id, action] = parts;
    const body = method === 'POST' || method === 'PATCH' ? await readBody(req) : {};

    if (a === 'state' && method === 'GET') return send(res, 200, publicState());
    if (a === 'discover' && method === 'GET') return send(res, 200, { repos: discoverRepos(store.projects) });
    if (a === 'sessions' && method === 'GET') return send(res, 200, { sessions: (await listSessions(store, { fresh: url.searchParams.get('fresh') === '1' })).map(({ file, ...x }) => x) });
    if (a === 'dirs' && method === 'GET') return send(res, 200, { dirs: listDirs(url.searchParams.get('q')) });
    if (a === 'prefs' && method === 'PATCH') {
      for (const [k, v] of Object.entries(body)) if (/^[a-zA-Z]{1,40}$/.test(k) && ['string', 'boolean', 'number'].includes(typeof v)) store.prefs[k] = v;
      store.save();
      changed();
      return send(res, 200, { ok: true });
    }

    if (a === 'projects') {
      if (!id && method === 'POST') {
        const proj = await addProject(store, body);
        changed();
        return send(res, 200, proj);
      }
      if (id && method === 'GET' && action === 'logo') {
        const p = store.project(id);
        const abs = p && p.logo && p.showLogo !== false ? safeLogo(p.path, p.logo) : null;
        if (!abs) return send(res, 404, { error: 'no logo' });
        const ext = path.extname(abs).toLowerCase();
        const type = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' }[ext];
        // Repo content: an image, never a document (an SVG opened directly can't run anything).
        res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' });
        return fs.createReadStream(abs).pipe(res);
      }
      if (id && method === 'POST' && action === 'autofill') {
        const proj = autofill(store, id, { force: true });
        changed();
        return send(res, 200, proj);
      }
      if (id && method === 'PATCH') {
        const proj = updateProject(store, id, body);
        changed();
        return send(res, 200, proj);
      }
      if (id && method === 'DELETE') {
        removeProject(store, id);
        changed();
        return send(res, 200, { ok: true });
      }
    }

    if (a === 'tasks') {
      if (!id && method === 'POST') {
        const t = await tasks.create(body);
        return send(res, 200, tasks.view(t));
      }
      if (id && method === 'GET') {
        if (action === 'changes') return send(res, 200, { files: await tasks.changesOf(id) });
        if (action === 'files') return send(res, 200, { files: await tasks.files(id) });
        if (action === 'file') return send(res, 200, await tasks.file(id, url.searchParams.get('path') || '', url.searchParams.get('ref') || 'work'));
        if (action === 'activity') return send(res, 200, tasks.activity(id));
        if (action === 'transcript') return send(res, 200, tasks.transcript(id));
        if (action === 'screen') return send(res, 200, tasks.screen(id, Number(url.searchParams.get('lines')) || 10));
      }
      if (id && method === 'POST') {
        switch (action) {
          case 'send':
            return send(res, 200, await tasks.send(id, body.text));
          case 'undo':
            return send(res, 200, await tasks.undo(id, body.msgId));
          case 'stop':
            tasks.stop(id);
            return send(res, 200, { ok: true });
          case 'resume':
            tasks.resume(id);
            return send(res, 200, { ok: true });
          case 'merge':
            return send(res, 200, await tasks.merge(id));
          case 'pr':
            return send(res, 200, await tasks.pr(id));
          case 'discard':
            await tasks.discard(id);
            return send(res, 200, { ok: true });
          case 'archive':
            tasks.archive(id);
            return send(res, 200, { ok: true });
          case 'rename':
            tasks.rename(id, body.title);
            return send(res, 200, { ok: true });
          case 'paste':
            tasks.paste(id, body.text);
            return send(res, 200, { ok: true });
          case 'watch':
            tasks.setWatch(id, body);
            return send(res, 200, { ok: true });
          case 'fork': {
            const t = tasks.need(id);
            const sid = t.watch?.sessionId || t.sessionId;
            const f = await tasks.adopt({ agent: t.agent, sessionId: sid, mode: 'fork' });
            return send(res, 200, tasks.view(f));
          }
          case 'shell': {
            // The person's own shell in this task's folder; `paste` puts a command on its line, unsent.
            const t = needShellTask(store, id);
            const sh = typeof body.paste === 'string' ? await shells.paste(t, body.paste) : shells.open(t);
            return send(res, 200, { id: sh.id, cwd: tilde(sh.cwd) });
          }
          case 'remote':
            return send(res, 200, await tasks.remote(id, body.on !== false));
          case 'choose':
            tasks.choose(id, body.key);
            return send(res, 200, { ok: true });
        }
      }
    }
    return send(res, 404, { error: 'not found' });
  }

  // ---------------------------------------------------------------- WebSocket

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024, handleProtocols: (set) => (set.has('desk') ? 'desk' : false) });
  server.on('upgrade', (req, socket, head) => {
    const reject = (code) => {
      socket.write(`HTTP/1.1 ${code} Forbidden\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    // Browsers don't apply CORS to WebSockets, so all three checks are mandatory.
    if (!hostAllowed(req.headers.host, port)) return reject(421);
    if (!originAllowed(req.headers.origin, port)) return reject(403);
    const protos = String(req.headers['sec-websocket-protocol'] || '').split(',').map((x) => x.trim());
    const key = (protos.find((x) => x.startsWith('k.')) || '').slice(2);
    if (!auth.fullyValid(req, key)) return reject(401);
    if (new URL(req.url, 'http://x').pathname !== '/ws') return reject(404);
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.send(JSON.stringify(publicState()));
      ws.on('message', (raw) => {
        let m;
        try {
          m = JSON.parse(String(raw));
        } catch {
          return;
        }
        // Ids starting with "sh_" are plain shells; everything else is an agent's terminal.
        if (m.t === 'attach' && isShellId(m.task)) shells.attach(ws, m.task, m.cols, m.rows);
        else if (m.t === 'attach' && typeof m.task === 'string') tasks.attach(ws, m.task, m.cols, m.rows);
        else if (m.t === 'detach') isShellId(m.task) ? shells.detach(ws) : tasks.detach(ws);
        else if (m.t === 'in' && isShellId(m.task)) shells.input(m.task, m.d);
        else if (m.t === 'in' && typeof m.task === 'string') tasks.input(m.task, m.d);
        else if (m.t === 'resize' && isShellId(m.task)) shells.resize(m.task, m.cols, m.rows);
        else if (m.t === 'resize' && typeof m.task === 'string') tasks.resize(m.task, m.cols, m.rows);
        else if (m.t === 'submit' && typeof m.task === 'string') {
          tasks
            .submit(m.task)
            .then((msg) => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'submitted', task: m.task, seq: m.seq, msgId: msg?.id || null, text: msg?.text || '' })))
            .catch(() => {});
        }
      });
      ws.on('close', () => {
        sockets.delete(ws);
        tasks.detach(ws);
        shells.detach(ws);
      });
    });
  });

  // ---------------------------------------------------------------- listen

  const tryPorts = wantPort ? [wantPort] : Array.from({ length: 20 }, (_, i) => 4280 + i);
  for (const p of tryPorts) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(p, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
      port = server.address().port;
      auth.port = port;
      break;
    } catch (e) {
      if (e.code !== 'EADDRINUSE' || p === tryPorts[tryPorts.length - 1]) throw e;
    }
  }

  const info = path.join(dataDir(), 'daemon.json');
  writeJsonAtomic(info, { pid: process.pid, port, version: VERSION, startedAt: Date.now() });

  let closing = false;
  function shutdown(code) {
    if (closing) return;
    closing = true;
    tasks.shutdown();
    shells.shutdown();
    clearTimeout(warmTimer);
    clearInterval(warmEvery);
    store.flush();
    try {
      const d = JSON.parse(fs.readFileSync(info, 'utf8'));
      if (d.pid === process.pid) fs.unlinkSync(info);
    } catch {}
    for (const ws of sockets) ws.terminate();
    server.close();
    if (code !== null) setTimeout(() => process.exit(code), 100);
  }

  // Read the session lists ahead of time, so 불러오기 opens instantly.
  const warm = () => listSessions(store, { cliOk: false }).catch(() => {});
  const warmTimer = setTimeout(warm, 1500);
  const warmEvery = setInterval(warm, 60000);
  warmTimer.unref?.();
  warmEvery.unref?.();
  if (!quiet) console.log(`Agent Desk ${VERSION} listening on http://127.0.0.1:${port}`);
  return { port, auth, store, tasks, shells, server, shutdown, issueLoginUrl: () => `http://127.0.0.1:${port}/auth?code=${auth.issueLoginCode()}` };
}

// Run directly: `node server/main.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = await startServer({ port: process.env.AGENTDESK_PORT ? +process.env.AGENTDESK_PORT : undefined });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => s.shutdown(0));
}
