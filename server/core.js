// The Desk itself, without a transport: the app's core process wires `dispatch` and `connectPeer`
// to its window over a MessagePort, and tests call them directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Auth } from './security.js';
import { Store } from './store.js';
import { Tasks } from './tasks.js';
import { addProject, updateProject, removeProject, discoverRepos, listDirs, httpError, PALETTE, ICONS, autofill, backfill } from './projects.js';
import { safeLogo } from './describe.js';
import { availability, configureHooks } from './agents.js';
import { listSessions } from './sessions.js';
import { Shells, isShellId, needShellTask } from './shells.js';
import { startHookServer } from './hookserver.js';
import { VERSION, tilde, trace } from './util.js';

const BODY_LIMIT = 1_000_000;
const IMAGE_TYPES = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

/** A non-JSON answer (project logos). The window turns it into a blob URL for an <img>. */
export class Binary {
  constructor(type, data) {
    this.type = type;
    this.data = data;
  }
}

/** Request bodies arrive as JSON text, with the same limits the HTTP server had. */
function parseBody(text) {
  if (text === undefined || text === null || text === '') return {};
  if (typeof text !== 'string') throw httpError(415, 'application/json only');
  if (Buffer.byteLength(text) > BODY_LIMIT) throw httpError(413, 'body too large');
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, 'bad json');
  }
}

/**
 * @param {{quiet?: boolean, sock?: string, hookClient?: string[]}} o
 *   sock: where agents reach the hook server (default: hookSocketPath()).
 *   hookClient: argv that runs the hook client, e.g. the app binary plus `--desk-hook`.
 */
export async function startCore({ quiet = false, sock, hookClient } = {}) {
  if (hookClient) configureHooks({ client: hookClient });
  const auth = new Auth();
  const store = new Store();
  try {
    backfill(store);
  } catch {}
  let broadcastTimer;
  const peers = new Set();

  const publicState = () => ({
    t: 'state',
    version: VERSION,
    home: os.homedir(),
    platform: process.platform,
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
      for (const p of peers) if (p.readyState === 1) p.send(s);
    }, 60);
  };

  let hooks;
  const tasks = new Tasks(store, auth, () => hooks.path, changed);
  const shells = new Shells(store);
  tasks.onGone = (id) => shells.close(id);
  hooks = await startHookServer({ auth, tasks, path: sock, quiet });

  // ---------------------------------------------------------------- requests

  async function dispatch(method, rawPath, bodyText) {
    const url = new URL(rawPath, 'http://desk');
    if (!url.pathname.startsWith('/api/')) throw httpError(404, 'not found');
    const [a, id, action] = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
    const body = method === 'POST' || method === 'PATCH' ? parseBody(bodyText) : {};

    if (a === 'state' && method === 'GET') return publicState();
    if (a === 'discover' && method === 'GET') return { repos: discoverRepos(store.projects) };
    if (a === 'sessions' && method === 'GET') return { sessions: (await listSessions(store, { fresh: url.searchParams.get('fresh') === '1' })).map(({ file, ...x }) => x) };
    if (a === 'dirs' && method === 'GET') return { dirs: listDirs(url.searchParams.get('q')) };
    if (a === 'prefs' && method === 'PATCH') {
      for (const [k, v] of Object.entries(body)) if (/^[a-zA-Z]{1,40}$/.test(k) && ['string', 'boolean', 'number'].includes(typeof v)) store.prefs[k] = v;
      store.save();
      changed();
      return { ok: true };
    }

    if (a === 'projects') {
      if (!id && method === 'POST') {
        const proj = await addProject(store, body);
        changed();
        return proj;
      }
      if (id && method === 'GET' && action === 'logo') {
        const p = store.project(id);
        const abs = p && p.logo && p.showLogo !== false ? safeLogo(p.path, p.logo) : null;
        if (!abs) throw httpError(404, 'no logo');
        return new Binary(IMAGE_TYPES[path.extname(abs).toLowerCase()], fs.readFileSync(abs));
      }
      if (id && method === 'POST' && action === 'autofill') {
        const proj = autofill(store, id, { force: true });
        changed();
        return proj;
      }
      if (id && method === 'PATCH') {
        const proj = updateProject(store, id, body);
        changed();
        return proj;
      }
      if (id && method === 'DELETE') {
        removeProject(store, id);
        changed();
        return { ok: true };
      }
    }

    if (a === 'tasks') {
      if (!id && method === 'POST') return tasks.view(await tasks.create(body));
      if (id && method === 'GET') {
        if (action === 'changes') return { files: await tasks.changesOf(id) };
        if (action === 'files') return { files: await tasks.files(id) };
        if (action === 'file') return await tasks.file(id, url.searchParams.get('path') || '', url.searchParams.get('ref') || 'work');
        if (action === 'activity') return tasks.activity(id);
        if (action === 'transcript') return tasks.transcript(id);
        if (action === 'screen') return tasks.screen(id, Number(url.searchParams.get('lines')) || 10);
      }
      if (id && method === 'POST') {
        switch (action) {
          case 'send':
            return await tasks.send(id, body.text);
          case 'undo':
            return await tasks.undo(id, body.msgId);
          case 'stop':
            tasks.stop(id);
            return { ok: true };
          case 'resume':
            tasks.resume(id);
            return { ok: true };
          case 'merge':
            return await tasks.merge(id);
          case 'pr':
            return await tasks.pr(id);
          case 'discard':
            await tasks.discard(id);
            return { ok: true };
          case 'archive':
            tasks.archive(id);
            return { ok: true };
          case 'rename':
            tasks.rename(id, body.title);
            return { ok: true };
          case 'paste':
            tasks.paste(id, body.text);
            return { ok: true };
          case 'watch':
            tasks.setWatch(id, body);
            return { ok: true };
          case 'fork': {
            const t = tasks.need(id);
            const sid = t.watch?.sessionId || t.sessionId;
            return tasks.view(await tasks.adopt({ agent: t.agent, sessionId: sid, mode: 'fork' }));
          }
          case 'shell': {
            // The person's own shell in this task's folder; `paste` puts a command on its line, unsent.
            const t = needShellTask(store, id);
            const sh = typeof body.paste === 'string' ? await shells.paste(t, body.paste) : shells.open(t);
            return { id: sh.id, cwd: tilde(sh.cwd) };
          }
          case 'remote':
            return await tasks.remote(id, body.on !== false);
          case 'choose':
            tasks.choose(id, body.key);
            return { ok: true };
        }
      }
    }
    throw httpError(404, 'not found');
  }

  // ---------------------------------------------------------------- live connections

  /**
   * A window's live connection: state pushes and terminal streams go out through `peer.send`,
   * terminal input comes in through `message`. `peer.readyState` is 1 while it can receive.
   */
  function connectPeer(peer) {
    peers.add(peer);
    peer.send(JSON.stringify(publicState()));
    return {
      message(m) {
        if (!m || typeof m !== 'object') return;
        // Ids starting with "sh_" are plain shells; everything else is an agent's terminal.
        if (m.t === 'attach' && isShellId(m.task)) shells.attach(peer, m.task, m.cols, m.rows);
        else if (m.t === 'attach' && typeof m.task === 'string') tasks.attach(peer, m.task, m.cols, m.rows);
        else if (m.t === 'detach') isShellId(m.task) ? shells.detach(peer) : tasks.detach(peer);
        else if (m.t === 'in' && isShellId(m.task)) shells.input(m.task, m.d);
        else if (m.t === 'in' && typeof m.task === 'string') tasks.input(m.task, m.d);
        else if (m.t === 'resize' && isShellId(m.task)) shells.resize(m.task, m.cols, m.rows);
        else if (m.t === 'resize' && typeof m.task === 'string') tasks.resize(m.task, m.cols, m.rows);
        else if (m.t === 'submit' && typeof m.task === 'string') {
          tasks
            .submit(m.task)
            .then((msg) => peer.readyState === 1 && peer.send(JSON.stringify({ t: 'submitted', task: m.task, seq: m.seq, msgId: msg?.id || null, text: msg?.text || '' })))
            .catch(() => {});
        }
      },
      close() {
        peers.delete(peer);
        tasks.detach(peer);
        shells.detach(peer);
      },
    };
  }

  /** Agents with a live terminal right now: quitting the app would stop them. */
  const running = () => store.tasks.filter((t) => tasks.rt.has(t.id)).length;

  // Read the session lists ahead of time, so 불러오기 opens instantly.
  const warm = () => listSessions(store, { cliOk: false }).catch(() => {});
  const warmTimer = setTimeout(warm, 1500);
  const warmEvery = setInterval(warm, 60000);
  warmTimer.unref?.();
  warmEvery.unref?.();

  let closed = false;
  function shutdown() {
    if (closed) return;
    closed = true;
    trace('core shutdown: tasks');
    tasks.shutdown();
    trace('core shutdown: shells');
    shells.shutdown();
    trace('core shutdown: rest');
    clearTimeout(warmTimer);
    clearInterval(warmEvery);
    clearTimeout(broadcastTimer);
    store.flush();
    hooks.close();
    trace('core shutdown: done');
  }

  if (!quiet) console.log(`Agent Desk ${VERSION} core ready · hooks at ${hooks.path}`);
  return { auth, store, tasks, shells, dispatch, connectPeer, publicState, running, shutdown, hookPath: hooks.path };
}
