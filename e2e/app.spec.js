// The real app end to end: Electron window → core process → mock agents → hooks over the socket.
// AGENTDESK_E2E_EXE runs a packaged build instead of this checkout.
import { test, expect, _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
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

let app;
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
    MOCK_TRANSCRIPT_DIR: path.join(tmp, 'transcripts'),
    AGENTDESK_TRANSCRIPT_ROOTS: path.join(tmp, 'transcripts'),
    CODEX_HOME: path.join(tmp, 'codex-home'),
    CLAUDE_CONFIG_DIR: path.join(tmp, 'claude-home'),
  };
  fs.mkdirSync(env.MOCK_TRANSCRIPT_DIR, { recursive: true });
  const exe = process.env.AGENTDESK_E2E_EXE;
  app = await electron.launch(exe ? { executablePath: exe, env } : { args: [root], env });
  page = await app.firstWindow();
  // Anything the page logs as an error (CSP refusals included) fails the run at the end.
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
});

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
});

test('the window loads the UI from app:// and the core pushes state', async () => {
  expect(page.url()).toBe('app://desk/');
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
  await page.keyboard.press('b');
  await page.locator('button.row', { hasText: t.title }).first().click();
  const term = page.locator('.xterm-rows').first();
  await expect(term).toContainText('반영 완료', { timeout: 10_000 });
  await page.keyboard.press('Alt+Digit2');
  await expect(page.locator('.monaco-diff-editor').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.monaco-diff-editor').first()).toContainText('로테이션');
  await page.screenshot({ path: path.join(tmp, 'review.png') });
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
