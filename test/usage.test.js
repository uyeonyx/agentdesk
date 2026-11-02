// Plan usage, read from Claude Code 2.1's /usage screen (lines captured from the real CLI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { usageFromLines, resetText, labelOf } from '../server/usage.js';

const SCREEN = [
  '  Settings  Status   Config   Usage   Stats',
  '  Session',
  '  Total cost:            $0.0000',
  '  Usage:                 0 input, 0 output, 0 cache read, 0 cache write',
  '  Current week (all models)',
  '  ██████████████▍                                    29% used',
  '  Resets Nov 3 at 11:59pm (Asia/Seoul)',
  '  Current week (Fable)',
  '                                                     0% used',
  '  Resets Nov 4 at 12am (Asia/Seoul)',
  "  What's contributing to your usage?",
  '  94%  Start fresh when you switch tasks · run /clear',
  '  Usage credits',
  '                                                      0% used',
  '  $0.00 / $32.00 spent · Resets Dec 1 (Asia/Seoul)',
  '  Esc to cancel',
];

test('usage: every limit on the screen, with its reset; tips with a percent are not limits', () => {
  const rows = usageFromLines(SCREEN);
  assert.deepEqual(
    rows.map((r) => [r.key, r.label, r.pct, r.resets]),
    [
      ['current-week-all-models', '이번 주 · 모든 모델', 29, '11월 3일 23:59'],
      ['current-week-fable', '이번 주 · Fable', 0, '11월 4일 0시'],
      ['usage-credits', '추가 크레딧', 0, '12월 1일'],
    ]
  );
  assert.equal(rows[2].spent, '$0.00 / $32.00');
  assert.equal(usageFromLines(['  Loading…']), null);
});

test('usage: the 5-hour limit when the plan has one, and reset times in Korean', () => {
  const rows = usageFromLines(['  Current session', '  ███                     6% used', '  Resets 3:59pm (Asia/Seoul)']);
  assert.equal(rows[0].label, '5시간 한도');
  assert.equal(rows[0].resets, '15:59');
  assert.equal(resetText('Resets 9am (Asia/Seoul)'), '9시');
  assert.equal(resetText('Resets Nov 6 at 9am'), '11월 6일 9시');
  assert.equal(resetText('Resets in 2 hours'), 'in 2 hours');
  assert.equal(labelOf('Current week (Sonnet only)'), '이번 주 · Sonnet only');
});
