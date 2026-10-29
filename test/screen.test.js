// What the CLIs show when they wait on a person, read from terminal rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuFromLines, promptTextFromLines, menuActions, planChoices } from '../server/screen.js';

const rows = (s) => s.replace(/^\n/, '').split('\n');

test('Claude Code permission box: question, options, what each button means', () => {
  const m = menuFromLines(
    rows(`
╭──────────────────────────────────────────────────────────╮
│ Bash command                                             │
│                                                          │
│   rm -rf build                                           │
│   Remove build                                           │
│                                                          │
│ Do you want to proceed?                                  │
│ ❯ 1. Yes                                                 │
│   2. Yes, and don't ask again for rm commands in /w/app  │
│   3. No, and tell Claude what to do differently (esc)    │
╰──────────────────────────────────────────────────────────╯
`)
  );
  assert.equal(m.question, 'Do you want to proceed?');
  assert.deepEqual(m.options.map((o) => o.key), ['1', '2', '3']);
  assert.equal(m.options[0].selected, true);
  assert.equal(m.review, false);
  assert.deepEqual(menuActions(m), { yes: '1', always: '2', alwaysLabel: "Yes, and don't ask again for rm commands in /w/app", no: '3' });
});

test('an edit permission without a box, the way newer versions draw it', () => {
  const m = menuFromLines(
    rows(`
────────────────────────────────────────────────────────────
 Edit file
 README.md
 Do you want to make this edit to README.md?
 ❯ 1. Yes
   2. Yes, allow all edits during this session (shift+tab)
   3. No, and tell Claude what to do differently (esc)
`)
  );
  assert.equal(m.question, 'Do you want to make this edit to README.md?');
  assert.deepEqual(menuActions(m), { yes: '1', always: '2', alwaysLabel: 'Yes, allow all edits during this session (shift+tab)', no: '3' });
});

test('AskUserQuestion: tabs above, descriptions under options, free text and a separated last option', () => {
  const m = menuFromLines(
    rows(`
────────────────────────────────────────
←  ☐ 주제  ✔ 범위  ✔ Submit  →

테스트용 계획을 어떤 주제로 세울까요?

  1. 누름 깊이 테스트 (추천)
     키캡·버튼이 누르면 두께만큼 가라앉는지 검증합니다.
  2. v1 tokens.css 제거 준비
     v1 이름을 아직 쓰는 곳을 찾아 목록을 만듭니다.
❯ 3. 카톤 문서 페이지
  4. Type something.
────────────────────────────────────────
  5. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel
`)
  );
  assert.equal(m.question, '테스트용 계획을 어떤 주제로 세울까요?');
  assert.deepEqual(m.tabs, [
    { label: '주제', done: false },
    { label: '범위', done: true },
    { label: 'Submit', done: true },
  ]);
  assert.equal(m.options[0].desc, '키캡·버튼이 누르면 두께만큼 가라앉는지 검증합니다.');
  assert.equal(m.free, '4');
  assert.equal(m.options[2].selected, true);
});

test('multi-select options carry their checkbox state', () => {
  const m = menuFromLines(
    rows(`
←  ✔ 주제  ☐ 범위  ☐ Submit  →

어디까지 바꿀까요? (여러 개 고를 수 있어요)

❯ 1. [✔] 버튼
  2. [ ] 입력창
  3. [✔] 카드
  4. Type something.
  5. Next
`)
  );
  assert.deepEqual(
    m.options.map((o) => [o.label, o.checked]),
    [
      ['버튼', true],
      ['입력창', false],
      ['카드', true],
      ['Type something.', undefined],
      ['Next', undefined],
    ]
  );
});

test('the review step of a question form is recognized', () => {
  const m = menuFromLines(
    rows(`
←  ✔ 주제  ✔ 범위  ☐ Submit  →

Review your answers

 ● 주제 → 누름 깊이 테스트
 ● 범위 → 버튼, 카드

Ready to submit your answers?

❯ 1. Submit answers
  2. Cancel
`)
  );
  assert.equal(m.review, true);
  assert.equal(m.question, 'Ready to submit your answers?');
});

test('plan approval options in the person words; bypass hidden in careful projects', () => {
  const m = menuFromLines(
    rows(`
 Would you like to proceed?

 ❯ 1. Yes, and bypass permissions
   2. Yes, and auto-accept edits
   3. Yes, and manually approve edits
   4. No, keep planning
`)
  );
  assert.deepEqual(
    planChoices(m).map((c) => [c.key, c.ko, c.action]),
    [
      ['1', '승인 · 권한 확인 없이 진행', 'approve'],
      ['2', '승인 · 수정은 자동 허락', 'approve'],
      ['3', '승인 · 수정마다 확인', 'approve'],
      ['4', '계획 더 다듬기', 'keep'],
    ]
  );
  assert.deepEqual(
    planChoices(m, { careful: true }).map((c) => c.key),
    ['2', '3', '4']
  );
});

test("a numbered list in a reply is not a menu once the input prompt is back", () => {
  const lines = rows(`
⏺ 할 일:
  1. 첫째
  2. 둘째

> `);
  assert.equal(menuFromLines(lines), null);
  assert.equal(promptTextFromLines(lines, lines.length - 1), '');
});

test('the text in the input box, across wrapped lines, and none while a menu is up', () => {
  const lines = rows(`
╭────────────────────────────────╮
│ > 이 버그 고쳐줘               │
│   그리고 테스트도              │
╰────────────────────────────────╯
`);
  assert.equal(promptTextFromLines(lines, 2), '이 버그 고쳐줘\n그리고 테스트도');
  assert.equal(promptTextFromLines(lines, 2, true), null);
});
