// The real app end to end: Electron window → core process → mock agents → hooks over the socket.
// AGENTDESK_E2E_EXE runs a packaged build instead of this checkout. Selectors are roles, names
// and a few data-testids, never class names.
import { test, expect, _electron as electron, chromium } from '@playwright/test';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

function makeRepo(dir, files = { 'README.md': '# e2e repo\n' }) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  execSync('git init -q -b main && git add . && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });
  return dir;
}

let app; // dev checkout: Playwright's Electron handle
let packaged; // packaged build: the process, driven over the renderer's DevTools port
let context;
let page;
let tmp;
const problems = [];
const shots = (name) => path.join(tmp, 'screens', name + '.png');

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-e2e-'));
  fs.mkdirSync(path.join(tmp, 'screens'));
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
    MOCK_REWIND_LOG: path.join(tmp, 'rewind.log'),
  };
  fs.mkdirSync(env.MOCK_TRANSCRIPT_DIR, { recursive: true });
  const exe = process.env.AGENTDESK_E2E_EXE;
  if (exe) {
    // The release build turns off --inspect (a fuse), so Playwright can't attach to its main
    // process; the windows are reachable over Chromium's DevTools port instead.
    const port = 9300 + Math.floor(Math.random() * 600);
    packaged = spawn(exe, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
    let browser;
    for (let i = 0; i < 150 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (!browser) await new Promise((r) => setTimeout(r, 200));
    }
    if (!browser) throw new Error(`the packaged app never opened its DevTools port (exit ${packaged.exitCode})`);
    context = browser.contexts()[0];
    const isMain = (p) => p.url() === 'app://desk/';
    page = context.pages().find(isMain) || (await context.waitForEvent('page', { predicate: isMain }));
  } else {
    app = await electron.launch({ args: [root], env });
    page = await app.firstWindow();
  }
  // Anything the page logs as an error (CSP refusals included) fails the run at the end.
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.waitForFunction(() => document.documentElement.dataset.themeKind);
});

test.afterAll(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  // Not a polite quit: with agents alive the app would ask first and stay open.
  packaged?.kill('SIGKILL');
});

const call = (method, p, body) =>
  page.evaluate(async ([m, p, b]) => {
    const r = await window.desk.api(m, p, b === undefined ? undefined : JSON.stringify(b));
    return JSON.parse(r.body || '{}');
  }, [method, p, body]);
const task = async (id) => (await call('GET', '/api/state')).tasks.find((x) => x.id === id);
const until = (id, pred, timeout = 20_000) => expect.poll(async () => pred(await task(id)), { timeout }).toBe(true);
const row = (id) => page.locator(`[data-testid="rail-row"][data-task-id="${id}"]`);
const card = () => page.getByTestId('prompt-card');
// Keys like Space and B act when no field or button has focus; a click could land on a control.
const navMode = () => page.evaluate(() => document.activeElement?.blur());
const project = async (name, files) => call('POST', '/api/projects', { path: makeRepo(path.join(tmp, name), files) });
const start = async (projectId, prompt, agent = 'claude') => call('POST', '/api/tasks', { projectId, agent, prompt });
const toList = async () => {
  if (await page.getByTestId('rail').isHidden()) await page.keyboard.press('b');
};

test('the window loads the UI from app:// and the core pushes state', async () => {
  await expect.poll(() => page.url()).toBe('app://desk/');
  expect(await page.evaluate(() => typeof require)).toBe('undefined');
  expect(await page.evaluate(() => typeof process)).toBe('undefined');
  // The core starts beside the window (slower on Windows): ask until it answers.
  await expect.poll(async () => (await call('GET', '/api/state').catch(() => ({}))).version, { timeout: 20_000 }).toBeTruthy();
  await expect(page.getByTestId('titlebar')).toBeVisible();
  await page.screenshot({ path: shots('empty') });
});

for (const agent of ['claude', 'codex']) {
  test(`${agent}: a task runs and its hook moves it to "your turn"`, async () => {
    const p = await project(`repo-${agent}`);
    const t = await start(p.id, 'just answer: 안녕', agent);
    await until(t.id, (x) => x?.state === 'needs_input');
    const screen = await call('GET', `/api/tasks/${t.id}/screen?lines=40`);
    expect(screen.lines.join('\n')).toContain('안녕');
    await call('POST', `/api/tasks/${t.id}/discard`);
  });
}

test('the conversation: markdown replies, agent HTML as plain text, tool calls folded into a run', async () => {
  const p = await project('repo-convo', { 'README.md': '# convo\n' });
  const t = await start(p.id, 'create notes/e2e.md 마크다운으로 정리해줘 plan, run test');
  await until(t.id, (x) => x?.state === 'review');
  await toList();
  await row(t.id).click();
  const convo = page.getByTestId('conversation');
  await expect(convo.getByRole('heading', { name: '정리' })).toBeVisible();
  await expect(convo.getByText('<b>태그는 글자로</b>')).toBeVisible();
  expect(await convo.locator('b', { hasText: '태그는 글자로' }).count()).toBe(0);
  // Code is highlighted (spans), and the plan sits on top.
  await expect(convo.locator('code .tok-keyword').first()).toBeVisible();
  await expect(convo.getByText(/할 일 \d\/3/)).toBeVisible();
  const run = convo.locator('[data-kind="run"]').filter({ hasText: '명령' }).first();
  await run.getByRole('button', { expanded: false }).first().click();
  await run.getByRole('button', { name: /npm test/ }).click();
  await expect(run.getByText('Tests: 3 passed')).toBeVisible();
  await page.screenshot({ path: shots('conversation') });
  // ⌘2: the changes in Monaco's diff.
  await page.keyboard.press(`${MOD}+2`);
  await expect(page.locator('.monaco-diff-editor').first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press(`${MOD}+1`);
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('an Edit permission is a card with its diff; 허락 answers it in the CLI', async () => {
  const p = await project('repo-edit', { 'README.md': '# 원래 제목\n' });
  const t = await start(p.id, 'askedit 제목 바꾸기');
  await until(t.id, (x) => !!x?.prompt?.screen?.ready);
  await toList();
  await expect(row(t.id)).toHaveAttribute('data-state', 'blocked');
  await row(t.id).click();
  await expect(card()).toContainText('이 파일을 고칠까요?');
  await expect(card()).toContainText('# 원래 제목');
  await expect(card()).toContainText('# 바뀐 제목');
  await page.screenshot({ path: shots('permission-edit') });
  await card().getByRole('button', { name: /^1\s*허락$/ }).click();
  await until(t.id, (x) => x?.state === 'review');
  await expect(card()).toHaveCount(0);
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('two questions, one multi-select, answered on the card', async () => {
  const p = await project('repo-q');
  const t = await start(p.id, 'askq2 질문 두 개');
  await until(t.id, (x) => x?.prompt?.kind === 'question' && x.prompt.screen.ready);
  await toList();
  await row(t.id).click();
  await expect(card()).toContainText('어떤 주제로 할까요?');
  await card().getByRole('radio', { name: /토큰 정리/ }).click();
  await expect(card()).toContainText('어디까지 바꿀까요?');
  await card().getByRole('checkbox', { name: /버튼/ }).click();
  await card().getByRole('checkbox', { name: /카드/ }).click();
  await card().getByRole('button', { name: /답 제출/ }).click();
  await until(t.id, (x) => x?.messages?.some((m) => m.text === '주제 → 토큰 정리 · 범위 → 버튼, 카드'));
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('plan approval shows the plan; approving starts the work', async () => {
  const p = await project('repo-plan');
  const t = await start(p.id, 'planmode 버튼 정리');
  await until(t.id, (x) => x?.prompt?.kind === 'plan' && x.prompt.screen.ready);
  await toList();
  await row(t.id).click();
  await expect(card().getByRole('listitem').first()).toHaveText('버튼 크기를 키운다');
  await card().getByRole('button', { name: /승인 · 수정은 자동 허락/ }).click();
  await until(t.id, (x) => x?.state === 'review');
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('⌘K starts a task inline: Tab picks the project, Enter sends', async () => {
  const a = await project('repo-k1');
  const b = await project('repo-k2');
  // Wait until the new project has reached the window, as a person would see it in the project list.
  await page.getByTestId('project-switch').click();
  await expect(page.getByRole('option', { name: /repo-k2/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: '프로젝트' })).toBeHidden();
  await page.keyboard.press(`${MOD}+n`);
  const bar = page.getByTestId('command-bar');
  await expect(bar).toBeVisible();
  await page.keyboard.type('just answer: 명령 막대에서');
  // Tab until the target is repo-k2.
  for (let i = 0; i < 12 && !(await bar.getByRole('button', { name: /repo-k2/ }).isVisible()); i++) await page.keyboard.press('Tab');
  await expect(bar.getByRole('button', { name: /repo-k2/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(bar).toBeHidden();
  const t = (await call('GET', '/api/state')).tasks.find((x) => x.title.includes('명령 막대에서'));
  expect(t.projectId).toBe(b.id);
  void a;
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('차례로: Space walks through what waits on me; a digit answers and it moves on', async () => {
  const p = await project('repo-triage');
  const t1 = await start(p.id, 'ask before deleting build 하나');
  const t2 = await start(p.id, 'ask before deleting build 둘');
  for (const t of [t1, t2]) await until(t.id, (x) => !!x?.prompt?.screen?.ready);
  await toList();
  await navMode();
  await page.keyboard.press('Space');
  const bar = page.getByTestId('triage');
  await expect(bar).toContainText(/차례로 1\/\d/);
  // A digit answers the card on screen, so press it once the card is there.
  await expect(card()).toContainText('이 명령을 실행할까요?');
  await page.keyboard.press('1');
  await expect(bar).toContainText(/차례로 2\/\d/, { timeout: 10_000 });
  await expect(card()).toContainText('이 명령을 실행할까요?');
  await page.keyboard.press('1');
  await expect(page.getByText('다 처리했어요')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: shots('triage-done') });
  await page.getByRole('button', { name: /돌아가기/ }).click();
  for (const t of [t1, t2]) await call('POST', `/api/tasks/${t.id}/discard`);
});

test('관제탑: a stuck task is answered right on its tile', async () => {
  const p = await project('repo-ov');
  const t = await start(p.id, 'ask before deleting build');
  await until(t.id, (x) => !!x?.prompt?.screen?.ready);
  await navMode();
  await page.keyboard.press('b');
  const tile = page.locator(`[data-testid="tile"][data-task-id="${t.id}"]`);
  await expect(tile).toHaveAttribute('data-state', 'blocked');
  await page.screenshot({ path: shots('overview') });
  await tile.getByRole('button', { name: /^1\s*허락$/ }).click();
  await until(t.id, (x) => x?.state !== 'needs_input');
  await page.keyboard.press('b');
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('관제 mosaic: a stuck session gets the big tile, and shrinks back once answered', async () => {
  const p = await project('repo-mosaic');
  // "test": the mock runs `npm test` first, so the big tile has something to show under the card.
  const stuck = await start(p.id, 'ask before deleting build, run test first');
  const quiet = await start(p.id, 'just answer: 조용히');
  await until(stuck.id, (x) => !!x?.prompt?.screen?.ready);
  await until(quiet.id, (x) => x?.state === 'needs_input');
  await page.getByTestId('view-overview').click();
  const big = page.locator(`[data-testid="tile"][data-task-id="${stuck.id}"]`);
  await expect(big).toHaveAttribute('data-z', 'l');
  await expect(page.locator(`[data-testid="tile"][data-task-id="${quiet.id}"]`)).toHaveAttribute('data-z', 'm');
  await expect(big.locator('.before')).toContainText('npm test');
  await page.screenshot({ path: shots('mosaic') });
  await big.getByRole('button', { name: /^1\s*허락$/ }).click();
  await until(stuck.id, (x) => x?.state !== 'needs_input');
  await expect(big).not.toHaveAttribute('data-z', 'l');
  for (const t of [stuck, quiet]) await call('POST', `/api/tasks/${t.id}/discard`);
});

test('rewind and fork: /rewind drops a turn and hands the words back; a fork starts from before a message', async () => {
  const p = await project('repo-rewind');
  const t = await start(p.id, 'just answer: 첫 지시');
  await until(t.id, (x) => x?.state === 'needs_input');
  await call('POST', `/api/tasks/${t.id}/send`, { text: 'create notes/second.md 두 번째 지시' });
  await until(t.id, (x) => x?.state === 'review' && x.changes?.files > 0);
  const wt = (await task(t.id)).worktreeAbs;
  expect(fs.existsSync(path.join(wt, 'notes/second.md'))).toBe(true);
  await toList();
  await row(t.id).click();
  const convo = page.getByTestId('conversation');
  const second = convo.locator('.umsg').filter({ hasText: '두 번째 지시' });
  await second.hover();
  await second.getByTestId('rewind').click();
  await page.getByTestId('rewind-go').click();
  // The CLI dropped the turn, the files went back, the words came back to the composer.
  await expect(page.getByTestId('composer').locator('textarea')).toHaveValue(/두 번째 지시/, { timeout: 15_000 }).catch(async (e) => {
    console.log('DBG toasts', await page.getByRole('status').allInnerTexts().catch(() => []));
    console.log('DBG screen\n' + (await call('GET', `/api/tasks/${t.id}/screen?lines=30`)).lines.join('\n'));
    console.log('DBG msgs', JSON.stringify((await task(t.id)).messages.map((m) => [m.source, m.text, m.undone])));
    throw e;
  });
  await expect(convo.getByText(/지시 전으로 되감았어요/)).toBeVisible();
  await expect(convo.locator('.umsg').filter({ hasText: '두 번째 지시' })).toHaveCount(0);
  await expect.poll(() => fs.existsSync(path.join(wt, 'notes/second.md'))).toBe(false);
  // …and the CLI's own input box is empty again, so the next message isn't glued to it.
  expect((await call('GET', `/api/tasks/${t.id}/screen?lines=6`)).lines.join('\n')).not.toContain('두 번째 지시');
  const log = fs.readFileSync(process.env.MOCK_REWIND_LOG_E2E || path.join(tmp, 'rewind.log'), 'utf8');
  expect(log).toContain('"choice":"2"');
  // A fork from before the first message's follow-up: same history up to there, its own folder.
  await page.getByTestId('composer').locator('textarea').fill('');
  await call('POST', `/api/tasks/${t.id}/send`, { text: 'just answer: 세 번째 지시' });
  await until(t.id, (x) => x?.state === 'needs_input' && x.messages.some((m) => m.text.includes('세 번째') && !m.undone));
  const third = convo.locator('.umsg').filter({ hasText: '세 번째 지시' });
  await third.hover();
  await third.getByTestId('fork').click();
  await expect.poll(async () => (await call('GET', '/api/state')).tasks.filter((x) => x.forkOf?.id === t.id).length, { timeout: 15_000 }).toBe(1);
  const f = (await call('GET', '/api/state')).tasks.find((x) => x.forkOf?.id === t.id);
  expect(f.worktreeAbs).not.toBe(wt);
  await expect(page.getByTestId('conversation').getByText(/갈라졌어요/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('conversation').locator('.umsg').filter({ hasText: '첫 지시' })).toBeVisible();
  await expect(page.getByTestId('conversation').locator('.umsg').filter({ hasText: '세 번째 지시' })).toHaveCount(0);
  await page.screenshot({ path: shots('fork') });
  for (const x of [t, f]) await call('POST', `/api/tasks/${x.id}/discard`);
});

test('usage: the title bar reads Claude Code\'s own /usage and shows each limit', async () => {
  await page.getByTestId('usage').click();
  const pop = page.getByTestId('usage-pop');
  await expect(pop).toBeVisible();
  await expect(pop.getByText('5시간 한도')).toBeVisible({ timeout: 20_000 });
  await expect(pop.getByText('이번 주 · Fable')).toBeVisible();
  await expect(pop).toContainText('62%');
  await expect(page.getByTestId('usage')).toContainText('5시간 62%');
  await expect(page.getByTestId('usage')).toContainText('주간 41%');
  await page.screenshot({ path: shots('usage') });
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('agent settings: MCP servers added, checked and removed through claude mcp; permission rules edited in settings.json', async () => {
  await page.keyboard.press(`${MOD}+Comma`);
  await page.getByRole('button', { name: 'MCP 서버' }).click();
  await page.getByTestId('mcp-add').click();
  const form = page.getByTestId('mcp-form');
  await form.locator('input').first().fill('sentry');
  await form.locator('input.mono').fill('npx -y @sentry/mcp-server@latest');
  await expect(form.locator('pre')).toContainText('claude mcp add --scope user sentry -- npx -y @sentry/mcp-server@latest');
  await form.getByRole('button', { name: '추가' }).click();
  const list = page.getByTestId('mcp-list');
  await expect(list.getByText('sentry', { exact: true })).toBeVisible();
  await page.getByTestId('mcp-check').click();
  await expect(list.getByText('연결됨')).toBeVisible({ timeout: 20_000 });
  // claude.ai connectors only show up in the check, read-only.
  await expect(list.getByText('claude.ai Mock Drive')).toBeVisible();
  await expect(list.getByText('인증 필요')).toBeVisible();
  await page.screenshot({ path: shots('settings-mcp') });
  await list.getByTestId('mcp-row').filter({ hasText: 'sentry' }).getByRole('button', { name: '빼기' }).click();
  await expect(list.getByText('sentry', { exact: true })).toHaveCount(0);
  // Permission rules: written to Claude Code's own settings.json, other keys untouched.
  const settingsFile = path.join(tmp, 'claude-home', 'settings.json');
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ model: 'opus', permissions: { deny: ['Bash(git push --force:*)'] } }));
  await page.getByRole('button', { name: '권한' }).click();
  await expect(page.getByText('Bash(git push --force:*)')).toBeVisible();
  await page.getByTestId('perm-rule').fill('Bash(pnpm test:*)');
  await page.getByTestId('perm-add').click();
  await expect(page.getByText('Bash(pnpm test:*)')).toBeVisible();
  const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  expect(saved.model).toBe('opus');
  expect(saved.permissions.allow).toEqual(['Bash(pnpm test:*)']);
  expect(saved.permissions.deny).toEqual(['Bash(git push --force:*)']);
  await page.screenshot({ path: shots('settings-perm') });
  await page.keyboard.press(`${MOD}+Comma`);
});

test('talk: two sessions changing the same file hear each other, Desk only carries the words', async () => {
  const p = await project('repo-talk');
  const a = await start(p.id, 'create shared.md 장바구니 정리');
  const b = await start(p.id, 'create shared.md 결제 정리');
  for (const t of [a, b]) await until(t.id, (x) => x?.state === 'review');
  await until(a.id, (x) => x?.clash?.length > 0, 20_000);
  expect((await task(a.id)).clash[0].files).toContain('shared.md');
  await page.getByTestId('view-overview').click();
  const tile = page.locator(`[data-testid="tile"][data-task-id="${a.id}"]`);
  await expect(tile.getByTestId('clash')).toContainText(/README\.md|shared\.md/);
  await page.screenshot({ path: shots('clash') });
  await tile.getByTestId('talk-start').click();
  // Each gets the other's diff, says something across, then both say 끝.
  await until(a.id, (x) => x?.clash?.[0]?.talk?.state === 'done', 30_000);
  const tk = (await task(a.id)).clash[0].talk;
  expect(tk.result).toContain('부딪히지 않는다');
  expect(tk.msgs.some((m) => m.text.includes('README 끝에만'))).toBe(true);
  await tile.locator('.pn-h').click();
  await expect(page.getByTestId('talk-thread')).toContainText('README 끝에만');
  await expect(page.getByTestId('conversation').getByTestId('talk-msg').first()).toContainText('협의 시작');
  await expect(page.getByTestId('clash')).toHaveAttribute('data-talk', 'done');
  await page.screenshot({ path: shots('talk') });
  for (const t of [a, b]) await call('POST', `/api/tasks/${t.id}/discard`);
});

test('island: with another app in front it shows what waits, unfolds for a permission, and answers it', async () => {
  // Hiding the main window takes the main process, which a release build doesn't open to Playwright.
  test.skip(!app, 'needs the dev checkout');
  const p = await project('repo-island');
  const islandShown = () => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/island.html'))?.isVisible());
  // Desk in front: no island.
  await expect.poll(islandShown).toBe(false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === 'app://desk/')?.hide());
  const t = await start(p.id, 'ask before deleting build 아일랜드');
  await expect.poll(islandShown, { timeout: 15_000 }).toBe(true);
  const isl = app.windows().find((w) => w.url().endsWith('/island.html'));
  await expect(isl.getByTestId('island-card')).toContainText('이 명령을 실행할까요?', { timeout: 15_000 });
  await isl.getByTestId('island-card').getByRole('button', { name: /^1\s*허락$/ }).click();
  await until(t.id, (x) => x?.state !== 'needs_input');
  await expect(isl.getByTestId('island-card')).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === 'app://desk/');
    w?.show();
    w?.focus();
    // Keys go to the page again (the tests after this one type shortcuts).
    w?.webContents.focus();
  });
  await expect.poll(islandShown).toBe(false);
  await page.bringToFront();
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('관제 new-session tile: project, start mode and model, then it runs in that mode', async () => {
  await page.getByTestId('view-overview').click();
  await navMode();
  await page.keyboard.press('n');
  const tile = page.getByTestId('new-tile');
  await expect(tile).toBeVisible();
  await tile.getByRole('button', { name: /계획 모드/ }).click();
  await tile.getByRole('button', { name: 'Sonnet' }).click();
  await page.getByTestId('new-input').fill('just answer: 계획부터');
  await page.getByTestId('new-input').press('Enter');
  await expect(tile).toBeHidden();
  const made = (await call('GET', '/api/state')).tasks.find((t) => t.title.includes('계획부터'));
  await until(made.id, (x) => x?.mode === 'plan');
  await call('POST', `/api/tasks/${made.id}/discard`);
});

test('focus: the composer bar changes the permission mode, mid-session, with Shift+Tab or the chip', async () => {
  const p = await project('repo-mode');
  const t = await start(p.id, 'just answer: 모드');
  await until(t.id, (x) => x?.state === 'needs_input' && x?.mode === 'default');
  await toList();
  await row(t.id).click();
  const chip = page.getByTestId('mode-chip');
  await expect(chip).toHaveAttribute('data-mode', 'default');
  await page.getByTestId('composer').locator('textarea').focus();
  await page.keyboard.press('Shift+Tab');
  await until(t.id, (x) => x?.mode === 'acceptEdits');
  await expect(chip).toHaveAttribute('data-mode', 'acceptEdits');
  await chip.click();
  await page.getByRole('option', { name: /계획 모드/ }).click();
  await until(t.id, (x) => x?.mode === 'plan');
  await expect(page.getByTestId('composer').locator('textarea')).toHaveAttribute('placeholder', /계획 모드/);
  await page.screenshot({ path: shots('mode-plan') });
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('focus: recap and a slash command\'s output show in the conversation, not in a terminal', async () => {
  const p = await project('repo-recap');
  const t = await start(p.id, 'just answer: 요약 남겨줘 recap');
  await until(t.id, (x) => x?.state === 'needs_input' && !!x?.recap);
  await toList();
  await row(t.id).click();
  const convo = page.getByTestId('conversation');
  await expect(convo.getByTestId('recap')).toContainText('다음은 테스트를 더 넣는 거예요');
  await expect(page.getByTestId('ctx-chip')).toContainText('%');
  const box = page.getByTestId('composer').locator('textarea');
  await box.fill('/context');
  await box.press('Enter');
  await expect(convo.getByTestId('cmdout')).toContainText('Context Usage');
  await expect(page.getByTestId('drawer')).toBeHidden();
  // Typing /model opens the app's own picker (this session only), never the CLI's.
  await box.fill('/model');
  await box.press('Enter');
  await expect(page.getByRole('listbox', { name: '모델' })).toBeVisible();
  await page.keyboard.press('Escape');
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('a stopped session comes back from its tile', async () => {
  const p = await project('repo-stopped');
  const t = await start(p.id, 'just answer: 멈췄다 다시');
  await until(t.id, (x) => x?.state === 'needs_input');
  await call('POST', `/api/tasks/${t.id}/stop`);
  await until(t.id, (x) => x?.state === 'exited');
  await page.getByTestId('view-overview').click();
  const tile = page.locator(`[data-testid="tile"][data-task-id="${t.id}"]`);
  await expect(tile).toHaveAttribute('data-z', 'm');
  await tile.getByTestId('resume').click();
  await until(t.id, (x) => x?.running === true);
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('several rows at once: ⌘/Ctrl-click picks, E puts them away, the toast brings them back', async () => {
  const p = await project('repo-pick');
  const ts = [await start(p.id, 'just answer: 한꺼번에 1'), await start(p.id, 'just answer: 한꺼번에 2')];
  for (const t of ts) await until(t.id, (x) => x?.state === 'needs_input');
  await toList();
  await row(ts[0].id).click();
  await row(ts[1].id).click({ modifiers: [MOD] });
  await expect(page.getByRole('toolbar', { name: '선택한 작업' })).toContainText('2개 선택');
  await page.keyboard.press('e');
  for (const t of ts) await expect(row(t.id)).toBeHidden();
  await page.getByRole('status').filter({ hasText: '2개 보관했어요' }).getByRole('button', { name: '되돌리기' }).click();
  for (const t of ts) await expect(row(t.id)).toBeVisible();
  for (const t of ts) await call('POST', `/api/tasks/${t.id}/discard`);
});

test('⌘J opens the raw terminal of the agent', async () => {
  const p = await project('repo-drawer');
  const t = await start(p.id, 'just answer: 터미널');
  await until(t.id, (x) => x?.state === 'needs_input');
  await toList();
  await row(t.id).click();
  await page.keyboard.press(`${MOD}+j`);
  const drawer = page.getByTestId('drawer');
  await expect(drawer.locator('.xterm-rows')).toContainText('Answer: just answer: 터미널', { timeout: 10_000 });
  // The terminal has focus now. Off the Mac, Ctrl+J belongs to it; the app's shortcut takes Shift too.
  await page.keyboard.press(win ? 'Control+Shift+j' : `${MOD}+j`);
  await expect(drawer).toBeHidden();
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('themes: a fixed theme from the gallery reaches the page and the window', async () => {
  // Settings open on the tab used last; the theme tab, whatever came before.
  if (!(await page.locator('.settings').isVisible())) await page.keyboard.press(`${MOD}+Comma`);
  await page.locator('.st-nav').getByRole('button', { name: '테마' }).click();
  await page.getByRole('button', { name: '항상 이 테마' }).click();
  await page.locator('[data-testid="theme-card"][data-theme-id="cyberpunk"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeKind)).toBe('dark');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).not.toBe('');
  await page.screenshot({ path: shots('theme-cyberpunk') });
  await page.locator('[data-testid="theme-card"][data-theme-id="catppuccin-latte"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeKind)).toBe('light');
  const chrome = path.join(tmp, 'home', 'electron', 'chrome.json');
  await expect.poll(() => fs.existsSync(chrome) && JSON.parse(fs.readFileSync(chrome, 'utf8')).light?.bg).toMatch(/^#[0-9a-f]{6}$/);
  await page.screenshot({ path: shots('theme-latte') });
});

test('a Ghostty theme pasted into settings becomes a theme of its own', async () => {
  await page.getByRole('button', { name: '내용 붙여넣기' }).click();
  await page.getByPlaceholder('테마 파일 내용을 붙여넣어 주세요').fill(
    'background = #101418\nforeground = #e0e6ee\n' + Array.from({ length: 16 }, (_, i) => `palette = ${i}=#${['20262c', 'e06c75', '98c379', 'e5c07b', '61afef', 'c678dd', '56b6c2', 'abb2bf'][i % 8]}`).join('\n')
  );
  await page.getByRole('button', { name: '읽기' }).click();
  await page.getByRole('button', { name: '가져와서 쓰기' }).click();
  await expect.poll(async () => (await call('GET', '/api/themes')).themes.length).toBe(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.themeKind)).toBe('dark');
  await page.keyboard.press(`${MOD}+Comma`);
});

test('the quick panel lists what waits on me and answers it', async () => {
  const p = await project('repo-panel');
  const t = await start(p.id, 'ask before deleting build');
  await until(t.id, (x) => !!x?.prompt?.screen?.ready);
  await page.evaluate(() => window.desk.panel('toggle'));
  const isPanel = (x) => x.url().endsWith('/panel.html');
  const panel = app ? await expect.poll(() => app.windows().find(isPanel)).toBeTruthy().then(() => app.windows().find(isPanel)) : context.pages().find(isPanel) || (await context.waitForEvent('page', { predicate: isPanel }));
  const item = panel.locator(`[data-task-id="${t.id}"]`);
  await expect(item).toContainText('rm -rf build');
  await panel.screenshot({ path: shots('panel') });
  await item.getByRole('button', { name: /허락$/ }).click();
  await until(t.id, (x) => x?.state !== 'needs_input');
  await call('POST', `/api/tasks/${t.id}/discard`);
});

test('the title bar leaves room for the window controls', async () => {
  const pad = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('[data-testid="titlebar"]'));
    return { pl: cs.paddingLeft, pr: cs.paddingRight, drag: cs.getPropertyValue('-webkit-app-region') || cs.webkitAppRegion };
  });
  if (process.platform === 'darwin') expect(pad.pl).toBe('84px');
  if (win) expect(parseFloat(pad.pr)).toBeGreaterThan(100);
  expect(pad.drag).toBe('drag');
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
