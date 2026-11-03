// Answering a menu whose highlight sits in a text box option. Claude Code 2.1.317's plan approval has
// "Tell Claude what to change" as a box, AskUserQuestion has "Type something.": a digit pressed there
// is typed into the box and answers nothing (seen live: the same card came back every 12 seconds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drive } from '../server/answer.js';
import { menuFromLines } from '../server/screen.js';

/** A Claude Code select menu: ↑/↓ move the highlight, Enter or a digit picks, the box takes text. */
function cli({ question, options, boxAt, hint = false, at = 0, typed = '' }) {
  const s = { at, typed, picked: null };
  const draw = () => {
    if (s.picked) return ['⏺ done', '❯ '];
    const out = [question];
    options.forEach((o, i) => {
      const label = i === boxAt && s.typed ? s.typed : o;
      out.push(`${i === s.at ? '❯ ' : '  '}${i + 1}. ${label}`);
      if (hint && i === boxAt) out.push('     shift+tab to approve with this feedback');
    });
    out.push('Enter to select · ↑/↓ to navigate · Esc to cancel');
    return out;
  };
  const io = {
    menu: () => menuFromLines(draw()),
    promptText: () => (s.picked ? '' : null),
    flush: async () => {},
    key: (k) => {
      if (k === '\x1b[A') s.at = Math.max(0, s.at - 1);
      else if (k === '\x1b[B') s.at = Math.min(options.length - 1, s.at + 1);
      else if (k === '\r') s.picked = options[s.at];
      else if (s.at === boxAt && /^\x7f+$/.test(k)) s.typed = s.typed.slice(0, Math.max(0, s.typed.length - k.length));
      else if (s.at === boxAt) s.typed += k; // in the box, anything is text
      else if (/^\d$/.test(k)) {
        const i = Number(k) - 1;
        if (i === boxAt) s.at = i;
        else s.picked = options[i];
      }
    },
  };
  return { s, io };
}

const PLAN = { question: 'Claude has written up a plan and is ready to execute. Would you like to proceed?', options: ['Yes, and use auto mode', 'Yes, manually approve edits', 'Tell Claude what to change'], boxAt: 2, hint: true };

test('menu: the text box option is known by its label, and by its hint once something is typed in it', () => {
  assert.equal(menuFromLines([PLAN.question, '  1. Yes, and use auto mode', '  2. Yes, manually approve edits', '❯ 3. Tell Claude what to change', '     shift+tab to approve with this feedback']).input, '3');
  assert.equal(menuFromLines([PLAN.question, '  1. Yes, and use auto mode', '  2. Yes, manually approve edits', '❯ 3. 1111', '     shift+tab to approve with this feedback']).input, '3');
  assert.equal(menuFromLines(['Do you want to proceed?', '❯ 1. Yes', '  2. No']).input, undefined);
});

test('plan: approving from the box clears stray digits, moves up with the arrows and presses Enter', async () => {
  const { s, io } = cli({ ...PLAN, at: 2, typed: '1' });
  const r = await drive(io, { kind: 'plan' }, { action: 'approve', option: '1' });
  assert.deepEqual(r.steps, ['\x7f\x7f\x7f', '\x1b[A', '\x1b[A', '\r']);
  assert.equal(s.picked, 'Yes, and use auto mode');
  assert.equal(s.typed, '', 'the stray "1" is not sent along with the approval');
});

test('plan: words typed into the box stay there (Claude Code sends them with the approval)', async () => {
  const { s, io } = cli({ ...PLAN, at: 2, typed: '참고로 스피커폰으로 할 계획이야' });
  await drive(io, { kind: 'plan' }, { action: 'approve', option: '1' });
  assert.equal(s.picked, 'Yes, and use auto mode');
  assert.equal(s.typed, '참고로 스피커폰으로 할 계획이야');
});

test('plan: with the highlight on an option, the digit still picks it (as before)', async () => {
  const { s, io } = cli({ ...PLAN });
  const r = await drive(io, { kind: 'plan' }, { action: 'approve', option: '2' });
  assert.deepEqual(r.steps, ['2']);
  assert.equal(s.picked, 'Yes, manually approve edits');
});

test('permission read off the same screen: "yes" from the box is not typed into it', async () => {
  const { s, io } = cli({ ...PLAN, at: 2, typed: '11' });
  await drive(io, { kind: 'permission' }, { action: 'yes' });
  assert.equal(s.picked, 'Yes, and use auto mode');
  assert.equal(s.typed, '');
});

test('question: a pick made while the highlight is in "Type something." with text in it', async () => {
  const { s, io } = cli({ question: '좋아하는 색은?', options: ['빨강', '파랑', 'Type something.', 'Chat about this'], boxAt: 2, at: 2, typed: 'abc' });
  await drive(io, { kind: 'question', questions: [{ question: '좋아하는 색은?', options: [{ label: '빨강' }, { label: '파랑' }] }] }, { action: 'answer', answers: [{ pick: ['파랑'] }] });
  assert.equal(s.picked, '파랑');
});
