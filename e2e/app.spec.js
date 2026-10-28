// The real app end to end: Electron window → core process → mock agents → hooks over the socket.
// AGENTDESK_E2E_EXE runs a packaged build instead of this checkout.
import { test, expect, _electron as electron, chromium } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';

function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# e2e repo\n');
  execSync('git init -q -b main && git add . && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });
  return dir;
}

let app; // dev checkout: Playwright's Electron handle
let packaged; // packaged build: the process, driven over the renderer's DevTools port
let page;
let tmp;
const problems = [];

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-e2e-'));
  const env = {
    ...process.env,
    AGENTDESK_HOME: path.join(tmp, 'home'),
    AGENTDESK_CLAUDE_BIN: path.join(root, 'test', win ? 'mock-claude.cmd' : 'mock-claude'),
    AGENTDESK_CODEX_BIN: path.join(root, 'test', win ? 'mock-codex.cmd' : 'mock-codex'),
    MOCK_WORK_MS: '300',
    MOCK_BG_MS: '4000',
    MOCK_TRANSCRIPT_DIR: path.join(tmp, 'transcripts'),
    AGENTDESK_TRANSCRIPT_ROOTS: path.join(tmp, 'transcripts'),
    CODEX_HOME: path.join(tmp, 'codex-home'),
    CLAUDE_CONFIG_DIR: path.join(tmp, 'claude-home'),
  };
  fs.mkdirSync(env.MOCK_TRANSCRIPT_DIR, { recursive: true });
  const exe = process.env.AGENTDESK_E2E_EXE;
  if (exe) {
    // The release build turns off --inspect (a fuse), so Playwright can't attach to its main
    // process; the window is reachable over Chromium's DevTools port instead.
    const port = 9300 + Math.floor(Math.random() * 600);
    packaged = spawn(exe, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 150 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (!browser) await new Promise((r) => setTimeout(r, 200));
    }
    if (!browser) throw new Error(`the packaged app never opened its DevTools port (exit ${packaged.exitCode})`);
    const context = browser.contexts()[0];
    page = context.pages().find((p) => p.url().startsWith('app://')) || (await context.waitForEvent('page'));
  } else {
    app = await electron.launch({ args: [root], env });
    page = await app.firstWindow();
  }
  // Anything the page logs as an error (CSP refusals included) fails the run at the end.
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
});

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  // Not a polite quit: with agents alive the app would ask first and stay open.
  packaged?.kill('SIGKILL');
});

test('the window loads the UI from app:// and the core pushes state', async () => {
  await expect.poll(() => page.url()).toBe('app://desk/');
  await expect.poll(() => page.evaluate(() => typeof window.desk?.api)).toBe('function');
  // No Node in the page, and nothing but the bridge.
  expect(await page.evaluate(() => typeof require)).toBe('undefined');
  expect(await page.evaluate(() => typeof process)).toBe('undefined');
  const st = await page.evaluate(async () => JSON.parse((await window.desk.api('GET', '/api/state')).body));
  expect(st.version).toBeTruthy();
  await expect(page.locator('#app')).not.toBeEmpty();
  await page.screenshot({ path: path.join(tmp, 'loaded.png') });
});

for (const agent of ['claude', 'codex']) {
  test(`${agent}: a task runs in its terminal and its hook moves it to "needs input"`, async () => {
    const repo = makeRepo(path.join(tmp, `repo-${agent}`));
    const call = (method, p, body) =>
      page.evaluate(async ([m, p, b]) => {
        const r = await window.desk.api(m, p, b === undefined ? undefined : JSON.stringify(b));
        return { status: r.status, json: JSON.parse(r.body || '{}') };
      }, [method, p, body]);
    const proj = await call('POST', '/api/projects', { path: repo });
    expect(proj.status).toBe(200);
    const t = (await call('POST', '/api/tasks', { projectId: proj.json.id, agent, prompt: 'just answer: 안녕' })).json;
    // Claude reports through its Stop hook; Codex through notify. Both arrive over the hook socket.
    await expect
      .poll(async () => (await call('GET', '/api/state')).json.tasks.find((x) => x.id === t.id)?.state, { timeout: 20_000 })
      .toBe('needs_input');
    const screen = (await call('GET', `/api/tasks/${t.id}/screen?lines=40`)).json;
    expect(screen.lines.join('\n')).toContain('안녕');
    await call('POST', `/api/tasks/${t.id}/discard`);
  });
}

test('a task room: the agent terminal, then the Monaco diff of its changes', async () => {
  const repo = makeRepo(path.join(tmp, 'repo-room'));
  const call = (method, p, body) =>
    page.evaluate(async ([m, p, b]) => JSON.parse((await window.desk.api(m, p, b === undefined ? undefined : JSON.stringify(b))).body || '{}'), [method, p, body]);
  const proj = await call('POST', '/api/projects', { path: repo });
  const t = await call('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'create notes/e2e.md 키 로테이션 정책' });
  await expect.poll(async () => (await call('GET', '/api/state')).tasks.find((x) => x.id === t.id)?.state, { timeout: 20_000 }).toBe('review');
  // The list view (not the board) shows rows; `b` switches between them.
  const row = page.locator('button.row', { hasText: t.title }).first();
  if (!(await row.isVisible())) await page.keyboard.press('b');
  await row.click();
  const term = page.locator('.xterm-rows').first();
  await expect(term).toContainText('반영 완료', { timeout: 10_000 });
  await page.keyboard.press('Alt+Digit2');
  await expect(page.locator('.monaco-diff-editor').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.monaco-diff-editor').first()).toContainText('로테이션');
  await page.screenshot({ path: path.join(tmp, 'review.png') });
});

test('the top bar is the title bar: room for the window controls, colors handed to the window', async () => {
  const os = process.platform === 'darwin' ? 'os-darwin' : process.platform === 'win32' ? 'os-win32' : `os-${process.platform}`;
  expect(await page.evaluate(() => document.documentElement.className)).toContain(os);
  const bar = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.topbar'));
    return { pl: cs.paddingLeft, pr: cs.paddingRight, drag: cs.getPropertyValue('-webkit-app-region') || cs.webkitAppRegion, bg: cs.backgroundColor };
  });
  if (process.platform === 'darwin') expect(bar.pl).toBe('84px');
  if (process.platform === 'win32') expect(parseFloat(bar.pr)).toBeGreaterThan(100);
  expect(bar.drag).toBe('drag');
  // A theme change on <html> reaches the window (and is kept for the next launch).
  const file = path.join(tmp, 'home', 'electron', 'chrome.json');
  const rgb = '#' + bar.bg.match(/\d+/g).slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('');
  expect(rgb).toBe('#1a1c21');
  await page.evaluate(() => document.documentElement.style.setProperty('--bg', '#f4f4f6'));
  await expect.poll(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).bg).toBe('#f4f4f6');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).dark).toBe(false);
  await page.evaluate(() => document.documentElement.style.removeProperty('--bg'));
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ bg: rgb, fg: expect.stringMatching(/^#[0-9a-f]{6}$/), dark: true });
  await page.screenshot({ path: path.join(tmp, 'titlebar.png'), clip: { x: 0, y: 0, width: 700, height: 60 } });
});

test('보관하기 takes a task off the list without stopping its story; 보관함 brings it back running', async () => {
  const repo = makeRepo(path.join(tmp, 'repo-shelf'));
  const call = (method, p, body) =>
    page.evaluate(async ([m, p, b]) => JSON.parse((await window.desk.api(m, p, b === undefined ? undefined : JSON.stringify(b))).body || '{}'), [method, p, body]);
  const task = async (id) => (await call('GET', '/api/state')).tasks.find((x) => x.id === id);
  const proj = await call('POST', '/api/projects', { path: repo });
  const t = await call('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'just answer: 나중에 이어서 볼 질문' });
  await expect.poll(async () => (await task(t.id))?.state, { timeout: 20_000 }).toBe('needs_input');
  const row = page.locator('button.row', { hasText: t.title }).first();
  if (!(await row.isVisible())) await page.keyboard.press('b');
  await row.click();

  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.modal .li', { hasText: '보관하기' }).first().click();
  await expect(row).toBeHidden();
  await expect.poll(async () => (await task(t.id))?.running).toBe(false);
  expect((await task(t.id)).archived).toBe(true);

  await page.locator('.shelf-link').click();
  const item = page.locator('.modal .srow', { hasText: t.title });
  await expect(item).toBeVisible();
  await page.screenshot({ path: path.join(tmp, 'shelf.png'), animations: 'disabled' });
  await item.getByRole('button', { name: '꺼내기' }).click();
  await expect(row).toBeVisible();
  await expect.poll(async () => (await task(t.id))?.running, { timeout: 10_000 }).toBe(true);
  expect((await task(t.id)).archived).toBe(false);
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('a turn that leaves a build running in the background waits in 작업 중, then comes up for review', async () => {
  const repo = makeRepo(path.join(tmp, 'repo-bg'));
  const call = (method, p, body) =>
    page.evaluate(async ([m, p, b]) => JSON.parse((await window.desk.api(m, p, b === undefined ? undefined : JSON.stringify(b))).body || '{}'), [method, p, body]);
  const state = async (id) => (await call('GET', '/api/state')).tasks.find((x) => x.id === id)?.state;
  const proj = await call('POST', '/api/projects', { path: repo });
  const t = await call('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'create notes/bg.md 백그라운드로 빌드' });
  await expect.poll(() => state(t.id), { timeout: 20_000 }).toBe('waiting');
  const row = page.locator('button.row', { hasText: t.title }).first();
  if (!(await row.isVisible())) await page.keyboard.press('b');
  const lane = page.locator('section[aria-label="작업 중"]');
  await expect(lane.locator('button.row', { hasText: t.title })).toBeVisible();
  await expect(row).toContainText('백그라운드 작업이 끝나면 이어서 해요 · 셸: npm run build');
  await expect(row.locator('.ti-hourglass')).toBeVisible();
  await page.screenshot({ path: path.join(tmp, 'waiting.png'), animations: 'disabled' });
  await expect.poll(() => state(t.id), { timeout: 20_000 }).toBe('review');
  await expect(page.locator('section[aria-label="검토할 것"] button.row', { hasText: t.title })).toBeVisible();
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('an agent stuck on a permission gets its own lane above everything, in the warning color', async () => {
  const repo = makeRepo(path.join(tmp, 'repo-ask'));
  const call = (method, p, body) =>
    page.evaluate(async ([m, p, b]) => JSON.parse((await window.desk.api(m, p, b === undefined ? undefined : JSON.stringify(b))).body || '{}'), [method, p, body]);
  const task = async (id) => (await call('GET', '/api/state')).tasks.find((x) => x.id === id);
  const proj = await call('POST', '/api/projects', { path: repo });
  const t = await call('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'ask before deleting build' });
  await expect.poll(async () => (await task(t.id))?.ask, { timeout: 20_000 }).toBe('permission');

  if (!(await page.locator('.inbox-list').isVisible())) await page.keyboard.press('b');
  await expect(page.locator('.inbox-list section').first()).toHaveAttribute('aria-label', '허락·선택할 것');
  const row = page.locator('section[aria-label="허락·선택할 것"] button.row.blocked', { hasText: t.title });
  await expect(row).toContainText('허락을 기다려요 · Bash: rm -rf build');
  await expect(row.locator('.ti-shield-question')).toBeVisible();
  await expect(page.locator('.chip .count.hot').first()).toBeVisible();
  await page.screenshot({ path: path.join(tmp, 'blocked-list.png'), animations: 'disabled' });

  await page.keyboard.press('b');
  const card = page.locator('article.card', { hasText: t.title });
  await expect(card.locator('.stchip.blocked')).toContainText('허락 필요');
  await page.screenshot({ path: path.join(tmp, 'blocked-board.png'), animations: 'disabled' });
  // Answered from the card, it's just working again.
  await card.locator('.cmenu button.opt').first().click();
  await expect.poll(async () => (await task(t.id))?.ask).toBe('');
  await expect(card.locator('.stchip.blocked')).toHaveCount(0);
  await page.keyboard.press('b');
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('no errors or CSP refusals in the page', () => {
  expect(problems).toEqual([]);
});

test('links leave the app instead of navigating it', async () => {
  const before = page.url();
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'file:///etc/passwd';
    document.body.append(a);
    a.click();
  });
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
});
