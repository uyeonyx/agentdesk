// Rewind and fork: reading Claude Code 2.1's /rewind screens (captured from the real CLI), and
// finding a message in a transcript to cut a fork's history at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rewindCursorFromLines, rewindChoicesFromLines, sameMessage } from '../server/screen.js';
import { userLineOf } from '../server/tasks.js';

const LIST = [
  '❯ Reply with exactly: TWO',
  '⏺ TWO',
  '▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
  '   Rewind',
  '   Restore the code and/or conversation to the point before…',
  '   ❯ Use the Write tool to create a.txt containing the word hello. Do nothing else, no explanation.',
  '     a.txt +1',
  '     Reply with exactly: TWO',
  '     ⚠ No code restore',
  '     (current)',
  '   Enter to continue · Esc to cancel',
];
const CONFIRM = [
  '   Rewind',
  '   Confirm you want to restore to the point before you sent this message:',
  '   │ Use the Write tool to create a.txt containing the word hello.',
  '   │ (6s ago)',
  '   This message and everything after it will be removed.',
  '   The code will be restored -1 in a.txt.',
  '   ❯ 1. Restore code and conversation',
  '     2. Restore conversation',
  '     3. Restore code',
  '     4. Summarize from here',
  '   ↓ 5. Summarize up to here',
];

test('rewind list: the message under the cursor, "(current)", or not on screen', () => {
  assert.equal(rewindCursorFromLines(LIST), 'Use the Write tool to create a.txt containing the word hello. Do nothing else, no explanation.');
  const atBottom = LIST.map((l) => l.replace('   ❯ Use', '     Use').replace('     (current)', '   ❯ (current)'));
  assert.equal(rewindCursorFromLines(atBottom), '(current)');
  // The prompt's own "❯" above the list isn't the cursor; no list at all is null.
  assert.equal(rewindCursorFromLines(['❯ Reply with exactly: TWO', '⏺ TWO', '❯ ']), null);
  // The command list's description line mentions the same words but isn't the list.
  assert.equal(rewindCursorFromLines(['  ❯ /rewind     Restore the code and/or conversation to a previous point', '❯ /rewind']), null);
});

test('rewind confirm: which digit restores what', () => {
  const c = rewindChoicesFromLines(CONFIRM);
  assert.equal(c['restore code and conversation'], '1');
  assert.equal(c['restore conversation'], '2');
  assert.equal(c['restore code'], '3');
  assert.equal(c['summarize up to here'], '5');
  // Without code changes the CLI offers fewer: "Restore conversation" comes first.
  const plain = rewindChoicesFromLines(['Confirm you want to restore to the point before you sent this message:', '   ❯ 1. Restore conversation', '     2. Summarize from here', '     4. Never mind']);
  assert.equal(plain['restore conversation'], '1');
  assert.equal(plain['restore code and conversation'], undefined);
  assert.equal(rewindChoicesFromLines(LIST), null);
});

test('rewind: a shown line matches the message it was cut from, not another', () => {
  assert.ok(sameMessage('Use the Write tool to create a.txt…', 'Use the Write tool to create a.txt containing the word hello.'));
  assert.ok(sameMessage('결제 페이지 테스트', '결제 페이지 테스트\n두 번째 줄'));
  assert.ok(!sameMessage('Reply with exactly: TWO', 'Reply with exactly: THREE'));
  assert.ok(!sameMessage('(current)', 'anything'));
  assert.ok(!sameMessage('', 'x'));
});

test('fork: the transcript line where a message starts, by its words and time', () => {
  const at = Date.parse('2026-11-02T08:00:00Z');
  const L = (o) => JSON.stringify(o);
  const lines = [
    L({ type: 'permission-mode', permissionMode: 'default' }),
    L({ type: 'user', timestamp: '2026-11-02T07:00:00Z', message: { role: 'user', content: 'same words' } }),
    L({ type: 'assistant', timestamp: '2026-11-02T07:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }),
    L({ type: 'user', timestamp: '2026-11-02T07:59:59Z', isMeta: true, message: { role: 'user', content: 'same words' } }),
    L({ type: 'user', timestamp: '2026-11-02T08:00:01Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'same words' }] } }),
    L({ type: 'user', timestamp: '2026-11-02T08:00:02Z', message: { role: 'user', content: [{ type: 'text', text: 'same words' }] } }),
  ];
  // The earlier same-worded message, the meta line and the tool result are skipped.
  assert.equal(userLineOf(lines, { text: 'same words', at }), 5);
  assert.equal(userLineOf(lines, { text: 'other', at }), -1);
  // Sent long ago (a restored session): the latest match before.
  assert.equal(userLineOf(lines.slice(0, 3), { text: 'same words', at }), 1);
});

test('fork: Claude starts from the cut copy with its own id fixed up front', async () => {
  const { AGENTS } = await import('../server/agents.js');
  const a = AGENTS.claude.args({ resume: true, fork: true, sessionId: '11111111-1111-4111-8111-111111111111', newSessionId: '22222222-2222-4222-8222-222222222222' });
  assert.ok(a.includes('--resume=11111111-1111-4111-8111-111111111111'));
  assert.ok(a.includes('--fork-session'));
  assert.ok(a.includes('--session-id=22222222-2222-4222-8222-222222222222'));
  // A plain resume never names a new id.
  const r = AGENTS.claude.args({ resume: true, sessionId: '11111111-1111-4111-8111-111111111111' });
  assert.ok(!r.some((x) => x.startsWith('--session-id')));
});

test('fork: a rewound part stays out of the copy, and the chain is hooked back together', async () => {
  const { withoutCuts } = await import('../server/tasks.js');
  const t = (s) => `2026-11-03T01:00:${String(s).padStart(2, '0')}Z`;
  const L = (o) => JSON.stringify(o);
  const lines = [
    L({ type: 'permission-mode', permissionMode: 'acceptEdits' }),
    L({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: t(1), message: { content: 'one' } }),
    L({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: t(2) }),
    L({ type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: t(10), message: { content: 'two' } }),
    L({ type: 'file-history-snapshot', messageId: 'x' }),
    L({ type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: t(12) }),
    // Sent after the rewind: Claude Code still hangs it on the rewound turn.
    L({ type: 'user', uuid: 'u3', parentUuid: 'a2', timestamp: t(40), message: { content: 'three' } }),
    L({ type: 'assistant', uuid: 'a3', parentUuid: 'u3', timestamp: t(41) }),
  ];
  const cut = { from: Date.parse(t(9)), to: Date.parse(t(20)), fromUuid: 'u2' };
  const out = withoutCuts(lines, [cut]).map((l) => JSON.parse(l));
  assert.deepEqual(out.map((e) => e.uuid || e.type), ['permission-mode', 'u1', 'a1', 'u3', 'a3']);
  assert.equal(out.find((e) => e.uuid === 'u3').parentUuid, 'a1');
  // By time alone (no line found at the rewind) it comes out the same.
  assert.deepEqual(withoutCuts(lines, [{ from: cut.from, to: cut.to }]).map((l) => JSON.parse(l).uuid || 'meta'), ['meta', 'u1', 'a1', 'u3', 'a3']);
  assert.equal(withoutCuts(lines, []), lines);
});
