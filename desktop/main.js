// Agent Desk's main process: the window, the app:// page, menus and lifecycle. The Desk itself
// runs in a separate core process (core-host.js); this process only connects windows to it.
import { app, BrowserWindow, Menu, MessageChannelMain, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, net, protocol, screen, session, shell, utilityProcess } from 'electron';
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
  const { createUpdater } = await import('./updater.js');
  const { dataDir } = await import('../server/util.js');

  const DIST = path.join(app.getAppPath(), 'ui', 'dist');
  const mac = process.platform === 'darwin';
  const { panelBounds, shouldToggle, normalizeAccel, PANEL_W } = await import('./panel.js');
  let win = null;
  let panel = null;
  let tray = null;
  let quitting = false;
  /** Every window that talks to the core: the main one and the quick panel. */
  const windows = () => [win, panel].filter((w) => w && !w.isDestroyed());

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
          for (const w of windows()) connectWindow(w);
        } else if (m?.t === 'error') {
          resolve(false);
          await dialog.showMessageBox({ type: 'error', message: 'Agent Desk를 시작하지 못했어요', detail: m.message });
          app.exit(1);
        } else if (m?.t === 'badge') {
          app.setBadgeCount(m.n);
          setTrayCount(m.n, m.blocked || 0);
        } else if (m?.t === 'attention') {
          attention();
        } else if (m?.t === 'status' || m?.t === 'bye') {
          asks.shift()?.(m);
        }
      });
    });
    child.on('exit', (code) => {
      if (core === child) core = null;
      while (asks.length) asks.shift()({ t: 'gone' });
      if (quitting) return;
      for (const w of windows()) w.webContents.send('desk:core-down');
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

  // ------------------------------------------------------------ window chrome & theme

  // The title bar is the page's own top bar: macOS keeps only the traffic lights, Windows overlays
  // its caption buttons. The page reports the colors of each theme it shows (light and dark kept
  // apart), so the next launch opens in the right colors before the page has loaded.
  const BAR_H = 44;
  const chromeFile = path.join(app.getPath('userData'), 'chrome.json');
  const themeFile = path.join(app.getPath('userData'), 'theme.json');
  let chrome = { dark: { bg: '#121318', fg: '#ececf1' }, light: { bg: '#f3f3f5', fg: '#1a1b1f' } };
  try {
    const saved = JSON.parse(fs.readFileSync(chromeFile, 'utf8'));
    for (const k of ['dark', 'light']) if (isHex(saved[k]?.bg) && isHex(saved[k]?.fg)) chrome[k] = { bg: saved[k].bg, fg: saved[k].fg };
  } catch {}
  // The person's theme choice (see ui/src/app/theme.js); only its shape is checked here.
  let themePrefs = { mode: 'system', glass: 'rich', vibrancy: true, ambient: true };
  try {
    themePrefs = { ...themePrefs, ...cleanPrefs(JSON.parse(fs.readFileSync(themeFile, 'utf8'))) };
  } catch {}
  nativeTheme.themeSource = themePrefs.mode === 'fixed' && ['light', 'dark'].includes(themePrefs.fixedKind) ? themePrefs.fixedKind : 'system';

  function isHex(c) {
    return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  }
  function cleanPrefs(p) {
    const out = {};
    for (const [k, v] of Object.entries(p || {})) {
      if (!/^[a-zA-Z]{1,24}$/.test(k)) continue;
      if (typeof v === 'boolean' || (typeof v === 'string' && v.length <= 120 && /^[\w.-]*$/.test(v))) out[k] = v;
    }
    return out;
  }
  const scheme = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  // macOS: the desktop shows faintly through the window (the page draws its own tint over it).
  const seeThrough = () => mac && themePrefs.vibrancy !== false && themePrefs.glass !== 'off';

  function applyChrome(w) {
    if (!w || w.isDestroyed()) return;
    const c = chrome[scheme()];
    if (w === win) {
      if (mac) {
        w.setVibrancy(seeThrough() ? 'under-window' : null);
        w.setBackgroundColor(seeThrough() ? '#00000000' : c.bg);
      } else {
        w.setBackgroundColor(c.bg);
        w.setTitleBarOverlay({ color: c.bg, symbolColor: c.fg, height: BAR_H - 1 });
      }
    }
  }
  nativeTheme.on('updated', () => applyChrome(win));

  ipcMain.on('desk:chrome', (e, c) => {
    if (!isTrustedFrame(e.senderFrame) || !isHex(c?.bg) || !isHex(c?.fg) || !['dark', 'light'].includes(c?.scheme)) return;
    const next = { bg: c.bg.toLowerCase(), fg: c.fg.toLowerCase() };
    if (next.bg === chrome[c.scheme].bg && next.fg === chrome[c.scheme].fg) return;
    chrome[c.scheme] = next;
    applyChrome(win);
    try {
      fs.writeFileSync(chromeFile, JSON.stringify(chrome));
    } catch {}
  });

  ipcMain.handle('desk:theme-prefs', (e) => (isTrustedFrame(e.senderFrame) ? themePrefs : null));
  ipcMain.on('desk:theme-set', (e, p) => {
    if (!isTrustedFrame(e.senderFrame) || !p || typeof p !== 'object') return;
    themePrefs = { ...themePrefs, ...cleanPrefs(p) };
    nativeTheme.themeSource = themePrefs.mode === 'fixed' && ['light', 'dark'].includes(themePrefs.fixedKind) ? themePrefs.fixedKind : 'system';
    try {
      fs.writeFileSync(themeFile, JSON.stringify(themePrefs));
    } catch {}
    applyChrome(win);
    for (const w of windows()) if (w.webContents !== e.sender) w.webContents.send('desk:theme-prefs', themePrefs);
  });

  /** What every page window gets: links leave the app, nothing navigates, our own context menus. */
  function harden(w) {
    const wc = w.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (isExternalAllowed(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    // The page never navigates; links (PRs, vscode://) go to the OS instead.
    wc.on('will-navigate', (e, url) => {
      e.preventDefault();
      if (isExternalAllowed(url)) shell.openExternal(url);
    });
    wc.on('did-finish-load', () => connectWindow(w));
    // The page shows its own menus for tasks and terminals; this one is for text, links and images.
    wc.on('context-menu', (_e, params) => contextMenu(params, wc)?.popup({ window: w }));
  }

  const webPreferences = {
    preload: path.join(here, 'preload.cjs'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  };

  // ------------------------------------------------------------ window

  function createWindow() {
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 860,
      minHeight: 560,
      show: false,
      backgroundColor: seeThrough() ? '#00000000' : chrome[scheme()].bg,
      title: 'Agent Desk',
      ...(mac
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 }, ...(seeThrough() ? { vibrancy: 'under-window', visualEffectState: 'followWindow' } : {}) }
        : { titleBarStyle: 'hidden', titleBarOverlay: { color: chrome[scheme()].bg, symbolColor: chrome[scheme()].fg, height: BAR_H - 1 } }),
      webPreferences,
    });
    const wc = win.webContents;
    harden(win);
    win.once('ready-to-show', () => {
      win.show();
      // The quick panel is made ahead, hidden, so it appears the instant it's called.
      setTimeout(createPanel, 1500);
    });
    // Full screen hides the traffic lights: the top bar can use that space again.
    win.on('enter-full-screen', () => wc.send('desk:fullscreen', true));
    win.on('leave-full-screen', () => wc.send('desk:fullscreen', false));
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

  /** An agent just got stuck on the person: bounce the Dock icon / flash the taskbar, unless they're looking. */
  function attention() {
    if (win?.isFocused()) return;
    if (process.platform === 'darwin') app.dock?.bounce('informational');
    else if (win) {
      win.flashFrame(true);
      win.once('focus', () => win?.flashFrame(false));
    }
  }

  ipcMain.on('desk:focus', (e) => {
    if (isTrustedFrame(e.senderFrame)) showWindow();
  });

  // ------------------------------------------------------------ quick panel, tray, shortcut

  let panelHiddenAt = 0;
  let panelFrom = 'shortcut';
  function createPanel() {
    if (panel && !panel.isDestroyed()) return panel;
    panel = new BrowserWindow({
      width: PANEL_W,
      height: 360,
      show: false,
      frame: false,
      resizable: false,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      title: 'Agent Desk',
      ...(mac ? { type: 'panel', vibrancy: 'popover', visualEffectState: 'active', transparent: true, backgroundColor: '#00000000', roundedCorners: true } : { backgroundColor: chrome[scheme()].bg }),
      webPreferences,
    });
    if (mac) panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    harden(panel);
    panel.on('blur', () => {
      if (panel.webContents.isDevToolsOpened()) return;
      panelHiddenAt = Date.now();
      panel.hide();
    });
    panel.on('closed', () => (panel = null));
    panel.loadURL(`${ORIGIN}/panel.html`);
    return panel;
  }

  function placePanel(height) {
    const p = createPanel();
    const cursor = screen.getCursorScreenPoint();
    const trayB = tray?.getBounds();
    const display = panelFrom === 'tray' && trayB ? screen.getDisplayMatching(trayB) : screen.getDisplayNearestPoint(cursor);
    p.setBounds(panelBounds({ from: panelFrom, tray: trayB, display, height: height || p.getBounds().height, platform: process.platform }));
  }

  function togglePanel(from = 'shortcut') {
    const p = createPanel();
    if (p.isVisible()) return p.hide();
    if (from === 'tray' && !shouldToggle(panelHiddenAt)) return;
    panelFrom = from;
    placePanel();
    p.show();
    p.focus();
    p.webContents.send('desk:panel-shown');
  }

  ipcMain.on('desk:panel', (e, action, arg) => {
    if (!isTrustedFrame(e.senderFrame)) return;
    if (action === 'toggle') togglePanel('shortcut');
    else if (action === 'hide') panel?.hide();
    else if (action === 'resize' && panel && Number.isFinite(arg)) placePanel(arg);
  });
  // "Open this in the app": from the panel (or a notification) to the main window, on that task.
  ipcMain.on('desk:open', (e, target) => {
    if (!isTrustedFrame(e.senderFrame) || typeof target?.taskId !== 'string' || target.taskId.length > 64) return;
    panel?.hide();
    showWindow();
    win?.webContents.send('desk:navigate', { taskId: target.taskId, view: ['chat', 'review', 'files'].includes(target.view) ? target.view : undefined });
  });

  function trayIcon(hot) {
    const name = mac ? 'trayTemplate.png' : hot ? 'trayHot.png' : 'tray.png';
    const img = nativeImage.createFromPath(path.join(here, 'assets', name));
    if (mac) img.setTemplateImage(true);
    return img;
  }
  function createTray() {
    if (tray) return;
    tray = new Tray(trayIcon(false));
    tray.setToolTip('Agent Desk');
    tray.on('click', () => togglePanel('tray'));
    tray.on('right-click', () =>
      tray.popUpContextMenu(
        Menu.buildFromTemplate([
          { label: 'Agent Desk 열기', click: () => showWindow() },
          { label: '빠른 창', accelerator: shortcutAccel, click: () => togglePanel('tray') },
          { type: 'separator' },
          { label: '종료', click: () => requestQuit() },
        ])
      )
    );
  }
  let trayState = '';
  function setTrayCount(n, blocked) {
    if (!tray) return;
    const key = `${n}|${blocked}`;
    if (key === trayState) return;
    trayState = key;
    if (mac) tray.setTitle(n ? String(n) : '', { fontType: 'monospacedDigit' });
    else tray.setImage(trayIcon(blocked > 0));
    tray.setToolTip(n ? `Agent Desk · 기다리는 작업 ${n}개${blocked ? ` · 허락·선택 ${blocked}개` : ''}` : 'Agent Desk');
  }

  // The global shortcut for the panel: ⌥Space unless the person picked another.
  const uiFile = path.join(app.getPath('userData'), 'ui.json');
  let shortcutAccel = 'Alt+Space';
  let shortcutOk = false;
  try {
    const saved = JSON.parse(fs.readFileSync(uiFile, 'utf8'));
    if (normalizeAccel(saved.shortcut)) shortcutAccel = normalizeAccel(saved.shortcut);
  } catch {}
  function registerShortcut(accel) {
    try {
      return globalShortcut.register(accel, () => togglePanel('shortcut'));
    } catch {
      return false;
    }
  }
  ipcMain.handle('desk:shortcut', (e, action, accel) => {
    if (!isTrustedFrame(e.senderFrame)) return null;
    if (action === 'set') {
      const next = normalizeAccel(accel);
      if (!next) return { ok: false, accel: shortcutAccel, reason: '이 조합은 쓸 수 없어요 · 수정 키와 다른 키 하나를 같이 눌러 주세요' };
      if (shortcutOk) globalShortcut.unregister(shortcutAccel);
      if (registerShortcut(next)) {
        shortcutAccel = next;
        shortcutOk = true;
        try {
          fs.writeFileSync(uiFile, JSON.stringify({ shortcut: next }));
        } catch {}
        return { ok: true, accel: next };
      }
      shortcutOk = registerShortcut(shortcutAccel);
      return { ok: false, accel: shortcutAccel, reason: '다른 앱이 이 단축키를 쓰고 있어요' };
    }
    return { ok: shortcutOk, accel: shortcutAccel, reason: shortcutOk ? '' : '등록하지 못했어요 · 다른 앱(Claude, ChatGPT, Raycast, Alfred 등)이 쓰고 있을 수 있어요' };
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  // For the page's own menus. The page can write the clipboard but never read it: a paste goes
  // into whatever has focus, the same as ⌘V.
  ipcMain.on('desk:copy', (e, text) => {
    if (isTrustedFrame(e.senderFrame) && typeof text === 'string' && text) clipboard.writeText(text.slice(0, 5_000_000));
  });
  const EDITS = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  ipcMain.on('desk:edit', (e, cmd) => {
    if (isTrustedFrame(e.senderFrame) && EDITS.has(cmd)) e.sender[cmd]();
  });
  // Selects the folder in Finder / Explorer; nothing is opened or run.
  ipcMain.on('desk:reveal', (e, p) => {
    if (isTrustedFrame(e.senderFrame) && typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p)) shell.showItemInFolder(p);
  });

  // ------------------------------------------------------------ updates (see updater.js)

  const updater = createUpdater({ app, net, shell, send: (s) => win?.webContents.send('desk:update-state', s) });

  /** "Restart to update": agents that are still running decide whether it happens now or at quit. */
  async function applyUpdateNow() {
    const { running = 0 } = await ask('status');
    if (running > 0) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['종료할 때 적용', '지금 재시작'],
        defaultId: 0,
        cancelId: 0,
        message: `에이전트 ${running}개가 실행 중이에요`,
        detail: '지금 재시작하면 에이전트가 멈춰요. 종료할 때 적용하면 작업이 끝난 뒤 다음에 열 때 새 버전이 떠요.',
      });
      if (response === 0) return updater.defer();
    }
    updater.defer();
    requestQuit({ confirmed: true });
    return updater.state;
  }

  async function checkFromMenu() {
    const s = await updater.check();
    if (s.state === 'none') dialog.showMessageBox(win, { type: 'info', message: '최신 버전이에요', detail: `Agent Desk ${app.getVersion()}` });
    else showWindow();
  }

  ipcMain.handle('desk:update', (e, action) => {
    if (!isTrustedFrame(e.senderFrame)) return null;
    if (action === 'state') return updater.state;
    if (action === 'check') return updater.check();
    if (action === 'download') return updater.download();
    if (action === 'apply') return applyUpdateNow();
    if (action === 'page') return updater.openPage();
    return null;
  });

  // ------------------------------------------------------------ menus

  /** Only what applies where you clicked; nothing at all on plain page background. */
  function contextMenu(params, wc) {
    const f = params.editFlags;
    const sep = { type: 'separator' };
    const items = [];
    const link = params.linkURL && isExternalAllowed(params.linkURL) ? params.linkURL : '';
    if (link) items.push({ label: '링크 열기', click: () => shell.openExternal(link) }, { label: '링크 주소 복사', click: () => clipboard.writeText(link) }, sep);
    if (params.isEditable) {
      items.push(
        { role: 'undo', label: '실행 취소', enabled: f.canUndo },
        { role: 'redo', label: '다시 실행', enabled: f.canRedo },
        sep,
        { role: 'cut', label: '잘라내기', enabled: f.canCut },
        { role: 'copy', label: '복사', enabled: f.canCopy },
        { role: 'paste', label: '붙여넣기', enabled: f.canPaste },
        sep,
        { role: 'selectAll', label: '모두 선택', enabled: f.canSelectAll },
      );
    } else if (params.selectionText.trim()) items.push({ role: 'copy', label: '복사' });
    if (params.mediaType === 'image' && params.hasImageContents) items.push(sep, { label: '이미지 복사', click: () => wc.copyImageAt(params.x, params.y) });
    const tidy = items.filter((it, i) => it !== sep || (i > 0 && items[i - 1] !== sep && i < items.length - 1));
    return tidy.length ? Menu.buildFromTemplate(tidy) : null;
  }

  // The page sees keys before the menu does and already claims its own (⌘Z after a send), so the
  // standard Edit roles stay: text fields still undo, copy and paste through them on macOS.
  // Windows gets no menu bar: a lone Alt would otherwise move focus out of the terminal.
  Menu.setApplicationMenu(
    mac
      ? Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [
              { role: 'about', label: `${app.name} 정보` },
              { label: '업데이트 확인…', click: () => checkFromMenu() },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
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
  async function requestQuit({ confirmed = false } = {}) {
    if (asking || quitting) return;
    asking = true;
    try {
      const { running = 0 } = await ask('status');
      if (running > 0 && !confirmed) {
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
      // The core waits up to 3 s for terminals to close before it answers.
      await Promise.race([ask('shutdown'), new Promise((r) => setTimeout(r, 5000))]);
      // A downloaded, verified update swaps in once this process has exited.
      updater.applyOnExit();
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
  createTray();
  shortcutOk = registerShortcut(shortcutAccel);
  updater.start();
  if (!(await coreReady)) return;
}
