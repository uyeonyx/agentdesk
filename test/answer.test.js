// What an agent waits on, as a card with buttons: the exact command or diff, the questions, the
// plan, and answers that become keystrokes checked against the screen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, makeRepo } from './helpers.js';

let ctx;
let one;
let careful;
before(async () => {
  ctx = await boot();
  one = (await ctx.api('POST', '/api/projects', { path: makeRepo(path.join(ctx.tmp, 'solo'), { 'README.md': '# solo\nsecond line\n' }) })).json;
  careful = (await ctx.api('POST', '/api/projects', { path: makeRepo(path.join(ctx.tmp, 'vault'), { 'README.md': '# vault\n' }), careful: true })).json;
});
after(() => ctx.s.shutdown(null));

const start = async (projectId, prompt) => (await ctx.api('POST', '/api/tasks', { projectId, agent: 'claude', prompt })).json;
const blocked = (id) => ctx.waitTask(id, (x) => x.state === 'needs_input' && x.prompt?.screen?.ready);
const answer = (id, body) => ctx.api('POST', `/api/tasks/${id}/answer`, body);

test('a Bash permission: the command on the card, 허락 runs it', async () => {
  const t = await start(one.id, 'ask before deleting build');
  const x = await blocked(t.id);
  assert.equal(x.prompt.kind, 'permission');
  assert.equal(x.prompt.title, '이 명령을 실행할까요?');
  assert.deepEqual(x.prompt.command, { text: 'rm -rf build', desc: 'Remove build' });
  assert.equal(x.prompt.screen.actions.yes, '1');
  assert.equal(x.prompt.screen.actions.no, '3');
  const r = await answer(t.id, { promptId: x.prompt.id, action: 'yes' });
  assert.deepEqual([r.status, r.json.ok, r.json.steps], [200, true, ['1']]);
  const y = await ctx.waitTask(t.id, (y) => y.state === 'review');
  assert.equal(y.prompt, null);
  assert.equal((await answer(t.id, { promptId: x.prompt.id, action: 'yes' })).status, 409, 'answered already');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('거절 with a reason: the reason goes in as a message that can be undone', async () => {
  const t = await start(one.id, 'ask before deleting build');
  const x = await blocked(t.id);
  const r = await answer(t.id, { promptId: x.prompt.id, action: 'no', text: 'just answer: build 폴더는 두고 다른 방법을 찾아줘' });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.message.text, 'just answer: build 폴더는 두고 다른 방법을 찾아줘');
  const y = await ctx.waitTask(t.id, (y) => y.messages.some((m) => m.source === 'answer'));
  assert.ok(y.messages.find((m) => m.source === 'answer').canUndo);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('careful projects ask for a second press; a stale card is refused', async () => {
  const t = await start(careful.id, 'ask before deleting build');
  const x = await blocked(t.id);
  assert.equal((await answer(t.id, { promptId: x.prompt.id, action: 'yes' })).status, 412);
  assert.equal((await answer(t.id, { promptId: 'q_old', action: 'yes', confirm: true })).status, 409);
  assert.equal((await answer(t.id, { promptId: x.prompt.id, action: 'yes', confirm: true })).json.ok, true);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('an Edit permission shows the diff with the file own line numbers', async () => {
  const t = await start(one.id, 'askedit 제목 바꾸기');
  const x = await blocked(t.id);
  assert.equal(x.prompt.title, '이 파일을 고칠까요?');
  const f = x.prompt.edit.files[0];
  assert.equal(f.path, 'README.md');
  assert.deepEqual([f.adds, f.dels], [1, 1]);
  assert.deepEqual(f.hunks[0].lines.filter((l) => l[0] !== ' '), ['-# solo', '+# 바뀐 제목']);
  assert.equal(f.hunks[0].a, 1);
  assert.equal((await answer(t.id, { promptId: x.prompt.id, action: 'yes' })).json.ok, true);
  await ctx.waitTask(t.id, (y) => y.state !== 'needs_input');
  assert.match(fs.readFileSync(path.join(x.worktreeAbs, 'README.md'), 'utf8'), /^# 바뀐 제목/);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('two questions, one multi-select: answered from the card, recorded as one turning point', async () => {
  const t = await start(one.id, 'askq2 질문 두 개');
  const x = await blocked(t.id);
  assert.equal(x.prompt.kind, 'question');
  assert.deepEqual(
    x.prompt.questions.map((q) => [q.header, q.multi, q.options.length]),
    [
      ['주제', false, 2],
      ['범위', true, 3],
    ]
  );
  const r = await answer(t.id, { promptId: x.prompt.id, answers: [{ pick: ['토큰 정리'] }, { pick: ['버튼', '카드'] }] });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  const y = await ctx.waitTask(t.id, (y) => y.state === 'needs_input' && /답을 받았어요/.test(y.reply?.md || ''));
  assert.equal(y.messages.at(-1).source, 'answer');
  assert.equal(y.messages.at(-1).text, '주제 → 토큰 정리 · 범위 → 버튼, 카드');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('a question answered in my own words, and an answer the screen does not offer', async () => {
  const t = await start(one.id, 'askq2 직접 입력');
  const x = await blocked(t.id);
  const bad = await answer(t.id, { promptId: x.prompt.id, answers: [{ pick: ['화면에 없는 답'] }] });
  assert.deepEqual([bad.json.ok, bad.json.fallback, bad.json.step], [false, 'terminal', 'q1']);
  const r = await answer(t.id, { promptId: x.prompt.id, answers: [{ text: '직접 쓴 주제' }, { pick: [] }] });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  const y = await ctx.waitTask(t.id, (y) => y.messages.some((m) => m.source === 'answer'));
  assert.equal(y.messages.at(-1).text, '주제 → 직접 쓴 주제 · 범위 → ');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('plan approval: the plan on the card, options in my words, approving starts the work', async () => {
  const t = await start(one.id, 'planmode 버튼 정리');
  const x = await blocked(t.id);
  assert.equal(x.prompt.kind, 'plan');
  assert.match(x.prompt.plan, /^# 계획/);
  assert.deepEqual(
    x.prompt.screen.plan.map((c) => [c.key, c.ko, c.action]),
    [
      ['1', '승인 · 수정은 자동 허락', 'approve'],
      ['2', '승인 · 수정마다 확인', 'approve'],
      ['3', '계획 더 다듬기', 'keep'],
    ]
  );
  assert.equal((await answer(t.id, { promptId: x.prompt.id, action: 'approve', option: '1' })).json.ok, true);
  const y = await ctx.waitTask(t.id, (y) => y.state === 'review');
  assert.equal(y.messages.at(-1).text, '계획 승인 · 수정은 자동 허락');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('계획 더 다듬기 with feedback goes in as a message', async () => {
  const t = await start(one.id, 'planmode 다시');
  const x = await blocked(t.id);
  const r = await answer(t.id, { promptId: x.prompt.id, action: 'keep', option: '3', text: 'just answer: 2단계는 빼 줘' });
  assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.equal(r.json.message.text, 'just answer: 2단계는 빼 줘');
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('the last reply comes with the task as a short markdown excerpt', async () => {
  const t = await start(one.id, `just answer: ${'긴 답 '.repeat(200)}`);
  const x = await ctx.waitTask(t.id, (x) => x.state === 'needs_input' && x.reply);
  assert.ok(x.reply.md.length <= 702);
  assert.equal(x.reply.more, true);
  assert.match(x.reply.md, /^Answer: just answer:/);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});

test('a pasted image is saved where the agent can read it', async () => {
  const t = await start(one.id, 'just answer: 이미지');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  const r = await ctx.api('POST', `/api/tasks/${t.id}/attachments`, { type: 'image/png', data: png });
  assert.equal(r.status, 200);
  assert.ok(fs.existsSync(r.json.path) && r.json.path.endsWith('.png'));
  assert.equal((await ctx.api('POST', `/api/tasks/${t.id}/attachments`, { type: 'text/html', data: png })).status, 400);
  await ctx.api('POST', `/api/tasks/${t.id}/discard`);
});
