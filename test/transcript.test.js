// Transcript → conversation entries, on synthetic Claude Code and Codex transcripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createParser, detailOf, sanitize, PREVIEW_CAPS, FULL_CAPS } from '../server/transcript.js';
import { diffLines, hunksFromStructured, parseApplyPatch, stats } from '../server/diff.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcripts');
const SUB = path.join(FIX, 'claude-sub', 'sess-sub', 'subagents');

/** Lines of a file with their byte offsets, read the way a tailer does: in chunks of the given sizes. */
function readLines(buf, sizes = [buf.length]) {
  const out = [];
  let pending = Buffer.alloc(0);
  let start = 0; // file offset of pending[0]
  let pos = 0;
  let i = 0;
  while (pos < buf.length) {
    const n = Math.max(1, sizes[i++ % sizes.length]);
    pending = Buffer.concat([pending, buf.subarray(pos, pos + n)]);
    pos += n;
    let k;
    while ((k = pending.indexOf(10)) >= 0) {
      if (k > 0) out.push({ text: pending.subarray(0, k).toString('utf8'), src: { seg: 0, off: start, len: k } });
      pending = pending.subarray(k + 1);
      start += k + 1;
    }
  }
  if (pending.length) out.push({ text: pending.toString('utf8'), src: { seg: 0, off: start, len: pending.length } });
  return out;
}

/** Feed lines to a parser; entries by id after all ops, plus the ops themselves. */
function run(opts, lines) {
  const p = createParser(opts);
  const entries = new Map();
  const ops = [];
  for (const l of lines) {
    for (const op of p.line(typeof l.text === 'string' ? JSON.parse(l.text) : l.j ?? l, l.src)) {
      ops.push(op);
      if (op.op === 'add' || op.op === 'upd') entries.set(op.e.id, op.e);
      else if (op.op === 'del') entries.delete(op.id);
    }
  }
  return { p, entries, ops, list: [...entries.values()] };
}

const fileLines = (name, sizes) => readLines(fs.readFileSync(path.join(FIX, name)), sizes);
const claudeRich = (opts = {}, sizes) => run({ agent: 'claude', cwd: '/work/demo', ...opts }, fileLines('claude-rich.jsonl', sizes));
const byTool = (r, id) => r.entries.get(id);

test('claude: prompts, replies and thinking', () => {
  const r = claudeRich();
  const users = r.list.filter((e) => e.kind === 'user');
  assert.deepEqual(
    users.map((e) => [e.text, e.turn]),
    [
      ['Fix the failing test in src/math.js', 1],
      ['Also update the README', 2], // typed while the agent worked: a queued_command attachment
      ['Now refactor src/math.js', 3],
      ['Show bold text please', 4], // ANSI, BEL and a C1 CSI stripped
    ],
  );
  // The injected <browser_instruction> block is dropped; the id keeps the prompt's block index.
  assert.match(users[2].id, /:1$/);
  // Empty thinking is skipped, the non-empty one shows; meta and command output lines never do.
  const thinking = r.list.filter((e) => e.kind === 'thinking');
  assert.deepEqual(thinking.map((e) => e.md), ['Look at the test first.']);
  assert.ok(!r.list.some((e) => /Caveat|Compacted|injected/.test(JSON.stringify(e))));
  // Two text blocks of one message are two replies, told apart by block index.
  const replies = r.list.filter((e) => e.kind === 'reply');
  assert.deepEqual(replies.slice(0, 2).map((e) => [e.id.split(':')[1], e.md]), [['0', 'I will run the tests.'], ['1', 'Then fix **add**.']]);
  assert.equal(r.p.state.turn, 4);
});

test('claude: every tool category carries its detail', () => {
  const r = claudeRich();
  const bash = byTool(r, 'toolu_bash1');
  assert.equal(bash.cat, 'cmd');
  assert.equal(bash.st, 'err');
  assert.equal(bash.title, '$ npm test');
  assert.deepEqual(bash.detail, { command: 'npm test', desc: 'Run tests', out: 'FAIL src/math.test.js\n  expected 3, got -1', outLines: 2, exit: 1, bg: '' });
  assert.deepEqual(bash.src, { use: bash.src.use, res: bash.src.res });
  assert.ok(bash.src.use.off < bash.src.res.off);

  assert.deepEqual(byTool(r, 'toolu_read1').detail, { path: '/work/demo/src/math.js', from: 1, to: 3, total: 3 });
  assert.equal(byTool(r, 'toolu_read1').title, '읽기 src/math.js');

  const edit = byTool(r, 'toolu_edit1');
  assert.equal(edit.title, '수정 src/math.js');
  assert.deepEqual(edit.detail, { files: [{ path: '/work/demo/src/math.js', op: 'edit', adds: 1, dels: 1, hunks: [{ a: 1, b: 1, lines: [' function add(a, b) {', '-  return a - b;', '+  return a + b;', ' }'] }] }], clipped: false });
  // A created file has an empty structuredPatch: its content reads as all additions.
  assert.deepEqual(byTool(r, 'toolu_write1').detail.files[0], { path: '/work/demo/NOTES.md', op: 'create', adds: 2, dels: 0, hunks: [{ a: 0, b: 1, lines: ['+# Notes', '+fixed add'] }] });

  assert.deepEqual(byTool(r, 'toolu_grep1').detail, { pattern: 'add\\(', path: '/work/demo/src', count: 2, files: ['/work/demo/src/math.js', '/work/demo/src/index.js'] });
  assert.equal(byTool(r, 'toolu_glob1').detail.count, 1);

  assert.deepEqual(byTool(r, 'toolu_fetch1').detail, { url: 'https://example.com/docs/api', host: 'example.com', code: 200, out: 'The API has two endpoints.', outLines: 1 });
  assert.equal(byTool(r, 'toolu_fetch1').ms, 321);
  assert.deepEqual(byTool(r, 'toolu_search1').detail.results, [{ title: 'Test runner | Node.js', url: 'https://nodejs.org/api/test.html' }]);

  const mcp = byTool(r, 'toolu_mcp1');
  assert.equal(mcp.title, 'docs: search');
  assert.deepEqual(mcp.detail, { server: 'docs', tool: 'search', input: '{\n  "q": "add"\n}', out: 'found 3 docs', outLines: 1 });
  assert.equal(byTool(r, 'toolu_mcp2').st, 'err');
  assert.equal(byTool(r, 'toolu_mcp2').error, 'MCP error -32602: invalid params');

  const todo = byTool(r, 'toolu_todo1');
  assert.equal(todo.kind, 'todo');
  assert.deepEqual(todo.detail.items, [{ text: 'Fix add', status: 'done' }, { text: 'Write notes', status: 'active' }, { text: 'Push', status: 'pending' }]);

  const ask = byTool(r, 'toolu_ask1');
  assert.equal(ask.cat, 'ask');
  assert.deepEqual(ask.detail, { questions: [{ header: 'Runner', question: 'Which runner?', multi: false, options: [{ label: 'node:test', desc: 'Built in' }, { label: 'vitest', desc: 'Fast' }] }], answers: { 'Which runner?': 'node:test' } });

  // The approved plan is the one the person may have edited (in the result), not the proposal.
  assert.deepEqual(byTool(r, 'toolu_plan1').detail, { plan: '# Plan\n1. Fix add\n2. Add a test' });

  const sub = byTool(r, 'toolu_agent1');
  assert.equal(sub.kind, 'agent');
  assert.equal(sub.st, 'ok');
  assert.equal(sub.ms, 4500);
  assert.deepEqual(sub.detail, { desc: 'Explore tests', type: 'Explore', result: 'Found **2** test files.', agentId: 'a111' });

  const generic = byTool(r, 'toolu_ts1');
  assert.equal(generic.cat, 'tool');
  assert.equal(generic.detail.input, '{\n  "query": "select:Foo"\n}');
});

test('claude: denied, failed and stopped calls', () => {
  const r = claudeRich();
  const blocked = byTool(r, 'toolu_bash2');
  assert.equal(blocked.st, 'denied');
  assert.match(blocked.error, /^Permission for this action was denied/);
  assert.equal(blocked.detail.out, '');
  const rejected = byTool(r, 'toolu_bash3');
  assert.equal(rejected.st, 'denied');
  assert.equal(rejected.feedback, 'not yet');
  // A rejected plan keeps the plan it proposed, with why.
  const plan = byTool(r, 'toolu_plan2');
  assert.equal(plan.st, 'denied');
  assert.deepEqual(plan.detail, { plan: '# Plan B' });
  assert.equal(plan.feedback, 'add tests first');
  // "[Request interrupted by user]" stops what was running and says so.
  assert.equal(byTool(r, 'toolu_multi1').st, 'stopped');
  assert.equal(byTool(r, 'toolu_bash6').st, 'stopped');
  const stopped = r.list.find((e) => e.kind === 'notice' && e.text === '중단됨');
  assert.ok(stopped && stopped.turn === 3);
  // A call still unanswered when its turn ends was cut off.
  assert.equal(byTool(r, 'toolu_bash8').st, 'stopped');
  // MultiEdit before its result: hunks from the edits, without line numbers (unknown yet).
  assert.deepEqual(byTool(r, 'toolu_multi1').detail.files[0].hunks, [{ a: null, b: null, lines: ['-a', '+b'] }, { a: null, b: null, lines: [' x', '-y', '+z'] }]);
});

test('claude: background commands and agents finish by notification, hand-back or queue', () => {
  const r = claudeRich();
  const build = byTool(r, 'toolu_bash4');
  assert.equal(build.st, 'ok');
  assert.equal(build.detail.bg, 'bg4');
  assert.equal(build.detail.exit, 0);
  // Killed before its notification was delivered: only the queue log says so.
  const watch = byTool(r, 'toolu_bash5');
  assert.equal(watch.st, 'stopped');
  // Launched in the background, then handed its report back.
  const review = byTool(r, 'toolu_agent2');
  assert.equal(review.st, 'ok');
  assert.equal(review.detail.result, 'Review: looks good.');
  assert.equal(review.detail.agentId, 'a222');
  // While running, they stayed 'run' through the end of their turn and the interrupt.
  const turnEnd = r.ops.findIndex((o) => o.op === 'add' && o.e.kind === 'turn');
  const before = r.ops.slice(0, turnEnd).filter((o) => o.e?.id === 'toolu_agent2').pop();
  assert.equal(before.e.st, 'run');
  assert.equal(before.e.detail.bg, true);
  const notices = r.list.filter((e) => e.kind === 'notice' && e.text === '백그라운드 작업이 끝났어요');
  assert.equal(notices.length, 1); // the queue copy updates the card without a second notice
  assert.match(notices[0].summary, /exit code 0/);
});

test('claude: a hand-back delivered as a message from the subagent (SubagentHandback) fills its card', () => {
  const at = (sec) => `2026-10-29T02:53:${String(sec).padStart(2, '0')}.000Z`;
  const r = run({ agent: 'claude', cwd: '/work/demo' }, [
    { type: 'user', uuid: 'u1', timestamp: at(0), message: { role: 'user', content: 'README 첫 줄을 서브에이전트로 읽어 줘' } },
    { type: 'assistant', uuid: 'a1', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_hb', name: 'Agent', input: { description: 'README 첫 줄 읽기', subagent_type: 'general-purpose', prompt: 'Read the first line', run_in_background: true } }] } },
    {
      type: 'user',
      uuid: 'u2',
      timestamp: at(2),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_hb', content: 'This agent\'s report was delivered to you as a message from "a333" (its SubagentHandback call). Read it there; it is not repeated here.' }] },
      toolUseResult: { agentId: 'a333', isAsync: true, status: 'async_launched' },
    },
    {
      type: 'user',
      uuid: 'u3',
      timestamp: at(9),
      isMeta: true,
      message: { role: 'user', content: 'Another Claude session sent a message:\n<agent-message from="a333">\n[Subagent hand-back] The text below is the final report…' },
      origin: { kind: 'peer', from: 'a333', handback: true, body: '[Subagent hand-back] …', handbackReportText: 'README.md의 첫 줄은 # Real repo 예요.' },
    },
    // Then the task notification, whose result only points back at that message.
    {
      type: 'user',
      uuid: 'u4',
      timestamp: at(10),
      message: { role: 'user', content: '<task-notification>\n<task-id>a333</task-id>\n<tool-use-id>toolu_hb</tool-use-id>\n<status>completed</status>\n<summary>Agent "README 첫 줄 읽기" finished</summary>\n<result>This agent\'s report was delivered to you as a message from "a333" (its SubagentHandback call). Read it there; it is not repeated here.</result>\n</task-notification>' },
    },
  ]);
  const card = byTool(r, 'toolu_hb');
  assert.equal(card.detail.agentId, 'a333');
  assert.equal(card.detail.result, 'README.md의 첫 줄은 # Real repo 예요.');
  assert.equal(card.st, 'ok');
  // The hand-back is the subagent's, not a turn of mine.
  assert.equal(r.list.filter((e) => e.kind === 'user').length, 1);
});

test('claude: notices, compaction and turn ends', () => {
  const r = claudeRich();
  const notice = (re) => r.list.find((e) => e.kind === 'notice' && re.test(e.text));
  assert.ok(notice(/^명령: \/compact$/));
  assert.ok(notice(/^셸: ls$/));
  const api = notice(/^API 오류/);
  assert.equal(api.level, 'warn');
  assert.equal(api.summary, 'Connection lost');
  assert.equal(notice(/^API Error: Something broke$/).level, 'warn');
  const compacts = r.list.filter((e) => e.kind === 'compact');
  assert.equal(compacts.length, 1);
  assert.deepEqual([compacts[0].trigger, compacts[0].pre, compacts[0].summary], ['manual', 120000, 'Summary: fixed add.']);
  // The summary line updates the boundary's entry instead of adding one.
  assert.ok(r.ops.some((o) => o.op === 'upd' && o.e.kind === 'compact'));
  assert.deepEqual(r.list.filter((e) => e.kind === 'turn').map((e) => e.ms), [42000, 5000]);
  // A result whose call is not in this window waits for it.
  assert.deepEqual([...r.p.state.orphans.keys()], ['toolu_never']);
});

test('ids and entries are the same whatever the chunking, and on every re-parse', () => {
  const whole = claudeRich();
  let seed = 42;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n) + 1;
  for (let k = 0; k < 15; k++) {
    const sizes = Array.from({ length: 20 }, () => rnd(k % 2 ? 7 : 900));
    const again = claudeRich({}, sizes);
    assert.deepEqual(again.list, whole.list);
    assert.deepEqual(again.ops, whole.ops);
  }
  for (const [file, agent] of [['codex-old.jsonl', 'codex'], ['codex-new.jsonl', 'codex']]) {
    const a = run({ agent }, fileLines(file));
    const b = run({ agent }, fileLines(file, [3, 50, 1, 700]));
    assert.deepEqual(b.list, a.list, file);
  }
});

test('a window starting mid-file gives the same ids; results seen before their call are kept', () => {
  const lines = fileLines('claude-rich.jsonl');
  const whole = claudeRich();
  const ids = new Set(whole.entries.keys());
  for (const from of [5, 9, 20, 33, 47, 60]) {
    const part = run({ agent: 'claude', cwd: '/work/demo' }, lines.slice(from));
    for (const id of part.entries.keys()) assert.ok(ids.has(id), `${id} (window from line ${from})`);
  }
  // Its result read before its call (the call sat in an earlier window): one add, already finished.
  const use = lines.findIndex((l) => l.text.includes('"id":"toolu_edit1"'));
  const swapped = run({ agent: 'claude', cwd: '/work/demo' }, [lines[use + 1], lines[use]]);
  assert.deepEqual(swapped.ops.map((o) => o.op), ['add']);
  // Same entry, but for the turn: a window counts the prompts it has seen.
  assert.deepEqual({ ...swapped.entries.get('toolu_edit1'), turn: 1 }, whole.entries.get('toolu_edit1'));
});

test('caps clip previews; the src lines re-read with FULL_CAPS give everything', () => {
  const caps = { ...PREVIEW_CAPS, md: 10, outLines: 3, outBytes: 1000, diffLines: 2 };
  const r = claudeRich({ caps });
  assert.equal(r.list.find((e) => e.kind === 'reply').md, 'I will ru…');
  const seq = byTool(r, 'toolu_bash7');
  assert.equal(seq.detail.out, '98\n99\n100');
  assert.equal(seq.detail.outLines, 100);
  const edit = byTool(r, 'toolu_edit1').detail;
  assert.equal(edit.clipped, true);
  assert.equal(edit.files[0].hunks[0].lines.length, 2);
  assert.deepEqual([edit.files[0].adds, edit.files[0].dels], [1, 1]); // counts are of the whole diff
  // Byte cap: the tail is cut mid-line and marked.
  const small = claudeRich({ caps: { ...PREVIEW_CAPS, outBytes: 8 } });
  assert.equal(small.entries.get('toolu_bash7').detail.out, '…8\n99\n100');
  // Default preview keeps 40 lines; the src lines in a FULL_CAPS parser keep all 100.
  const preview = byTool(claudeRich(), 'toolu_bash7');
  assert.equal(preview.detail.out.split('\n').length, 40);
  const all = fileLines('claude-rich.jsonl');
  const at = (src) => all.find((l) => l.src.off === src.off);
  const full = run({ agent: 'claude', cwd: '/work/demo', caps: FULL_CAPS }, [at(preview.src.use), at(preview.src.res)]);
  assert.equal(full.entries.get('toolu_bash7').detail.out.split('\n').length, 100);
});

test('sanitize strips terminal escapes and control characters and clips safely', () => {
  assert.equal(sanitize('\x1b[31mred\x1b[0m and \x1b[1;4mbold\x1b[m'), 'red and bold');
  assert.equal(sanitize('\x1b]0;window title\x07after'), 'after');
  assert.equal(sanitize('\x1b]8;;https://x.test\x1b\\link\x1b]8;;\x1b\\'), 'link');
  assert.equal(sanitize('a\x00b\x07c\x85d\x7fe'), 'abcde');
  assert.equal(sanitize('tab\tand\nnewline'), 'tab\tand\nnewline');
  assert.equal(sanitize('10%\r50%\r100%\ndone\r\n'), '100%\ndone\n');
  assert.equal(sanitize('abcdef', 4), 'abc…');
  assert.equal(sanitize('ab😀cd', 4), 'ab…'); // never half a surrogate pair
  assert.equal(sanitize(null), '');
  assert.equal(sanitize(12), '12');
});

test('claude subagent transcripts: prompt skipped, everything nested under the Agent call', () => {
  const meta = JSON.parse(fs.readFileSync(path.join(SUB, 'agent-x.meta.json'), 'utf8'));
  const r = run({ agent: 'claude', cwd: '/work/demo', parent: meta.toolUseId }, readLines(fs.readFileSync(path.join(SUB, 'agent-x.jsonl'))));
  assert.deepEqual(r.list.map((e) => [e.kind, e.parent]), [['tool', 'toolu_agent1'], ['reply', 'toolu_agent1']]);
  assert.equal(r.entries.get('toolu_sub_bash1').detail.out, 'a.test.js\nb.test.js');
  // A fork's transcript repeats the parent's call and result: neither shows.
  const forkMeta = JSON.parse(fs.readFileSync(path.join(SUB, 'agent-y.meta.json'), 'utf8'));
  const f = run({ agent: 'claude', parent: forkMeta.toolUseId }, readLines(fs.readFileSync(path.join(SUB, 'agent-y.jsonl'))));
  assert.deepEqual(f.list.map((e) => [e.kind, e.md, e.parent]), [['reply', 'Fork reply', 'toolu_fork1']]);
});

test('claude legacy sidechain lines join the one running Agent call, or nothing', () => {
  const ts = (s) => `2025-05-01T10:00:${String(s).padStart(2, '0')}.000Z`;
  const a = (uuid, s, content, extra = {}) => ({ type: 'assistant', uuid, timestamp: ts(s), message: { role: 'assistant', content }, ...extra });
  const u = (uuid, s, content, extra = {}) => ({ type: 'user', uuid, timestamp: ts(s), message: { role: 'user', content }, ...extra });
  const side = { isSidechain: true };
  const r = run({ agent: 'claude' }, [
    u('u1', 1, 'go'),
    a('a1', 2, [{ type: 'tool_use', id: 'toolu_L1', name: 'Task', input: { description: 'Legacy', subagent_type: 'general-purpose', prompt: 'do it' } }]),
    u('s1', 3, 'do it', side),
    a('s2', 4, [{ type: 'tool_use', id: 'toolu_L2', name: 'Bash', input: { command: 'ls' } }], side),
    u('s3', 5, [{ type: 'tool_result', tool_use_id: 'toolu_L2', content: 'x' }], side),
    a('s4', 6, [{ type: 'text', text: 'sub done' }], side),
    u('u2', 7, [{ type: 'tool_result', tool_use_id: 'toolu_L1', content: 'sub done' }]),
    a('a2', 8, [{ type: 'tool_use', id: 'toolu_L3', name: 'Task', input: { description: 'A' } }]),
    a('a3', 9, [{ type: 'tool_use', id: 'toolu_L4', name: 'Task', input: { description: 'B' } }]),
    a('s5', 10, [{ type: 'text', text: 'whose?' }], side),
  ]);
  assert.equal(r.entries.get('toolu_L2').parent, 'toolu_L1');
  assert.equal(r.entries.get('toolu_L2').st, 'ok');
  assert.equal(r.entries.get('s4:0').parent, 'toolu_L1');
  assert.ok(!r.list.some((e) => e.text === 'do it')); // the subagent's prompt
  assert.ok(!r.entries.has('s5:0')); // two Agent calls running: no telling
  assert.equal(r.entries.get('toolu_L1').detail.result, 'sub done');
  assert.equal(r.p.state.turn, 1);
});

test('codex, older rollouts: calls, outputs, plan, patch, compaction', () => {
  const r = run({ agent: 'codex', cwd: '/work/demo' }, fileLines('codex-old.jsonl'));
  assert.deepEqual(r.ops[0], { op: 'meta', sessionId: '11111111-2222-3333-4444-555555555555' });
  const users = r.list.filter((e) => e.kind === 'user');
  assert.deepEqual(users.map((e) => [e.text, e.turn, e.images]), [['fix the tests', 1, undefined], ['now wait', 2, 1]]);
  assert.deepEqual(r.list.filter((e) => e.kind === 'thinking').map((e) => e.md), ['**Planning**\n\nLook at the tests.']);
  // The assistant `message` item and the agent_message event are the same reply.
  assert.deepEqual(r.list.filter((e) => e.kind === 'reply').map((e) => e.md), ['Fixed the add function.']);

  const shell = r.entries.get('call_1');
  assert.deepEqual([shell.cat, shell.title, shell.st, shell.ms], ['cmd', '$ npm test', 'err', 1500]);
  assert.deepEqual(shell.detail, { command: 'npm test', desc: '', out: 'FAIL math\n1 failing', outLines: 2, exit: 1, bg: '' });
  const exec = r.entries.get('call_4');
  assert.deepEqual([exec.st, exec.ms, exec.detail.exit, exec.detail.out], ['ok', 12, 0, 'math.js\nindex.js']);
  const git = r.entries.get('call_5');
  assert.deepEqual([git.st, git.detail.exit, git.detail.out], ['err', 128, 'fatal: not a git repository']);

  const patch = r.entries.get('call_2');
  assert.equal(patch.cat, 'edit');
  assert.equal(patch.title, '수정 src/math.js, NOTES.md, old.js');
  assert.deepEqual(
    patch.detail.files.map((f) => [f.path, f.op, f.adds, f.dels, f.to]),
    [
      ['src/math.js', 'edit', 1, 1, undefined],
      ['NOTES.md', 'create', 2, 0, undefined],
      ['old.js', 'delete', 0, 0, undefined],
      ['src/a.js', 'move', 1, 1, 'src/b.js'],
    ],
  );
  const plan = r.entries.get('call_3');
  assert.equal(plan.kind, 'todo');
  assert.deepEqual(plan.detail.items.map((i) => i.status), ['done', 'active', 'pending']);
  const mcp = r.entries.get('call_6');
  assert.deepEqual([mcp.cat, mcp.title, mcp.detail.server, mcp.detail.tool, mcp.detail.out], ['mcp', 'docs: search', 'docs', 'search', 'no results']);
  const agent = r.entries.get('call_7');
  assert.deepEqual([agent.kind, agent.detail.desc, agent.detail.type, agent.detail.agentId], ['agent', 'review the patch', 'reviewer', 'agent-7']);
  assert.equal(r.entries.get('call_8').st, 'denied');
  assert.equal(r.entries.get('ws_1').detail.query, 'node test runner');

  assert.equal(r.list.find((e) => e.kind === 'turn').ms, 12000);
  assert.equal(r.entries.get('call_9').st, 'stopped');
  assert.ok(r.list.some((e) => e.kind === 'notice' && e.text === '중단됨'));
  // `compacted` and `context_compacted` are one compaction.
  assert.deepEqual(r.list.filter((e) => e.kind === 'compact').map((e) => e.summary), ['Summary: fixed add.']);
  assert.deepEqual([...r.p.state.orphans.keys()], ['call_unknown']);
});

test('codex, newer rollouts: exec scripts turn into the commands they run', () => {
  const r = run({ agent: 'codex', cwd: '/work/demo' }, fileLines('codex-new.jsonl'));
  assert.equal(r.ops[0].sessionId, '01aaaaaa-0000-7000-8000-000000000001');
  // The script card is replaced in place (upd, same id) by its first command.
  const firstOps = r.ops.filter((o) => o.e?.id === 'call_A');
  assert.deepEqual(firstOps.map((o) => [o.op, o.e.cat, o.e.st]), [['add', 'code', 'run'], ['upd', 'cmd', 'ok']]);
  assert.equal(firstOps[0].e.title, 'text(await tools.exec_command({cmd:"cat SKILL.md"}))');
  const a = r.entries.get('call_A');
  assert.deepEqual([a.title, a.ms, a.detail.out, a.detail.exit], ['$ cat SKILL.md', 1500, '# Skill\nsteps', 0]);
  assert.ok(!r.entries.has('exec-1'));
  // Later commands of the same script are entries of their own.
  assert.deepEqual([r.entries.get('call_B').title, r.entries.get('call_B').st], ['$ npm test', 'err']);
  assert.deepEqual([r.entries.get('exec-3').title, r.entries.get('exec-3').st], ['$ npm run lint', 'ok']);
  assert.equal(r.ops.filter((o) => o.e?.id === 'call_B' && o.op === 'upd').length, 1); // the script's own output is ignored
  // A script that ran no tool shows its own output. Its title skips the `// @exec` pragma.
  const c = r.entries.get('call_C');
  assert.deepEqual([c.cat, c.st, c.title, c.detail.out, c.ms], ['code', 'ok', 'const r = 1 + 1;', '2', 100]);
  // Anything else it ran (image generation) still shows, without its image data.
  const d = r.entries.get('call_D');
  assert.deepEqual([d.cat, d.title, d.st, d.ms, d.detail.out], ['tool', 'image_gen.generation', 'ok', 14000, '/home/me/.codex/generated_images/i.png']);
  assert.ok(!JSON.stringify(d).includes('AAAAAAAAAA'));
  // Replies: once each (item, response message and event copies), the writing wrapper removed.
  assert.deepEqual(r.list.filter((e) => e.kind === 'reply').map((e) => [e.md, e.phase]), [['Reading the skill first.', 'commentary'], ['Here is **the icon**.', 'final_answer']]);
  assert.deepEqual(r.list.filter((e) => e.kind === 'user').map((e) => [e.text, e.turn]), [['make an icon', 1]]);
  assert.equal(r.list.find((e) => e.kind === 'turn').ms, 30000);
});

test('codex: an item type nobody knows yet still shows as a tool', () => {
  const r = run({ agent: 'codex' }, [{ type: 'event_msg', timestamp: '2026-01-01T00:00:00Z', payload: { type: 'item_completed', item: { type: 'FancyNewThing', id: 'x1', status: 'completed', foo: 'bar' } } }]);
  const e = r.entries.get('x1');
  assert.deepEqual([e.kind, e.cat, e.title, e.st], ['tool', 'tool', 'FancyNewThing', 'ok']);
  assert.equal(e.detail.input, '{\n  "foo": "bar"\n}');
});

test('detailOf is pure and works from the call alone', () => {
  // An Edit seen before its result: hunks from old/new strings, numbered only when the file is known.
  const input = { file_path: '/w/a.js', old_string: 'b\n', new_string: 'B\n' };
  assert.deepEqual(detailOf('edit', input, '', undefined).files[0].hunks, [{ a: null, b: null, lines: ['-b', '+B'] }]);
  assert.deepEqual(detailOf('edit', input, '', { originalFile: 'a\nb\nc\n' }).files[0].hunks, [{ a: 2, b: 2, lines: ['-b', '+B'] }]);
  assert.deepEqual(detailOf('cmd', { command: 'x' }, 'Exit code 2\nboom', 'Error: Exit code 2\nboom'), { command: 'x', desc: '', out: 'boom', outLines: 1, exit: 2, bg: '' });
  const once = detailOf('read', { file_path: '/w/a.js', offset: 10, limit: 5 }, '', undefined);
  assert.deepEqual(once, { path: '/w/a.js', from: 10, to: 14, total: null });
  assert.deepEqual(detailOf('read', { file_path: '/w/a.js', offset: 10, limit: 5 }, '', undefined), once);
});

test('diff: diffLines numbers hunks like diff -u', () => {
  const a = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
  const b = 'a\nb\nc\nX\ne\nf\ng\nh\ni\nY\n';
  assert.deepEqual(diffLines(a, b, { context: 1 }), [
    { a: 3, b: 3, lines: [' c', '-d', '+X', ' e'] },
    { a: 9, b: 9, lines: [' i', '-j', '+Y'] },
  ]);
  // Close changes share one hunk.
  assert.deepEqual(diffLines(a, b, { context: 3 }).length, 1);
  assert.deepEqual(diffLines('', 'x\ny\n'), [{ a: 0, b: 1, lines: ['+x', '+y'] }]);
  assert.deepEqual(diffLines('x\n', ''), [{ a: 1, b: 0, lines: ['-x'] }]);
  assert.deepEqual(diffLines('same\n', 'same\n'), []);
  // Insertion in the middle keeps the right numbers on both sides.
  assert.deepEqual(diffLines('1\n2\n3\n', '1\n2\nnew\n3\n', { context: 0 }), [{ a: 2, b: 3, lines: ['+new'] }]);
  assert.deepEqual(stats(diffLines(a, b)), { adds: 2, dels: 2 });
  // maxLines caps the lines across hunks.
  assert.equal(diffLines(a, b, { context: 1, maxLines: 5 }).flatMap((h) => h.lines).length, 5);
  // Past 4000 lines it is one replace-all hunk.
  const big = Array.from({ length: 4001 }, (_, i) => `l${i}`).join('\n');
  const huge = diffLines(big, big + '\nmore');
  assert.equal(huge.length, 1);
  assert.deepEqual([huge[0].a, huge[0].b, huge[0].lines.length], [1, 1, 4001 + 4002]);
});

test('diff: hunksFromStructured and parseApplyPatch', () => {
  const sp = [
    { oldStart: 10, oldLines: 2, newStart: 12, newLines: 2, lines: [' keep', '-old', '+new', '\\ No newline at end of file'] },
    { oldStart: 40, oldLines: 1, newStart: 42, newLines: 1, lines: ['-x', '+y'] },
  ];
  assert.deepEqual(hunksFromStructured(sp), [
    { a: 10, b: 12, lines: [' keep', '-old', '+new'] },
    { a: 40, b: 42, lines: ['-x', '+y'] },
  ]);
  assert.deepEqual(hunksFromStructured(sp, 4), [
    { a: 10, b: 12, lines: [' keep', '-old', '+new'] },
    { a: 40, b: 42, lines: ['-x'] },
  ]);
  assert.deepEqual(hunksFromStructured(null), []);
  // Wrapped in a shell heredoc, as older Codex sent it; two @@ sections are two hunks.
  const files = parseApplyPatch("apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: a.js\n@@ one\n-1\n+2\n@@ two\n ctx\n-3\n+4\n*** End of File\n*** Add File: b.js\n+hi\n*** End Patch\nEOF");
  assert.deepEqual(files, [
    { path: 'a.js', op: 'edit', hunks: [{ a: null, b: null, lines: ['-1', '+2'] }, { a: null, b: null, lines: [' ctx', '-3', '+4'] }] },
    { path: 'b.js', op: 'create', hunks: [{ a: null, b: null, lines: ['+hi'] }] },
  ]);
  assert.deepEqual(parseApplyPatch('*** Begin Patch\n*** Update File: c.js\n*** Move to: d.js\n*** End Patch'), [{ path: 'c.js', op: 'move', to: 'd.js', hunks: [] }]);
});
