// The whole loop with mock Claude/Codex CLIs: dispatch → hook → review → send → undo → merge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { boot, makeRepo } from './helpers.js';

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

test('codex task: notify hook ends the turn; a no-change answer lands in "needs input"', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'codex', prompt: 'just answer: what is FIPS?' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  assert.match(x.summary, /FIPS/);
  ctx.codex = t.id;
});

test('permission prompt: Notification hook marks the task as waiting with the reason', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'ask before deleting build' })).json;
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input' && /permission/i.test(x.reason));
  assert.match(x.reason, /permission/i);
  ctx.ask = t.id;
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
