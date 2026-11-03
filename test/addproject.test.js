// Adding a project from a folder that was picked or dropped: the repo it is, or the repos inside it.
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

const inspect = (p) => ctx.api('GET', `/api/inspect?path=${encodeURIComponent(p)}`);

test('a repo, or a folder inside one, is the repo itself', async () => {
  const repo = makeRepo(path.join(ctx.tmp, 'pick', 'solo'), { 'README.md': '# solo\n', 'src/a.js': '1\n' });
  const r = await inspect(repo);
  assert.equal(r.status, 200);
  assert.equal(r.json.self.git, true);
  assert.equal(r.json.self.path, fs.realpathSync(repo));
  assert.deepEqual(r.json.repos, []);
  const sub = await inspect(path.join(repo, 'src'));
  assert.equal(sub.json.self.git, true);
  assert.equal(sub.json.self.path, fs.realpathSync(repo));
});

test('a folder of repos lists them, deep ones and ones under Documents included, the added ones marked', async () => {
  const top = path.join(ctx.tmp, 'pick', 'clients');
  makeRepo(path.join(top, 'acme', 'web'));
  makeRepo(path.join(top, 'acme', 'api'));
  makeRepo(path.join(top, 'Documents', 'notes'));
  makeRepo(path.join(top, 'a', 'b', 'c', 'deep'));
  fs.mkdirSync(path.join(top, 'node_modules', 'x', '.git'), { recursive: true });
  const added = await ctx.api('POST', '/api/projects', { path: path.join(top, 'acme', 'api') });
  assert.equal(added.status, 200);
  const r = await inspect(top);
  assert.equal(r.json.self.git, false);
  const names = r.json.repos.map((x) => x.name).sort();
  assert.deepEqual(names, ['api', 'deep', 'notes', 'web']);
  assert.equal(r.json.repos.find((x) => x.name === 'api').added, true);
  assert.equal(r.json.repos.find((x) => x.name === 'web').added, false);
});

test('a plain folder has no repos; a missing or relative one is refused', async () => {
  const plain = path.join(ctx.tmp, 'pick', 'plain');
  fs.mkdirSync(plain, { recursive: true });
  const r = await inspect(plain);
  assert.equal(r.json.self.git, false);
  assert.deepEqual(r.json.repos, []);
  assert.equal((await inspect(path.join(ctx.tmp, 'nope'))).status, 400);
  assert.equal((await inspect('relative/dir')).status, 400);
  assert.equal((await inspect('')).status, 400);
});
