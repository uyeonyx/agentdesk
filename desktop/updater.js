// The update flow in the main process. States the window sees:
//   none · available {version, notes} · downloading {progress} · ready {version, pending}
//   · manual {version, page} (this copy can't replace itself) · error {message}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO, APP_ID, pickUpdate, verifyDownload, sha256File, bundleInfo, replaceableApp, macSwapScript } from './update.js';
import { PUBLIC_KEY } from './update-key.js';

const run = promisify(execFile);
const EVERY_MS = 6 * 3600_000;

export function createUpdater({ app, net, shell, send }) {
  let state = { state: 'none' };
  let found = null; // pickUpdate() result
  let staged = null; // {kind:'mac', app} | {kind:'win', installer}
  let timer;
  const dir = path.join(app.getPath('temp'), 'agentdesk-update');
  const mac = process.platform === 'darwin';

  const set = (s) => {
    state = s;
    send(state);
  };

  async function getText(url) {
    const r = await net.fetch(url, { headers: { 'user-agent': `AgentDesk/${app.getVersion()}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }

  async function check({ quiet = true } = {}) {
    if (['downloading', 'ready'].includes(state.state)) return state;
    try {
      const release = JSON.parse(await getText(`https://api.github.com/repos/${REPO}/releases/latest`));
      found = pickUpdate(release, app.getVersion(), process.platform, process.arch);
      if (!found) set({ state: 'none' });
      else if (mac && !replaceableApp(process.execPath)) set({ state: 'manual', version: found.version, page: found.page });
      else set({ state: 'available', version: found.version, notes: found.notes });
    } catch (e) {
      // A failed background check (offline) stays silent; one the person asked for says why.
      if (!quiet) set({ state: 'error', message: `업데이트를 확인하지 못했어요 (${e.message})` });
    }
    return state;
  }

  async function download() {
    if (!found || state.state !== 'available') return state;
    const file = path.join(dir, found.asset.name);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      set({ state: 'downloading', version: found.version, progress: 0 });
      const r = await net.fetch(found.asset.url);
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const total = Number(r.headers.get('content-length')) || found.asset.size || 0;
      const out = fs.createWriteStream(file, { mode: 0o600 });
      let got = 0;
      let shown = 0;
      for await (const chunk of r.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
        const p = total ? Math.floor((got / total) * 100) : 0;
        if (p !== shown) set({ state: 'downloading', version: found.version, progress: (shown = p) });
      }
      await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
      const [sumsText, sigBase64] = await Promise.all([getText(found.sums), getText(found.sig)]);
      if (!verifyDownload({ sumsText, sigBase64, publicKeyPem: PUBLIC_KEY, fileName: found.asset.name, fileSha256: await sha256File(file) })) {
        throw new Error('받은 파일의 서명이 맞지 않아요');
      }
      if (mac) {
        const target = path.join(dir, 'unpacked');
        await run('/usr/bin/ditto', ['-x', '-k', file, target]);
        const appDir = fs.readdirSync(target).find((n) => n.endsWith('.app'));
        const info = appDir ? bundleInfo(path.join(target, appDir)) : {};
        if (info.id !== APP_ID || info.version !== found.version) throw new Error('받은 앱이 Agent Desk가 아니에요');
        staged = { kind: 'mac', app: path.join(target, appDir) };
      } else staged = { kind: 'win', installer: file };
      set({ state: 'ready', version: found.version, pending: false });
    } catch (e) {
      staged = null;
      fs.rmSync(dir, { recursive: true, force: true });
      set({ state: 'error', message: `업데이트를 받지 못했어요: ${e.message}` });
    }
    return state;
  }

  /** Mark the staged update to be applied when the app quits (now, or when the person quits later). */
  function defer() {
    if (staged) set({ ...state, pending: true });
    return state;
  }

  /** Called by main as the very last step of quitting. Starts the swap, which waits for this process to exit. */
  function applyOnExit() {
    if (!staged) return false;
    if (staged.kind === 'mac') {
      const current = replaceableApp(process.execPath);
      if (!current) return false;
      const script = path.join(os.tmpdir(), `agentdesk-swap-${process.pid}.sh`);
      fs.writeFileSync(script, macSwapScript(), { mode: 0o700 });
      spawn('/bin/sh', [script, String(process.pid), current, staged.app], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // NSIS: silent per-user install over this one, then start the app again.
      spawn(staged.installer, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    }
    staged = null;
    return true;
  }

  function start() {
    setTimeout(() => check(), 15_000).unref?.();
    timer = setInterval(() => check(), EVERY_MS);
    timer.unref?.();
  }

  return {
    start,
    get state() {
      return state;
    },
    check: () => check({ quiet: false }),
    download,
    defer,
    applyOnExit,
    openPage: () => found?.page && shell.openExternal(found.page),
  };
}
