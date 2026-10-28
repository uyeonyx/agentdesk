// 0.2: terminal as the only input, permission menus, progress tracking, multi-repo tasks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { boot, makeRepo } from './helpers.js';

let ctx;
let one;
before(async () => {
  ctx = await boot();
  const repo = makeRepo(path.join(ctx.tmp, 'solo'), { 'README.md': '# solo\n' });
  one = (await ctx.api('POST', '/api/projects', { path: repo })).json;
});
after(() => ctx.s.shutdown(null));

const T = () => ctx.s.tasks;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (id) => (await ctx.api('GET', '/api/state')).json.tasks.find((t) => t.id === id);

test('terminal Enter in the input box: snapshot first, record the text, undo restores', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'just answer: ready?' })).json;
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  T().input(t.id, 'create typed.md 터미널에서 직접 친 지시');
  await sleep(150);
  const msg = await T().submit(t.id);
  assert.ok(msg, 'recognized as a message');
  assert.equal(msg.text, 'create typed.md 터미널에서 직접 친 지시');
  assert.ok(Array.isArray(msg.snap) && msg.snap.length === 1);
  await ctx.waitTask(t.id, (x) => x.state === 'review');
  assert.ok(fs.existsSync(path.join(t.worktreeAbs, 'typed.md')));
  const r = await ctx.api('POST', `/api/tasks/${t.id}/undo`, { msgId: msg.id });
  assert.equal(r.status, 200);
  assert.equal(r.json.undoneText, msg.text);
  assert.ok(!fs.existsSync(path.join(t.worktreeAbs, 'typed.md')));
  ctx.solo = t.id;
});

test('pasted review comments land in the input box without being sent', async () => {
  const id = ctx.solo;
  await ctx.waitTask(id, (x) => x.state !== 'working');
  const before = (await state(id)).messages.length;
  assert.equal((await ctx.api('POST', `/api/tasks/${id}/paste`, { text: '리뷰 코멘트:\n- `a.ts` 3행: 이름 바꿔줘' })).status, 200);
  await sleep(200);
  const r = T().rt.get(id);
  await new Promise((res) => r.term.write('', res));
  assert.match(T().promptText(r), /리뷰 코멘트/);
  assert.equal((await state(id)).messages.length, before, 'nothing sent yet');
});

test('Enter on a non-prompt line (a menu) passes straight through, no message', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'ask to clean build' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input' && x.menu);
  assert.equal(x.menu.options.length, 3);
  assert.equal(x.menu.options[0].key, '1');
  assert.match(x.menu.options[0].label, /Yes/);
  assert.match(x.menu.question, /proceed/);
  assert.equal(await T().submit(t.id), null);
  ctx.menuTask = t.id;
});

test('widget button answers the permission menu', async () => {
  const id = ctx.menuTask;
  // the earlier Enter already chose the default in the mock? re-open a fresh menu task to be sure
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'ask again please' })).json;
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input' && x.menu);
  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/choose`, { key: '9' })).status, 409, 'only keys that are on screen');
  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/choose`, { key: '1' })).status, 200);
  const x = await ctx.waitTask(t.id, (x) => x.state === 'review');
  assert.equal(x.menu, null);
  void id;
});

test('Claude progress: plan, subagent with its own tool calls, activity feed', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'plan, use a subagent, run test' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'review' && x.activity.subagents.some((s) => s.status === 'done'));
  const a = x.activity;
  assert.deepEqual(a.plan.map((p) => p.status), ['done', 'active', 'pending']);
  assert.equal(a.plan[1].text, '구현');
  const sub = a.subagents[0];
  assert.equal(sub.desc, '테스트 작성');
  assert.equal(sub.type, 'general-purpose');
  assert.equal(sub.tools, 1);
  assert.match(sub.last, /테스트 3개/);
  const full = (await ctx.api('GET', `/api/tasks/${t.id}/activity`)).json;
  const texts = full.feed.map((f) => f.text);
  assert.ok(texts.some((s) => s === '$ npm test'), texts.join(' | '));
  assert.ok(texts.some((s) => /^작성 notes\//.test(s)), 'relative edit path');
  assert.ok(full.feed.find((f) => f.text === '$ npm test').st === 'ok');
  assert.ok(full.feed.some((f) => f.by === 'sub-1' && /npm test -- --watch/.test(f.text)), 'subagent tool call attributed');
  assert.equal(a.current, '');
});

test('Codex progress comes from its session log', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'codex', prompt: 'plan, use a subagent, run test' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'review' && x.activity.plan.length === 3, 12000);
  assert.equal(x.activity.subagents[0].desc, '테스트 작성');
  const full = (await ctx.api('GET', `/api/tasks/${t.id}/activity`)).json;
  assert.ok(full.feed.some((f) => f.text === '$ npm test' && f.st === 'ok'));
  assert.ok(full.feed.some((f) => f.kind === 'edit'));
});

test('screen API returns the tail and the menu for widgets', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'ask about it' })).json;
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input' && x.menu);
  const s = (await ctx.api('GET', `/api/tasks/${t.id}/screen?lines=8`)).json;
  assert.ok(s.lines.length > 0 && s.lines.length <= 8);
  assert.equal(s.menu.options.length, 3);
  await ctx.api('POST', `/api/tasks/${t.id}/choose`, { key: '3' });
});

// ------------------------------------------------------------ multi-repo

let web;
let api;
test('group project bundles repos; a task gets one worktree per repo in its own folder', async () => {
  const w = makeRepo(path.join(ctx.tmp, 'web'), { 'README.md': '# web\n' });
  const a = makeRepo(path.join(ctx.tmp, 'api'), { 'README.md': '# api\n', 'CHANGES.md': 'base\n' });
  web = (await ctx.api('POST', '/api/projects', { path: w })).json;
  api = (await ctx.api('POST', '/api/projects', { path: a })).json;
  assert.equal((await ctx.api('POST', '/api/projects', { kind: 'group', members: [web.id] })).status, 400);
  const g = (await ctx.api('POST', '/api/projects', { kind: 'group', name: '쇼핑몰', members: [web.id, api.id] })).json;
  assert.equal(g.kind, 'group');
  const t = (await ctx.api('POST', '/api/tasks', { projectId: g.id, agent: 'claude', prompt: 'create notes.md 모든 저장소에 메모' })).json;
  assert.equal(t.multi, true);
  assert.deepEqual(t.repos.map((r) => r.prefix), ['web/', 'api/']);
  assert.ok(fs.existsSync(path.join(t.worktreeAbs, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(t.worktreeAbs, 'web', '.git')));
  const x = await ctx.waitTask(t.id, (x) => x.state === 'review');
  const ch = (await ctx.api('GET', `/api/tasks/${t.id}/changes`)).json.files.map((f) => f.path);
  assert.ok(ch.includes('web/CHANGES.md') && ch.includes('api/CHANGES.md'), ch.join(','));
  const f = (await ctx.api('GET', `/api/tasks/${t.id}/file?path=${encodeURIComponent('api/CHANGES.md')}&ref=base`)).json;
  assert.equal(f.content, 'base\n');
  const main = (await ctx.api('GET', `/api/tasks/${t.id}/file?path=${encodeURIComponent('web/README.md')}&ref=main`)).json;
  assert.equal(main.content, '# web\n');
  assert.equal((await ctx.api('GET', `/api/tasks/${t.id}/file?path=${encodeURIComponent('../web/README.md')}`)).status, 400);
  const files = (await ctx.api('GET', `/api/tasks/${t.id}/files`)).json.files;
  assert.ok(files.includes('web/README.md') && files.includes('api/README.md'));
  ctx.group = g;
  ctx.multi = x.id;
});

test('multi-repo undo restores every repo', async () => {
  const id = ctx.multi;
  const before = (await state(id)).changes.files;
  const m = (await ctx.api('POST', `/api/tasks/${id}/send`, { text: 'create extra.md 모든 저장소 again' })).json;
  const x = await state(id);
  const apiChanges = path.join(x.worktreeAbs, 'api', 'CHANGES.md');
  for (let i = 0; i < 60 && !/again/.test(fs.readFileSync(apiChanges, 'utf8')); i++) await sleep(100);
  assert.match(fs.readFileSync(apiChanges, 'utf8'), /again/);
  await ctx.waitTask(id, (x) => x.state === 'review');
  await ctx.api('POST', `/api/tasks/${id}/undo`, { msgId: m.id });
  const after = await ctx.waitTask(id, (x) => x.state !== 'working');
  assert.equal(after.changes.files, before);
  const changes = fs.readFileSync(path.join(x.worktreeAbs, 'api', 'CHANGES.md'), 'utf8');
  assert.doesNotMatch(changes, /again/);
});

test('multi-repo merge is checked across all repos first, then merges each', async () => {
  // a second task whose api change conflicts with a commit made on api main meanwhile
  const t = (await ctx.api('POST', '/api/tasks', { projectId: ctx.group.id, agent: 'claude', prompt: 'create c.md 모든 저장소 conflict' })).json;
  await ctx.waitTask(t.id, (x) => x.state === 'review');
  const apiMain = api.path;
  fs.writeFileSync(path.join(apiMain, 'CHANGES.md'), 'base\nmain moved on\n');
  execSync('git -c user.name=t -c user.email=t@t commit -qam "main change"', { cwd: apiMain });
  const webHead = execSync('git rev-parse HEAD', { cwd: web.path }).toString().trim();
  const r = await ctx.api('POST', `/api/tasks/${t.id}/merge`);
  assert.equal(r.status, 409);
  assert.match(r.json.error, /api.*충돌/);
  assert.equal(execSync('git rev-parse HEAD', { cwd: web.path }).toString().trim(), webHead, 'web untouched when api would conflict');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);

  // the first multi task merges cleanly? its api change also conflicts now, so reset api main first
  execSync('git -c user.name=t -c user.email=t@t revert --no-edit HEAD', { cwd: apiMain });
  const ok = await ctx.api('POST', `/api/tasks/${ctx.multi}/merge`);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(fs.existsSync(path.join(web.path, 'notes.md')) || fs.existsSync(path.join(web.path, 'CHANGES.md')));
  assert.match(fs.readFileSync(path.join(apiMain, 'CHANGES.md'), 'utf8'), /메모/);
  const x = await state(ctx.multi);
  assert.equal(x.state, 'merged');
  assert.ok(!fs.existsSync(x.worktreeAbs), 'task folder removed');
});

test('single project + extra repos becomes a multi-repo task', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: web.id, agent: 'claude', prompt: 'just answer: span both', extraProjectIds: [api.id] })).json;
  assert.equal(t.multi, true);
  assert.equal(t.repos.length, 2);
  assert.equal(t.projectId, web.id);
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
  const gone = await state(t.id);
  assert.ok(!fs.existsSync(gone.worktreeAbs));
  assert.equal(execSync('git worktree list', { cwd: api.path }).toString().trim().split('\n').length, 1, 'no leftover worktrees');
});

test('AskUserQuestion form: options with descriptions and a separator become buttons; the question is the reason', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'askq 테스트용 계획' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input' && x.menu);
  assert.deepEqual(x.menu.options.map((o) => o.key), ['1', '2', '3', '4', '5', '6']);
  assert.equal(x.menu.options[0].label, '누름 깊이 테스트 (추천)');
  assert.match(x.menu.options[0].desc, /가라앉는지.*알맞습니다/);
  assert.equal(x.menu.options[3].selected, true);
  assert.equal(x.menu.options[5].label, 'Chat about this');
  assert.equal(x.menu.question, '테스트용 계획을 어떤 주제로 세울까요?');
  assert.equal(x.reason, '테스트용 계획을 어떤 주제로 세울까요?');
  assert.equal(await T().submit(t.id), null, 'Enter in a form picks, it is not a message');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test("a numbered list in the agent's answer is not a menu once the input prompt is back", async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'just answer: 1. 첫째 2. 둘째' })).json;
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  const r = T().rt.get(t.id);
  r.term.write('\r\n  1. 사과\r\n  2. 배\r\n  3. 귤\r\n\r\n> ');
  await new Promise((res) => r.term.write('', res));
  assert.equal(T().menuOf(r), null);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('a plain shell in the task folder: runs commands, takes pasted agent commands unsent, has no Desk secrets', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'just answer: 로그인은 직접 해주세요 `npm login` 그리고\n```bash\ngh auth login\n```' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  assert.deepEqual(x.commands, ['gh auth login', 'npm login']);
  const r = await ctx.api('POST', `/api/tasks/${t.id}/shell`);
  assert.equal(r.status, 200);
  assert.match(r.json.id, /^sh_/);
  const sh = ctx.s.shells.byId.get(r.json.id);
  assert.equal(sh.cwd, t.worktreeAbs);
  const seen = () => sh.ser.serialize();
  sh.proc.write('echo "cwd=$(pwd) tok=${AGENTDESK_HOOK_TOKEN:-none}"\r');
  await (async () => { for (let i = 0; i < 50 && !/tok=none/.test(seen()); i++) await sleep(100); })();
  assert.match(seen(), new RegExp(`cwd=${t.worktreeAbs}`));
  assert.match(seen(), /tok=none/, 'the hook token never reaches the shell');
  // A pasted command sits on the line until Enter.
  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/shell`, { paste: 'echo pasted-not-run\x1b[201~; rm -rf /tmp/nope\r' })).json.id, r.json.id);
  await sleep(400);
  assert.doesNotMatch(seen(), /\npasted-not-run/, 'not executed');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
  assert.equal(ctx.s.shells.forTask(t.id), null, 'shell closed with the task');
});
