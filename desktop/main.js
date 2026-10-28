// Agent Desk's main process: the window, the app:// page, menus and lifecycle. The Desk itself
// runs in a separate core process (core-host.js); this process only connects windows to it.
import { app, BrowserWindow, Menu, MessageChannelMain, dialog, ipcMain, protocol, session, shell, utilityProcess } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Must run before the app is ready, ahead of any await.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const here = path.dirname(fileURLToPath(import.meta.url));
const hookAt = process.argv.indexOf('--desk-hook');
// Another data dir (dev, tests) is another Desk: its own browser profile and single-instance lock,
// so it never collides with the installed app the person is using.
if (process.env.AGENTDESK_HOME) app.setPath('userData', path.join(process.env.AGENTDESK_HOME, 'electron'));

if (hookAt !== -1) {
  // Hook client mode: an agent's hook ran this binary. Forward the event and leave, no window.
  app.dock?.hide();
  const { runHook } = await import('../server/hook.mjs');
  await runHook(process.argv.slice(hookAt + 1)).catch(() => {});
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  // Not awaited: Electron emits `ready` only after this module finishes evaluating.
  runApp().catch((e) => {
    dialog.showErrorBox('Agent Desk를 시작하지 못했어요', String(e?.stack || e));
    app.exit(1);
  });
}

async function runApp() {
  const { serve, isTrustedFrame, isExternalAllowed, ORIGIN } = await import('./protocol.js');
  const { loginShellEnv, mergeEnv } = await import('./env.js');
  const { retireDaemon } = await import('./legacy.js');
  const { dataDir } = await import('../server/util.js');

  const DIST = path.join(app.getAppPath(), 'ui', 'dist');
  const mac = process.platform === 'darwin';
  let win = null;
  let quitting = false;

  if (process.platform === 'win32') app.setAppUserModelId('dev.uyeon.agentdesk');
  app.on('second-instance', () => showWindow());
  await app.whenReady();

  // ------------------------------------------------------------ before the core starts

  const env = mac ? mergeEnv(process.env, await loginShellEnv(), app.getLocale()) : { ...process.env };
  const dir = dataDir();
  if ((await retireDaemon(dir)) === 'unreachable') {
    await dialog.showMessageBox({
      type: 'warning',
      message: '이전 버전의 Agent Desk 서비스가 아직 실행 중이에요',
      detail: '같은 작업 목록을 두 곳에서 고치지 않도록 이 앱을 닫을게요. 터미널에서 agentdesk stop 을 실행한 뒤 다시 열어 주세요.',
    });
    return app.exit(1);
  }

  protocol.handle('app', (req) => {
    const r = serve(DIST, req.url);
    return new Response(r.body, { status: r.status, headers: r.headers });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'notifications'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');

  // ------------------------------------------------------------ core process

  // How agents' hooks reach the core when curl can't: this very binary, in hook mode.
  const hookClient = app.isPackaged ? [process.execPath, '--desk-hook'] : [process.execPath, app.getAppPath(), '--desk-hook'];
  const log = fs.createWriteStream(path.join(dir, 'core.log'), { flags: 'a', mode: 0o600 });
  let core = null;
  let coreReady = null;
  const restarts = [];
  const asks = [];

  function startCore() {
    const child = utilityProcess.fork(path.join(here, 'core-host.js'), [], {
      serviceName: 'Agent Desk Core',
      stdio: 'pipe',
      env: { ...env, AGENTDESK_HOOK_CLIENT: JSON.stringify(hookClient) },
    });
    const relay = (d) => {
      log.write(d);
      if (!app.isPackaged) process.stdout.write(d);
    };
    child.stdout?.on('data', relay);
    child.stderr?.on('data', relay);
    coreReady = new Promise((resolve) => {
      child.on('message', async (m) => {
        if (m?.t === 'ready') {
          core = child;
          resolve(true);
          if (win) connectWindow(win);
        } else if (m?.t === 'error') {
          resolve(false);
          await dialog.showMessageBox({ type: 'error', message: 'Agent Desk를 시작하지 못했어요', detail: m.message });
          app.exit(1);
        } else if (m?.t === 'badge') {
          app.setBadgeCount(m.n);
        } else if (m?.t === 'status' || m?.t === 'bye') {
          asks.shift()?.(m);
        }
      });
    });
    child.on('exit', (code) => {
      if (core === child) core = null;
      while (asks.length) asks.shift()({ t: 'gone' });
      if (quitting) return;
      win?.webContents.send('desk:core-down');
      // A crash (a native terminal error, say) shouldn't end the app: start over, unless it keeps dying.
      const now = Date.now();
      restarts.push(now);
      while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
      if (restarts.length > 4) {
        dialog.showErrorBox('Agent Desk 코어가 계속 멈춰요', `종료 코드 ${code}. ${path.join(dir, 'core.log')} 에 기록이 있어요.`);
        return app.exit(1);
      }
      setTimeout(startCore, 1000);
    });
  }

  function ask(t) {
    if (!core) return Promise.resolve({ t: 'gone' });
    return new Promise((resolve) => {
      asks.push(resolve);
      core.postMessage({ t });
    });
  }

  /** Give the window a fresh private channel to the core. Only our own top-level page gets one. */
  function connectWindow(w) {
    if (!core || w.isDestroyed() || !isTrustedFrame(w.webContents.mainFrame)) return;
    const { port1, port2 } = new MessageChannelMain();
    core.postMessage({ t: 'peer' }, [port1]);
    w.webContents.postMessage('desk:port', null, [port2]);
  }

  // ------------------------------------------------------------ window

  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 860,
      minHeight: 560,
      show: false,
      backgroundColor: '#111113',
      title: 'Agent Desk',
      autoHideMenuBar: !mac,
      webPreferences: {
        preload: path.join(here, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });
    const wc = win.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (isExternalAllowed(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    // The page never navigates; links (PRs, vscode://) go to the OS instead.
    wc.on('will-navigate', (e, url) => {
      e.preventDefault();
      if (isExternalAllowed(url)) shell.openExternal(url);
    });
    wc.on('did-finish-load', () => connectWindow(win));
    wc.on('context-menu', (_e, params) => editMenu(params).popup({ window: win }));
    win.once('ready-to-show', () => win.show());
    win.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      // macOS: closing the window keeps agents running (and notifying); the Dock brings it back.
      if (mac) win.hide();
      else requestQuit();
    });
    win.on('closed', () => (win = null));
    win.loadURL(`${ORIGIN}/`);
  }

  function showWindow() {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  ipcMain.on('desk:focus', (e) => {
    if (isTrustedFrame(e.senderFrame)) showWindow();
  });

  // ------------------------------------------------------------ menus

  function editMenu(params) {
    const f = params.editFlags;
    return Menu.buildFromTemplate([
      { role: 'cut', label: '잘라내기', enabled: f.canCut },
      { role: 'copy', label: '복사', enabled: f.canCopy },
      { role: 'paste', label: '붙여넣기', enabled: f.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: '모두 선택', enabled: f.canSelectAll },
    ]);
  }

  // The page sees keys before the menu does and already claims its own (⌘Z after a send), so the
  // standard Edit roles stay: text fields still undo, copy and paste through them on macOS.
  // Windows gets no menu bar: a lone Alt would otherwise move focus out of the terminal.
  Menu.setApplicationMenu(
    mac
      ? Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          {
            label: '보기',
            submenu: [
              { role: 'resetZoom', label: '실제 크기' },
              { role: 'zoomIn', label: '확대' },
              { role: 'zoomOut', label: '축소' },
              { type: 'separator' },
              { role: 'togglefullscreen', label: '전체 화면' },
              ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
            ],
          },
          { role: 'windowMenu' },
        ])
      : null
  );

  // ------------------------------------------------------------ quitting

  let asking = false;
  async function requestQuit() {
    if (asking || quitting) return;
    asking = true;
    try {
      const { running = 0 } = await ask('status');
      if (running > 0) {
        if (mac) showWindow();
        const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
          type: 'warning',
          buttons: ['종료', '취소'],
          defaultId: 1,
          cancelId: 1,
          message: `실행 중인 에이전트 ${running}개가 멈춰요`,
          detail: '작업 내용은 남아 있고, 다시 열면 이어서 재개할 수 있어요.',
        });
        if (response !== 0) return;
      }
      quitting = true;
      await Promise.race([ask('shutdown'), new Promise((r) => setTimeout(r, 3000))]);
      app.quit();
    } finally {
      asking = false;
    }
  }

  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    requestQuit();
  });
  app.on('activate', () => showWindow());

  startCore();
  createWindow();
  if (!(await coreReady)) return;
}
