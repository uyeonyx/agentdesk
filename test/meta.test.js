// What a session's transcript and screen say about the session: permission mode, model, context,
// effort, recap. Read for every task, so each one can show it in the overview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { metaOfLine, fold, windowOf, tokensOf, MetaTail } from '../server/meta.js';
import { modeFromLines, effortFromLines, effortSliderFromLines, modelMenuFromLines } from '../server/screen.js';
import { createParser } from '../server/transcript.js';
import { AGENTS } from '../server/agents.js';

const rows = (s) => s.replace(/^\n/, '').split('\n');

test('transcript lines: permission mode, model and context, recap', () => {
  assert.deepEqual(metaOfLine({ type: 'permission-mode', permissionMode: 'plan' }), { mode: 'plan' });
  assert.equal(metaOfLine({ type: 'permission-mode', permissionMode: 'nonsense' }), null);
  const a = metaOfLine({ type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 2, cache_creation_input_tokens: 3000, cache_read_input_tokens: 60000, output_tokens: 900 } } });
  assert.deepEqual(a, { model: 'claude-opus-5-5', ctx: { used: 63002, limit: 200000 } });
  // A synthetic message says nothing about the model.
  assert.equal(metaOfLine({ type: 'assistant', message: { model: '<synthetic>', usage: {} } }), null);
  const r = metaOfLine({ type: 'system', subtype: 'away_summary', timestamp: '2026-11-02T01:00:00Z', content: '테스트가 통과해요. (disable recaps in /config)' });
  assert.equal(r.recap.text, '테스트가 통과해요.');
  // A subagent's own lines aren't the session's.
  assert.equal(metaOfLine({ type: 'assistant', isSidechain: true, message: { model: 'x', usage: { input_tokens: 5 } } }), null);
});

test('context window: 200k, or 1M when the model says so or more is in use', () => {
  assert.equal(windowOf('claude-opus-5-5'), 200000);
  assert.equal(windowOf('claude-opus-5-5[1m]'), 1000000);
  assert.equal(windowOf('claude-opus-5-5', 691000), 1000000);
  assert.equal(tokensOf({ input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 }), 6);
});

test('folding: later lines win, a compaction clears the count, an older recap never replaces a newer one', () => {
  let m = {};
  m = fold(m, { mode: 'acceptEdits' });
  m = fold(m, { model: 'claude-opus-5-5', ctx: { used: 150000, limit: 200000 } });
  m = fold(m, { mode: 'plan' });
  m = fold(m, { recap: { text: 'new', at: 20 } });
  m = fold(m, { recap: { text: 'old', at: 10 } });
  assert.equal(m.mode, 'plan');
  assert.equal(m.recap.text, 'new');
  m = fold(m, { compacted: 30 });
  assert.equal(m.ctx.used, 0);
  assert.equal(m.ctx.stale, true);
});

test('MetaTail follows a growing transcript and reports changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-meta-'));
  const file = path.join(dir, 's.jsonl');
  const line = (o) => JSON.stringify(o) + '\n';
  fs.writeFileSync(file, line({ type: 'permission-mode', permissionMode: 'acceptEdits' }) + line({ type: 'user', message: { content: 'hi' } }));
  const task = { agent: 'claude', transcriptPath: file };
  const tail = new MetaTail(task);
  assert.equal(tail.poll(), true);
  assert.equal(task.mode, 'acceptEdits');
  assert.equal(tail.poll(), false);
  // Half a line first, then the rest: nothing is read from a fragment.
  const next = line({ type: 'assistant', message: { model: 'claude-haiku-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 990 } } });
  fs.appendFileSync(file, next.slice(0, 20));
  assert.equal(tail.poll(), false);
  fs.appendFileSync(file, next.slice(20) + line({ type: 'system', subtype: 'away_summary', timestamp: '2026-11-02T02:00:00Z', content: '끝났어요' }));
  assert.equal(tail.poll(), true);
  assert.deepEqual(task.ctx, { used: 1000, limit: 200000 });
  assert.equal(task.model, 'claude-haiku-5-5');
  assert.equal(task.recap.text, '끝났어요');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('screen: the mode line under the input box, and nothing when a menu covers it', () => {
  assert.equal(modeFromLines(rows('❯ \n────\n  ⏵⏵ accept edits on (shift+tab to cycle) · ← 1 agent')), 'acceptEdits');
  assert.equal(modeFromLines(rows('❯ \n────\n  ⏸ plan mode on (shift+tab to cycle)')), 'plan');
  assert.equal(modeFromLines(rows('❯ \n────\n  ⏵⏵ auto mode on (shift+tab to cycle)')), 'auto');
  assert.equal(modeFromLines(rows('❯ \n────\n  ? for shortcuts')), 'default');
  assert.equal(modeFromLines(rows(' Do you want to proceed?\n ❯ 1. Yes\n   2. No')), null);
  // A mode quoted far up in the conversation isn't the mode.
  assert.equal(modeFromLines(rows('I turned plan mode on earlier\n\n\n\n\n\n\n\n❯ \n  ? for shortcuts')), 'default');
});

test('screen: effort in the status line and on the /effort slider; the /model picker rows', () => {
  assert.equal(effortFromLines(['', '   ◐ medium · /effort ▔']), 'medium');
  assert.equal(effortFromLines(['nothing here']), '');
  const slider = rows(`
   Effort
                                       Faster                             Smarter
                                       ──────────────────────▲───────────────────      Ultracode  off
                                       low     medium     high     xhigh      max      Tab to toggle
   ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel`);
  assert.equal(effortSliderFromLines(slider), 'high');
  const picker = modelMenuFromLines(
    rows(`
   Select model
     1.  Default (recommended)  Opus 5.5 · Best for everyday, complex tasks
     2.  Opus 5.5               For complex work and everyday tasks
     3.  Fable 5.1              For your toughest challenges
     4.  Sonnet 5.5             Most efficient for simpler tasks
   ❯ 5.  Haiku 5.5 ✔            Fastest for quick answers
   Enter to set as default · s to use this session only · Esc to cancel`)
  );
  assert.deepEqual(picker.map((r) => r.label), ['Default (recommended)', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 5.5']);
  assert.equal(picker.findIndex((r) => r.cursor), 4);
  assert.equal(picker[4].current, true);
  // Without the "session only" line it isn't the picker we know how to drive.
  assert.equal(modelMenuFromLines(rows('  1. Yes\n  2. No')), null);
});

test('launch flags: mode, model and effort go on the command line, never as slash commands', () => {
  const args = AGENTS.claude.args({ prompt: 'hi', newSessionId: 'abc', mode: 'plan', model: 'sonnet', effort: 'high' });
  assert.ok(args.includes('--permission-mode=plan'));
  assert.ok(args.includes('--model=sonnet'));
  assert.ok(args.includes('--effort=high'));
  const bad = AGENTS.claude.args({ prompt: 'hi', mode: 'yolo', model: '--dangerously-skip-permissions', effort: 'huge' });
  assert.ok(!bad.some((a) => /permission-mode|--model|--effort|dangerously/.test(a)));
});

test('conversation: a recap and what a slash command printed become their own entries', () => {
  const p = createParser({ agent: 'claude' });
  let n = 0;
  const L = (o) => p.line({ uuid: `u${n++}`, timestamp: '2026-11-02T00:00:00Z', ...o }, { seg: 0, off: n * 100, len: 10 });
  const [recap] = L({ type: 'system', subtype: 'away_summary', content: 'README를 고쳤어요. (disable recaps in /config)' });
  assert.equal(recap.e.kind, 'recap');
  assert.equal(recap.e.text, 'README를 고쳤어요.');
  L({ type: 'system', subtype: 'local_command', content: '<command-name>/context</command-name>\n<command-args></command-args>' });
  const [out] = L({ type: 'system', subtype: 'local_command', content: '<local-command-stdout>\u001b[1mContext\u001b[22m 68k/200k</local-command-stdout>' });
  assert.equal(out.e.kind, 'cmdout');
  assert.equal(out.e.cmd, '/context');
  assert.equal(out.e.text, 'Context 68k/200k');
});

test('activity strip: the last half hour of tool calls and state changes, in seconds', async () => {
  const { stripView } = await import('../server/tasks.js');
  const now = Date.parse('2026-11-02T10:45:30Z');
  const t = {
    activity: {
      feed: [
        { at: now - 40 * 60_000, kind: 'read', st: 'ok', ms: 2000 }, // too old
        { at: now - 10 * 60_000, kind: 'edit', st: 'ok', ms: 4000 },
        { at: now - 5 * 60_000, kind: 'cmd', st: 'err', ms: 9000 },
        { at: now - 3000, kind: 'cmd', st: 'run' },
        { at: now - 2000, kind: 'read', st: 'ok', by: 'sub1' }, // a subagent's own call
      ],
    },
    states: [[now - 50 * 60_000, 'working', 0], [now - 12 * 60_000, 'needs_input', 1], [now - 11 * 60_000, 'working', 0]],
  };
  const v = stripView(t, now);
  assert.equal(v.from, Date.parse('2026-11-02T10:15:00Z'));
  assert.deepEqual(v.c.map((x) => x.slice(2)), [['e', 'o'], ['c', 'e'], ['c', 'r']]);
  assert.equal(v.c[2][1], 0);
  // The state the window opens in, then what changed.
  assert.deepEqual(v.s.map((x) => x.slice(1)), [['working', 0], ['needs_input', 1], ['working', 0]]);
  assert.equal(v.s[0][0], 0);
});
