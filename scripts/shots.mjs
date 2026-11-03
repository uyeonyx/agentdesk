// Fill the dev build with a realistic set of sessions (mock agents) and shoot every screen, to check
// the design by eye: cut-off text, empty boxes, faint letters, lines that don't line up.
//
//   pnpm shots                         every screen, light, 1440×900, into shots/light
//   pnpm shots -- --dark               the dark screen, into shots/dark
//   pnpm shots -- --size 1100x720      a smaller window
//   pnpm shots -- --only overview,settings
//
// Screens: home, overview, focus-perm, focus-work, focus-review, focus-reply, focus-plan, focus-codex,
// cmdk, changes, drawer, recaps, newtile, settings, add, panel.
import { _electron as electron } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? null : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const dark = !!flag('dark');
const [W, H] = String(flag('size') || '1440x900').split('x').map(Number);
const only = flag('only') ? String(flag('only')).split(',') : null;
const out = path.resolve(String(flag('out') || path.join(root, 'shots', `${dark ? 'dark' : 'light'}-${W}`)));
const want = (n) => !only || only.includes(n) || (n.startsWith('focus-') && only.includes('focus'));
fs.mkdirSync(out, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-shots-'));
function repo(name, files) {
  const d = path.join(tmp, name);
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.writeFileSync(path.join(d, f), c);
  }
  execSync('git init -q -b main && git add . && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: d });
  return d;
}
const repos = {
  shop: repo('shop-web', {
    'README.md': '# Shop Web\n\n쇼핑몰 프론트엔드예요. Next.js와 TypeScript로 만들어요.\n',
    'package.json': JSON.stringify({ name: 'shop-web', dependencies: { next: '15', react: '19' }, devDependencies: { typescript: '5' } }),
    'src/cart.ts': 'export const cart = [];\n',
  }),
  bill: repo('billing-api', {
    'README.md': '# billing-api\n\n결제·정산 API 서버. 토스페이먼츠 연동.\n',
    'package.json': JSON.stringify({ name: 'billing-api', dependencies: { hono: '4', 'drizzle-orm': '1' } }),
    'src/pay.ts': 'export function pay() {}\n',
  }),
  docs: repo('handbook', { 'README.md': '# 팀 핸드북\n\n온보딩 문서와 운영 규칙을 모아 둔 곳이에요.\n' }),
  infra: repo('infra', { 'README.md': '# infra\n\nTerraform으로 관리하는 AWS 인프라.\n', 'main.tf': 'resource "aws_vpc" "main" {}\n' }),
};

const env = {
  ...process.env,
  AGENTDESK_HOME: path.join(tmp, 'home'),
  AGENTDESK_CLAUDE_BIN: path.join(root, 'test/mock-claude'),
  AGENTDESK_CODEX_BIN: path.join(root, 'test/mock-codex'),
  MOCK_WORK_MS: '900',
  MOCK_BG_MS: '600000',
  MOCK_TRANSCRIPT_DIR: path.join(tmp, 'tr'),
  AGENTDESK_TRANSCRIPT_ROOTS: path.join(tmp, 'tr'),
  CLAUDE_CONFIG_DIR: path.join(tmp, 'claude'),
  CODEX_HOME: path.join(tmp, 'codex'),
  AGENTDESK_USAGE: 'off',
};
for (const k of Object.keys(env)) if (/^(CLAUDECODE$|CLAUDE_CODE_|ELECTRON_RUN)/.test(k)) delete env[k];
fs.mkdirSync(env.MOCK_TRANSCRIPT_DIR, { recursive: true });

const app = await electron.launch({ args: [root], env });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setSize(w, h), [W, H]);
const call = (m, p, b) => page.evaluate(async ([m, p, b]) => JSON.parse((await window.desk.api(m, p, b === undefined ? undefined : JSON.stringify(b))).body || '{}'), [m, p, b]);
await page.waitForFunction(() => document.documentElement.dataset.themeKind);
if (dark) {
  await page.evaluate(() => window.desk.setThemePrefs({ mode: 'dark', fixedKind: 'dark' }));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.themeKind === 'dark');
}
const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('shot', name);
};
const esc = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
};

const P = {};
for (const [k, d] of Object.entries(repos)) P[k] = await call('POST', '/api/projects', { path: d });
if (want('home')) {
  await page.getByTestId('view-task').click().catch(() => {});
  await shot('home');
}

const T = {};
const start = async (k, proj, prompt, extra = {}) => (T[k] = await call('POST', '/api/tasks', { projectId: P[proj].id, agent: 'claude', prompt, ...extra }));
await start('perm', 'shop', 'ask before deleting build 폴더 정리하고 다시 빌드');
await start('edit', 'shop', 'askedit README 제목을 프로젝트 이름에 맞게 바꿔 줘');
await start('work', 'bill', 'slow subagent plan test 결제 모듈을 토스 v2 API로 옮기고 테스트까지 정리해 줘');
await start('review', 'bill', 'create src/refund.ts markdown 환불 처리 함수 추가하고 요약해 줘');
await start('reply', 'docs', 'just answer: markdown 온보딩 문서에서 빠진 항목이 뭔지 알려 줘');
await start('plan', 'docs', 'planmode 핸드북 목차를 팀별로 다시 짜 줘');
await start('wait', 'infra', 'background 스테이징 빌드 돌려 놓고 결과 알려 줘');
await start('codex', 'infra', 'create notes/vpc.md VPC 서브넷 정리', { agent: 'codex' });
await page.waitForTimeout(4500);

const overview = () => page.getByTestId('view-overview').click();
await overview();
if (want('overview')) await shot('overview');
const open = async (k) => {
  await overview();
  await page.locator(`[data-testid="tile"][data-task-id="${T[k].id}"] .oc-h`).click();
  await page.waitForTimeout(700);
};
for (const k of ['perm', 'work', 'review', 'reply', 'plan', 'codex'])
  if (want(`focus-${k}`)) {
    await open(k);
    await shot(`focus-${k}`);
  }
if (want('cmdk')) {
  await open('work');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await shot('cmdk');
  await esc();
}
if (want('changes')) {
  await open('review');
  await page.getByRole('tab', { name: /변경/ }).click();
  await page.waitForTimeout(1200);
  await shot('changes');
}
if (want('drawer')) {
  await open('work');
  const key = process.platform === 'darwin' ? 'Meta+j' : 'Control+Shift+j';
  await page.keyboard.press(key);
  await page.waitForTimeout(1200);
  await shot('drawer');
  await page.keyboard.press(key);
}
if (want('recaps')) {
  await overview();
  await page.getByTestId('recaps').click();
  await shot('recaps');
  await esc();
}
if (want('newtile')) {
  await overview();
  await page.getByTestId('new-tile-btn').click();
  await shot('newtile');
  await esc();
}
if (want('settings')) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma');
  for (const name of ['테마', '알림과 소리', '단축키', '에이전트', 'MCP 서버', '권한', '사용량', '프로젝트', '정보']) {
    await page.locator('.st-nav').getByRole('button', { name, exact: true }).click();
    await shot(`settings-${name}`);
  }
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma');
}
if (want('add')) {
  await page.getByTestId('project-switch').click();
  await shot('project-switch');
  await page.getByRole('dialog', { name: '프로젝트 고르기' }).getByRole('button', { name: '프로젝트 추가' }).click();
  await page.waitForTimeout(1200);
  await shot('add-project');
  await esc();
}
if (want('panel')) {
  await page.evaluate(() => window.desk.panel('toggle'));
  await page.waitForTimeout(1200);
  const pw = app.windows().find((w) => w.url().endsWith('/panel.html'));
  if (pw) {
    await pw.screenshot({ path: path.join(out, 'panel.png') });
    console.log('shot panel');
  }
}
await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`shots in ${path.relative(process.cwd(), out) || '.'}`);
