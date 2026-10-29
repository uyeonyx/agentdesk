// The live conversation a window subscribes to: a snapshot, then deltas while the agent works,
// subagents nested under their call, full details on request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { boot, makeRepo } from './helpers.js';

let ctx;
let one;
before(async () => {
  ctx = await boot();
  one = (await ctx.api('POST', '/api/projects', { path: makeRepo(path.join(ctx.tmp, 'solo'), { 'README.md': '# solo\n' }) })).json;
});
after(() => ctx.s.shutdown(null));

/** A window's end of the channel: collects what the core sends it. */
function peer() {
  const got = [];
  const p = { readyState: 1, send: (s) => got.push(JSON.parse(s)), got };
  p.conn = ctx.s.connectPeer(p);
  p.convo = (task) => got.filter((m) => m.t === 'convo' && m.task === task);
  return p;
}
const until = async (pred, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};
/** What a window would hold after applying everything it received. */
function replay(msgs) {
  let list = [];
  for (const m of msgs) {
    if (m.snap) list = m.snap.entries.slice();
    else
      for (const op of m.delta.ops) {
        const i = list.findIndex((e) => e.id === op.e?.id);
        if (op.op === 'add' && i < 0) list.push(op.e);
        else if (i >= 0) list[i] = op.e;
      }
  }
  return list;
}

test('a subscribed window gets a snapshot, then the conversation as it grows', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'just answer: 첫 질문' })).json;
  const w = peer();
  w.conn.message({ t: 'convo', op: 'sub', task: t.id });
  assert.ok(w.convo(t.id)[0].snap, 'snapshot first');
  await until(() => replay(w.convo(t.id)).some((e) => e.kind === 'reply'));
  const list = replay(w.convo(t.id));
  assert.deepEqual(
    list.filter((e) => e.kind === 'user' || e.kind === 'reply').map((e) => e.text || e.md),
    ['just answer: 첫 질문', 'Answer: just answer: 첫 질문']
  );
  assert.ok(list.every((e) => typeof e.seq === 'number' && !('src' in e)), 'ordered, no file offsets');
  w.conn.close();
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('tool calls carry their details; a subagent nests its own calls; full output on request', async () => {
  const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'create notes/x.md 서브에이전트로 테스트 돌려줘 subagent' })).json;
  await ctx.waitTask(t.id, (x) => x.state === 'review');
  const w = peer();
  w.conn.message({ t: 'convo', op: 'sub', task: t.id });
  const list = await until(() => {
    const l = replay(w.convo(t.id));
    return l.some((e) => e.parent) && l.some((e) => e.cat === 'edit') ? l : null;
  });
  const agent = list.find((e) => e.kind === 'agent');
  assert.equal(agent.detail.desc, '테스트 작성');
  const kid = list.find((e) => e.parent === agent.id);
  assert.equal(kid.cat, 'cmd');
  assert.match(kid.detail.command, /npm test/);
  const edit = list.find((e) => e.cat === 'edit');
  assert.equal(edit.detail.files[0].path, 'notes/x.md');
  assert.ok(edit.detail.files[0].adds > 0);
  const full = (await ctx.api('GET', `/api/tasks/${t.id}/entry?id=${encodeURIComponent(edit.id)}`)).json.entry;
  assert.equal(full.id, edit.id);
  assert.deepEqual(full.detail.files[0].path, 'notes/x.md');
  w.conn.close();
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('windows only get the tasks they watch; unsubscribing stops the flow', async () => {
  const a = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'just answer: 하나' })).json;
  const b = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'claude', prompt: 'just answer: 둘' })).json;
  const w = peer();
  w.conn.message({ t: 'convo', op: 'sub', task: a.id });
  await ctx.waitTask(b.id, (x) => x.state === 'needs_input');
  await ctx.waitTask(a.id, (x) => x.state === 'needs_input');
  assert.equal(w.convo(b.id).length, 0);
  w.conn.message({ t: 'convo', op: 'unsub', task: a.id });
  const n = w.convo(a.id).length;
  await ctx.api('POST', `/api/tasks/${a.id}/send`, { text: 'just answer: 또' });
  await ctx.waitTask(a.id, (x) => x.state === 'needs_input' && x.reply?.md?.includes('또'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(w.convo(a.id).length, n);
  w.conn.close();
  for (const t of [a, b]) await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('Codex: both rollout formats become the same conversation', async () => {
  for (const fmt of ['old', 'new']) {
    process.env.MOCK_CODEX_FORMAT = fmt;
    const t = (await ctx.api('POST', '/api/tasks', { projectId: one.id, agent: 'codex', prompt: `create notes/c-${fmt}.md 테스트 돌려줘` })).json;
    await ctx.waitTask(t.id, (x) => x.state === 'review', 15000);
    const w = peer();
    w.conn.message({ t: 'convo', op: 'sub', task: t.id });
    const list = await until(() => {
      const l = replay(w.convo(t.id));
      return l.some((e) => e.kind === 'reply') && l.some((e) => e.cat === 'cmd' && e.st !== 'run') ? l : null;
    });
    assert.equal(list.find((e) => e.kind === 'user').text, `create notes/c-${fmt}.md 테스트 돌려줘`, fmt);
    assert.match(list.find((e) => e.cat === 'cmd').detail.command, /npm test/, fmt);
    w.conn.close();
    await ctx.api('POST', `/api/tasks/${t.id}/discard`);
  }
  delete process.env.MOCK_CODEX_FORMAT;
});
