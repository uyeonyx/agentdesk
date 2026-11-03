// A session started with no project: it works in a folder of Desk's own, and once it's clear whose
// work it is, it's anchored to a project and goes on, same conversation, in that project's worktree.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, makeRepo } from './helpers.js';

let ctx;
before(async () => {
  ctx = await boot();
});
after(() => ctx.s.shutdown(null));

const screen = async (id) => (await ctx.api('GET', `/api/tasks/${id}/screen?lines=40`)).json.lines.join('\n');
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fn();
};

test('general: a session with no project starts in its own folder under Desk\'s', async () => {
  const r = await ctx.api('POST', '/api/tasks', { agent: 'claude', prompt: 'just answer: 아직 어느 저장소 일인지 몰라요' });
  assert.equal(r.status, 200);
  const t = r.json;
  assert.equal(t.projectId, null);
  const home = fs.realpathSync.native(process.env.AGENTDESK_HOME);
  const cwd = fs.realpathSync.native(t.worktreeAbs);
  assert.ok(cwd.startsWith(path.join(home, 'general') + path.sep), cwd);
  assert.equal(t.isolated, false);
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
  assert.equal(fs.existsSync(cwd), false, 'its folder goes with it');
});

test('general: anchoring moves the conversation into the project\'s worktree and goes on there', async () => {
  const repo = makeRepo(path.join(ctx.tmp, 'billing'), { 'README.md': '# billing\n' });
  const p = (await ctx.api('POST', '/api/projects', { path: repo })).json;
  const t = (await ctx.api('POST', '/api/tasks', { agent: 'claude', prompt: 'just answer: 환불 정책 정리' })).json;
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  const scratch = fs.realpathSync.native(t.worktreeAbs);
  const before = (await ctx.api('GET', '/api/state')).json.tasks.find((x) => x.id === t.id);

  // Not a project's yet: a project id that doesn't exist is refused, nothing changes.
  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/anchor`, { projectId: 'nope' })).status, 404);

  const a = await ctx.api('POST', `/api/tasks/${t.id}/anchor`, { projectId: p.id });
  assert.equal(a.status, 200);
  assert.equal(a.json.projectId, p.id);
  assert.equal(a.json.isolated, true);
  assert.match(fs.realpathSync.native(a.json.worktreeAbs), /\.agentdesk[\\/]worktrees[\\/]/);
  assert.match(a.json.branch, /^desk\//);
  // The same conversation, resumed from a copy in the new folder (the way a fork starts).
  await until(async () => /resumed \S+ as fork/.test(await screen(t.id)));
  // (the terminal wraps long lines)
  assert.match((await screen(t.id)).replace(/\n/g, ''), new RegExp(`in ${fs.realpathSync.native(a.json.worktreeAbs).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const after = await ctx.waitTask(t.id, (x) => x.state === 'needs_input' || x.state === 'working');
  assert.equal(after.title, before.title);
  assert.equal(after.messages.length, before.messages.length, 'what I said stays');
  // Anchored once: again is refused.
  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/anchor`, { projectId: p.id })).status, 400);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
  assert.equal(fs.existsSync(scratch), false, 'the general folder goes with the task');
});
