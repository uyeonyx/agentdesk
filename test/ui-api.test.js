// The browser client (ui/src/api.js) against the real daemon: every action the UI sends without
// a payload (stop, resume, discard, archive, merge, delete…) must still pass the JSON-only rule.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { boot, makeRepo } from './helpers.js';

let ctx;
let api;
before(async () => {
  ctx = await boot();
  const store = new Map([['desk.key', ctx.key]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  globalThis.location = { hash: '', pathname: '/', search: '', protocol: 'http:', host: `127.0.0.1:${ctx.port}` };
  globalThis.history = { replaceState() {} };
  const realFetch = globalThis.fetch;
  // What a browser adds by itself on a same-origin request.
  globalThis.fetch = (p, opts = {}) => realFetch(String(p).startsWith('/') ? ctx.base + p : p, { ...opts, headers: { ...opts.headers, cookie: ctx.cookie, origin: ctx.base, 'sec-fetch-site': 'same-origin' } });
  const mod = await import('../ui/src/api.js');
  assert.ok(mod.bootKey());
  api = mod.api;
});
after(() => ctx.s.shutdown(null));

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

test('the daemon still refuses a state change that is not JSON', async () => {
  const res = await fetch(`/api/prefs`, { method: 'PATCH', headers: { 'x-desk-key': ctx.key, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(res.status, 415);
});
