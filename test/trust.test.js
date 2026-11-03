// Desk says yes to Claude Code's "trust this folder?" only for its own folders, and only once "Yes" is
// the highlighted option (the screen starts on "No, exit").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sayTrust } from '../server/trust.js';

// The trust screen as Claude Code 2.1.317 draws it, with the cursor moving on ↓.
function fakeScreen({ steps = 1 } = {}) {
  let at = 0;
  const typed = [];
  const lines = async () => [
    ' Accessing workspace:',
    ' Quick safety check: Is this a project you created or one you trust?',
    `${at === 0 ? ' ❯ ' : '   '}No, exit`,
    `${at === steps ? ' ❯ ' : '   '}Yes, I trust this folder`,
    ' Enter to confirm · Esc to cancel',
  ];
  const write = (k) => {
    typed.push(k);
    if (k === '\x1b[B') at = Math.min(steps, at + 1);
  };
  return { lines, write, typed };
}

test('trust: moves to "Yes", then Enter; never Enter on "No, exit"', async () => {
  const s = fakeScreen();
  assert.equal(await sayTrust(s.lines, s.write), true);
  assert.deepEqual(s.typed, ['\x1b[B', '\r']);
});

test('trust: no trust screen, nothing typed; a cursor that never reaches "Yes", no Enter', async () => {
  const none = { typed: [], lines: async () => ['> ', '  ? for shortcuts'], write(k) { this.typed.push(k); } };
  assert.equal(await sayTrust(none.lines, (k) => none.write(k)), false);
  assert.deepEqual(none.typed, []);
  const stuck = fakeScreen({ steps: 9 });
  assert.equal(await sayTrust(stuck.lines, stuck.write), false);
  assert.ok(!stuck.typed.includes('\r'));
});
