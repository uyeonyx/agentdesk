// The whole loop with mock Claude/Codex CLIs: dispatch → hook → review → send → undo → merge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { boot, makeRepo } from './helpers.js';
import { pendingOf } from '../server/tasks.js';

let ctx;
let proj;
let repo;
before(async () => {
  ctx = await boot();
  repo = makeRepo(path.join(ctx.tmp, 'enterprise-crypto'), { 'README.md': '# crypto\n', 'src/lib.rs': 'pub fn x() {}\n' });
  proj = (await ctx.api('POST', '/api/projects', { path: repo, careful: true })).json;
});
after(() => ctx.s.shutdown(null));

const sh = (cmd, cwd = repo) => execSync(cmd, { cwd }).toString().trim();

test('project gets identity defaults', () => {
  assert.equal(proj.isGit, true);
  assert.equal(proj.icon, 'lock'); // guessed from "crypto"
  assert.match(proj.color, /^#[0-9A-F]{6}$/i);
  assert.equal(proj.careful, true);
});

test('claude task: runs in its own worktree, Stop hook moves it to review with a summary', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'create docs/rotation.md 키 로테이션 문서' })).json;
  assert.ok(t.worktreeAbs.includes(path.join('.agentdesk', 'worktrees')));
  assert.match(t.branch, /^desk\//);
  const x = await ctx.waitTask(t.id, (x) => x.state === 'review');
  assert.match(x.summary, /docs\/rotation\.md/);
  assert.ok(x.changes.files >= 1);
  assert.ok(fs.existsSync(path.join(x.worktreeAbs, 'docs/rotation.md')));
  assert.ok(!fs.existsSync(path.join(repo, 'docs/rotation.md')), 'main checkout untouched');
  assert.equal(sh('git status --porcelain'), '', 'worktree folder hidden from main status');
  ctx.t1 = t.id;
});

test('send + undo: files go back to exactly before the message, agent is told to ignore it', async () => {
  const id = ctx.t1;
  const m = (await ctx.api('POST', `/api/tasks/${id}/send`, { text: 'create src/oops.rs wrong project instruction' })).json;
  const x = await ctx.waitTask(id, (x) => x.state === 'review' && fs.existsSync(path.join(x.worktreeAbs, 'src/oops.rs')));
  const readmeBefore = fs.readFileSync(path.join(x.worktreeAbs, 'README.md'), 'utf8');
  assert.match(readmeBefore, /wrong project/);
  const r = await ctx.api('POST', `/api/tasks/${id}/undo`, { msgId: m.id });
  assert.equal(r.status, 200);
  assert.ok(!fs.existsSync(path.join(x.worktreeAbs, 'src/oops.rs')), 'new file removed');
  assert.doesNotMatch(fs.readFileSync(path.join(x.worktreeAbs, 'README.md'), 'utf8'), /wrong project/, 'edit reverted');
  assert.ok(fs.existsSync(path.join(x.worktreeAbs, 'docs/rotation.md')), 'earlier work kept');
  const after = await ctx.waitTask(id, (x) => x.messages.find((mm) => mm.id === m.id)?.undone && x.state !== 'working');
  assert.equal(after.messages.find((mm) => mm.id === m.id).canUndo, false);
});

test('a turn that leaves background work running waits for it instead of asking for review', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'create notes/build.md 백그라운드로 빌드 돌려 둬' })).json;
  const w = await ctx.waitTask(t.id, (x) => x.state === 'waiting');
  assert.match(w.reason, /백그라운드 작업이 끝나면 이어서 해요 · 셸: npm run build/);
  assert.ok(w.changes.files >= 1, 'changes are already there, and still not up for review');
  // The build finishing wakes the agent; this time the turn really ends.
  const x = await ctx.waitTask(t.id, (x) => x.state === 'review');
  assert.match(x.summary, /빌드가 끝났어요/);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('what a stopped turn still waits on, in words', () => {
  assert.equal(pendingOf({}), '');
  assert.equal(pendingOf({ background_tasks: [], session_crons: [] }), '');
  assert.equal(pendingOf({ background_tasks: [{ type: 'shell', status: 'completed', command: 'ls' }] }), '');
  assert.equal(pendingOf({ background_tasks: [{ type: 'subagent', status: 'running', description: '테스트 작성', agent_type: 'general-purpose' }] }), '백그라운드 작업이 끝나면 이어서 해요 · 서브에이전트: 테스트 작성');
  assert.equal(
    pendingOf({ background_tasks: [{ type: 'shell', status: 'running' }, { type: 'shell', status: 'running' }, { type: 'monitor', status: 'running' }], session_crons: [{ id: 'c', schedule: '*/5 * * * *', recurring: true }] }),
    '백그라운드 작업이 끝나면 이어서 해요 · 셸 2개, 모니터 1개, 예약 1개',
  );
  assert.equal(pendingOf({ session_crons: [{ id: 'c', schedule: '30 14 28 10 *', recurring: false }] }), '예약한 때가 되면 이어서 해요 · 예약 1개');
  assert.match(pendingOf({ background_tasks: [{ type: 'shell', status: 'running', command: 'x'.repeat(300) }] }), /…$/);
});

test('codex task: notify hook ends the turn; a no-change answer lands in "needs input"', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'codex', prompt: 'just answer: what is FIPS?' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  assert.match(x.summary, /FIPS/);
  ctx.codex = t.id;
});

test('permission prompt: the task is stuck on it, saying exactly what it wants to run', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'ask before deleting build' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input' && x.ask === 'permission');
  await new Promise((r) => setTimeout(r, 300)); // the generic Notification arrives after it
  const y = (await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id);
  assert.equal(y.reason, '허락을 기다려요 · Bash: rm -rf build', 'not replaced by "Claude needs your permission"');
  // Another call finishing (a parallel one) doesn't answer it; this one going ahead does.
  const post = (input) => ctx.s.tasks.hook({ task: t.id, agent: 'claude', payload: { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: input } });
  await post({ command: 'ls' });
  assert.equal((await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id).ask, 'permission');
  await post({ command: 'rm -rf build', description: 'Remove build' });
  const z = (await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id);
  assert.equal(z.state, 'working', 'answered elsewhere (the phone)');
  assert.equal(z.ask, '');
  void x;
  ctx.ask = t.id;
});

test('a finished turn is "your turn", not a block, and a minute of quiet does not change that', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'just answer: 한 줄 요약' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  assert.equal(x.ask, '');
  await ctx.s.tasks.hook({ task: t.id, agent: 'claude', payload: { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' } });
  assert.equal((await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id).reason, x.reason);
  await ctx.s.tasks.hook({ task: t.id, agent: 'claude', payload: { hook_event_name: 'Notification', notification_type: 'elicitation_dialog', message: 'GitHub MCP가 저장소 이름을 물어요' } });
  const y = (await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id);
  assert.equal(y.ask, 'question');
  assert.equal(y.reason, 'GitHub MCP가 저장소 이름을 물어요');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('stop and resume keep the same worktree', async () => {
  const id = ctx.codex;
  await ctx.api('POST', `/api/tasks/${id}/stop`);
  await ctx.waitTask(id, (x) => x.state === 'exited' && !x.running);
  const r = await ctx.api('POST', `/api/tasks/${id}/resume`);
  assert.equal(r.status, 200);
  await ctx.waitTask(id, (x) => x.running);
  const sent = await ctx.api('POST', `/api/tasks/${id}/send`, { text: 'just answer: again' });
  assert.equal(sent.status, 200);
});

test('a stopped session still shows what was said in it, for both agents', async () => {
  for (const agent of ['claude', 'codex']) {
    const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent, prompt: `just answer: ${agent} 지난 대화` })).json;
    await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
    await ctx.api('POST', `/api/tasks/${t.id}/stop`);
    await ctx.waitTask(t.id, (x) => !x.running);
    const { entries } = (await ctx.api('GET', `/api/tasks/${t.id}/transcript`)).json;
    const said = entries.filter((e) => e.role !== 'tool').map((e) => `${e.role}: ${e.text}`);
    assert.deepEqual(said, [`user: just answer: ${agent} 지난 대화`, `assistant: Answer: just answer: ${agent} 지난 대화`], agent);
    await ctx.api('POST', `/api/tasks/${t.id}/discard`);
  }
});

test('archive puts even a running task away without deleting anything; taking it out resumes the same conversation', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'create notes/later.md 나중에 볼 메모' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'review' && x.running);
  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/archive`)).status, 200);
  const a = (await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id);
  assert.equal(a.archived, true);
  assert.equal(a.running, false, 'its agent stopped');
  assert.equal(a.state, 'exited');
  assert.ok(a.archivedAt);
  assert.deepEqual(a.messages, [], 'history stays out of every state push while put away');
  assert.ok(fs.existsSync(path.join(x.worktreeAbs, 'notes/later.md')), 'worktree kept');
  assert.ok(sh(`git rev-parse --verify --quiet refs/heads/${x.branch}`), 'branch kept');
  // A hook still in flight from the stopped agent changes nothing.
  await ctx.s.tasks.hook({ task: t.id, agent: 'claude', payload: { hook_event_name: 'Stop' } });
  assert.equal((await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id).state, 'exited');

  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/unarchive`)).status, 200);
  const b = (await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id);
  assert.equal(b.archived, false);
  assert.ok(b.messages.length >= 1, 'history is back');
  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/resume`)).status, 200);
  await ctx.waitTask(t.id, (y) => y.running);
  const end = Date.now() + 5000;
  let screen;
  while (Date.now() < end && !(screen = (await ctx.api('GET', `/api/tasks/${t.id}/screen?lines=20`)).json.lines.join('\n')).includes('resumed')) await new Promise((r) => setTimeout(r, 100));
  assert.match(screen, new RegExp(`resumed ${x.sessionId}`), 'same conversation');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test("pulling main into the task's branch doesn't make main's changes its own", async () => {
  const dir = makeRepo(path.join(ctx.tmp, 'pulls-main'), { 'README.md': '# app\n', 'src/app.js': 'export const v = 1;\n' });
  const p = (await ctx.api('POST', '/api/projects', { path: dir })).json;
  const t = (await ctx.api('POST', '/api/tasks', { projectId: p.id, agent: 'claude', prompt: 'create notes/own.md 이 작업의 변경' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'review');
  await ctx.api('POST', `/api/tasks/${t.id}/stop`);
  const g = (cmd, cwd) => sh(`git -c user.name=t -c user.email=t@t ${cmd}`, cwd);
  const paths = async () => (await ctx.api('GET', `/api/tasks/${t.id}/changes`)).json.files.map((f) => f.path).sort();
  const own = ['README.md', 'notes/own.md'];
  assert.deepEqual(await paths(), own);

  // Main moves on; the agent commits and merges it in.
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `m${i}.txt`), `${i}\n`);
  fs.writeFileSync(path.join(dir, 'src/app.js'), 'export const v = 2;\n');
  g('add -A', dir);
  g('commit -qm main-moves', dir);
  g('add -A', x.worktreeAbs);
  g('commit -qm own-work', x.worktreeAbs);
  g('merge -q --no-edit main', x.worktreeAbs);
  assert.deepEqual(await paths(), own, 'merged-in main stays out');
  // `git checkout -b x origin/main` makes main the branch's upstream; main still counts as where it lands.
  g(`branch -q --set-upstream-to=main ${x.branch}`, x.worktreeAbs);
  assert.deepEqual(await paths(), own);
  const task = async () => (await ctx.api('GET', '/api/state')).json.tasks.find((y) => y.id === t.id);
  assert.equal((await task()).changes.files, 2);
  // The diff's left side is main as the branch took it, not where the task began.
  const base = (await ctx.api('GET', `/api/tasks/${t.id}/file?path=src/app.js&ref=base`)).json;
  assert.equal(base.content, 'export const v = 2;\n');

  // Rebasing onto a newer main is the same story.
  fs.writeFileSync(path.join(dir, 'm9.txt'), '9\n');
  g('add -A', dir);
  g('commit -qm main-again', dir);
  g('rebase -q main', x.worktreeAbs);
  assert.deepEqual(await paths(), own, 'rebased-onto main stays out');

  // Once main has all of it, nothing is left that main lacks; new work shows up again.
  g('merge -q --no-edit ' + x.branch, dir);
  assert.deepEqual(await paths(), []);
  fs.writeFileSync(path.join(x.worktreeAbs, 'after.md'), 'more\n');
  assert.deepEqual(await paths(), ['after.md']);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('an agent that moves its worktree onto main has nothing of its own, wherever the task began', async () => {
  const dir = makeRepo(path.join(ctx.tmp, 'side-branch'), { 'README.md': '# app\n' });
  const g = (cmd, cwd = dir) => sh(`git -c user.name=t -c user.email=t@t ${cmd}`, cwd);
  g('checkout -q -b carton');
  fs.writeFileSync(path.join(dir, 'carton.md'), 'only on carton\n');
  g('add -A');
  g('commit -qm carton');
  const p = (await ctx.api('POST', '/api/projects', { path: dir })).json;
  const t = (await ctx.api('POST', '/api/tasks', { projectId: p.id, agent: 'claude', prompt: 'just answer: 어디서 시작했어?' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  g('checkout -q --detach main', x.worktreeAbs);
  assert.deepEqual((await ctx.api('GET', `/api/tasks/${t.id}/changes`)).json.files, []);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('merge refuses a dirty main checkout, then merges cleanly and cleans up', async () => {
  const id = ctx.t1;
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'x');
  const refused = await ctx.api('POST', `/api/tasks/${id}/merge`);
  assert.equal(refused.status, 409);
  fs.unlinkSync(path.join(repo, 'dirty.txt'));
  const task = (await ctx.api('GET', '/api/state')).json.tasks.find((t) => t.id === id);
  const r = await ctx.api('POST', `/api/tasks/${id}/merge`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.into, 'main');
  assert.ok(fs.existsSync(path.join(repo, 'docs/rotation.md')));
  assert.ok(!fs.existsSync(path.join(repo, 'src/oops.rs')), 'undone change never reached main');
  assert.ok(!fs.existsSync(task.worktreeAbs), 'worktree removed');
  assert.equal(sh(`git branch --list ${task.branch}`), '', 'branch deleted');
  const x = (await ctx.api('GET', '/api/state')).json.tasks.find((t) => t.id === id);
  assert.equal(x.state, 'merged');
});

test('discard removes worktree and branch', async () => {
  const id = ctx.ask;
  const task = (await ctx.api('GET', '/api/state')).json.tasks.find((t) => t.id === id);
  await ctx.api('POST', `/api/tasks/${id}/discard`);
  const x = await ctx.waitTask(id, (x) => x.state === 'discarded');
  assert.ok(!fs.existsSync(task.worktreeAbs));
  assert.equal(sh(`git branch --list ${task.branch}`), '');
  assert.equal((await ctx.api('POST', `/api/tasks/${id}/archive`)).status, 200);
  assert.ok((await ctx.api('GET', '/api/state')).json.tasks.find((t) => t.id === id).archived);
  void x;
});

test('non-git folder: runs in place, no worktree, no undo', async () => {
  const dir = path.join(ctx.tmp, 'notes');
  fs.mkdirSync(dir);
  const p = (await ctx.api('POST', '/api/projects', { path: dir })).json;
  assert.equal(p.isGit, false);
  const t = (await ctx.api('POST', '/api/tasks', { projectId: p.id, agent: 'claude', prompt: 'create hello.md 인사' })).json;
  assert.equal(t.isolated, false);
  await ctx.waitTask(t.id, (x) => x.state !== 'working' && x.state !== 'starting');
  assert.ok(fs.existsSync(path.join(dir, 'hello.md')));
  const merge = await ctx.api('POST', `/api/tasks/${t.id}/merge`);
  assert.equal(merge.status, 400);
});

test('validation: unknown project/agent, empty prompt, duplicate project', async () => {
  assert.equal((await ctx.api('POST', '/api/tasks', { projectId: 'nope', agent: 'claude', prompt: 'x y z' })).status, 404);
  assert.equal((await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'gpt-9', prompt: 'x y z' })).status, 400);
  assert.equal((await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: ' ' })).status, 400);
  assert.equal((await ctx.api('POST', '/api/projects', { path: repo })).status, 409);
  assert.equal((await ctx.api('POST', '/api/projects', { path: 'relative/path' })).status, 400);
});
