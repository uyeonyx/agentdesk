// The plan's limits from running sessions: Desk's status line hands them over, then the person's own
// status line still draws. And the full report from `claude -p /usage` as data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, makeRepo } from './helpers.js';

let ctx;
let seen;
before(async () => {
  process.env.MOCK_LIVE = '17,44';
  process.env.MOCK_USAGE = '9,40,3';
  ctx = await boot();
  // The person's own status line, in their user settings: it gets the same input Desk does.
  seen = path.join(ctx.tmp, 'own-status.json');
  fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: `cat > "${seen}"`, padding: 1 } }));
});
after(() => {
  delete process.env.MOCK_LIVE;
  delete process.env.MOCK_USAGE;
  return ctx.s.shutdown(null);
});

const rowsOf = async () => (await ctx.api('GET', '/api/usage')).json.claude?.rows || [];
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fn();
};

test('usage: the full report comes from `claude -p /usage` as data, no screen to read', async () => {
  const u = (await ctx.api('POST', '/api/usage', { force: true })).json;
  assert.deepEqual(
    u.claude.rows.map((r) => [r.key, r.pct]),
    [['current-session', 9], ['current-week-all-models', 40], ['current-week-fable', 3], ['usage-credits', 0]]
  );
});

test('usage: a running session\'s status line moves the limits live, and the person\'s own still runs', { skip: process.platform === 'win32' && 'the status line goes through sh here' }, async () => {
  const p = (await ctx.api('POST', '/api/projects', { path: makeRepo(path.join(ctx.tmp, 'live')) })).json;
  const t = (await ctx.api('POST', '/api/tasks', { projectId: p.id, agent: 'claude', prompt: 'just answer: 상태 줄' })).json;
  await ctx.waitTask(t.id, (x) => x.state === 'needs_input');
  const rows = await until(async () => {
    const r = await rowsOf();
    return r.find((x) => x.key === 'current-session')?.pct === 17 && r;
  });
  assert.equal(rows.find((x) => x.key === 'current-session').pct, 17);
  assert.equal(rows.find((x) => x.key === 'current-week-all-models').pct, 44);
  // What the report alone knows stays.
  assert.equal(rows.find((x) => x.key === 'current-week-fable').pct, 3);
  const own = await until(() => fs.existsSync(seen) && JSON.parse(fs.readFileSync(seen, 'utf8') || 'null'));
  assert.equal(own.rate_limits.five_hour.used_percentage, 17);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});
