// The window's client (ui/src/api.js) against the real core, through the same bridge shape the
// preload exposes: every action the UI sends without a payload (stop, resume, discard, archive,
// delete…) must still arrive as a JSON body.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { boot, makeRepo } from './helpers.js';

let ctx;
let api;
before(async () => {
  ctx = await boot();
  // desktop/preload.cjs: desk.api(method, path, bodyText) resolves with {status, body} or {status, type, data}.
  globalThis.window = globalThis;
  globalThis.desk = {
    async api(method, p, bodyText) {
      const { Binary } = await import('../server/core.js');
      try {
        const r = await ctx.s.dispatch(method, p, bodyText);
        if (r instanceof Binary) return { status: 200, type: r.type, data: new Uint8Array(r.data) };
        return { status: 200, body: JSON.stringify(r) };
      } catch (e) {
        return { status: e.status || 500, body: JSON.stringify({ error: e.status ? e.message : 'server error' }) };
      }
    },
  };
  api = (await import('../ui/src/api.js')).api;
});
after(() => ctx.s.shutdown());

test('body-less UI actions are accepted (stop, resume, discard, archive, project delete)', async () => {
  const repo = makeRepo(path.join(ctx.tmp, 'ui-client'));
  const proj = await api('POST', '/api/projects', { path: repo });
  const t = await api('POST', '/api/tasks', { projectId: proj.id, agent: 'claude', prompt: 'just answer: hi' });
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  assert.deepEqual(await api('POST', `/api/tasks/${t.id}/stop`), { ok: true });
  await ctx.waitTask(t.id, (x) => !x.running);
  assert.deepEqual(await api('POST', `/api/tasks/${t.id}/resume`), { ok: true });
  await ctx.waitTask(t.id, (x) => x.running);
  assert.deepEqual(await api('POST', `/api/tasks/${t.id}/discard`), { ok: true });
  const gone = (await api('GET', '/api/state')).tasks.find((x) => x.id === t.id);
  assert.equal(gone.state, 'discarded');
  assert.equal(gone.archived, true, 'discarding also takes it off the list, in one step');
  assert.deepEqual(await api('POST', `/api/tasks/${t.id}/archive`), { ok: true });
  assert.deepEqual(await api('DELETE', `/api/projects/${proj.id}`), { ok: true });
});

test('errors keep their status and message', async () => {
  await assert.rejects(api('POST', '/api/tasks/nope/send', { text: 'x' }), (e) => e.status === 404 && /작업을 찾을 수 없어요/.test(e.message));
  await assert.rejects(api('POST', '/api/projects', { path: '/nope/nope' }), (e) => e.status === 400);
  await assert.rejects(api('GET', '/api/nothing-here'), (e) => e.status === 404);
});

test('the core refuses a state change whose body is not JSON text', async () => {
  await assert.rejects(ctx.s.dispatch('PATCH', '/api/prefs', { not: 'text' }), (e) => e.status === 415);
  await assert.rejects(ctx.s.dispatch('PATCH', '/api/prefs', '{bad'), (e) => e.status === 400);
  await assert.rejects(ctx.s.dispatch('PATCH', '/api/prefs', JSON.stringify({ x: 'a'.repeat(1_100_000) })), (e) => e.status === 413);
});
