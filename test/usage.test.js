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

// ---------------------------------------------------------------- the structured report and live limits
import { usageFromReport, withLive, resetAt, Usage } from '../server/usage.js';

// What `claude -p /usage --output-format stream-json` carried on a Max account without a 5-hour window.
const REPORT = {
  rate_limits: {
    limits: [
      { kind: 'weekly_all', group: 'weekly', percent: 33, resets_at: '2026-11-03T15:00:00.987028+00:00', scope: null, severity: 'normal', is_active: true },
      { kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: '2026-11-03T15:00:00+00:00', scope: { model: { display_name: 'Fable' }, surface: null }, severity: 'normal', is_active: false },
    ],
    extra_usage: { is_enabled: true, monthly_limit: 3200, used_credits: 0, utilization: null, currency: 'USD' },
  },
};

test('usage: the structured report gives each limit the plan has, per-model weeks and credits', () => {
  const rows = usageFromReport(REPORT);
  assert.deepEqual(
    rows.map((r) => [r.key, r.label, r.pct]),
    [
      ['current-week-all-models', '이번 주 · 모든 모델', 33],
      ['current-week-fable', '이번 주 · Fable', 0],
      ['usage-credits', '추가 크레딧', 0],
    ]
  );
  assert.equal(rows[2].spent, '$0.00 / $32.00');
  // No 5-hour row when the plan has no 5-hour window: nothing is made up.
  assert.ok(!rows.some((r) => r.key === 'current-session'));
  const five = usageFromReport({ rate_limits: { limits: [{ kind: 'session', group: 'session', percent: 6.4, resets_at: null }] } });
  assert.deepEqual(five, [{ key: 'current-session', label: '5시간 한도', pct: 6, resets: '' }]);
  assert.equal(usageFromReport({}), null);
});

test('usage: reset times read the way people say them', () => {
  const now = new Date(2026, 10, 3, 14, 0).getTime();
  assert.equal(resetAt(new Date(2026, 10, 3, 15, 59).toISOString(), now), '15:59');
  assert.equal(resetAt(new Date(2026, 10, 4, 0, 0).getTime() / 1000, now), '11월 4일 0시');
  assert.equal(resetAt(new Date(2026, 10, 6, 9, 30).toISOString(), now), '11월 6일 9:30');
  assert.equal(resetAt('nope', now), '');
});

test('usage: a session\'s status line moves the 5-hour and weekly numbers, the rest stays', () => {
  const base = usageFromReport(REPORT);
  const now = Math.floor(Date.now() / 1000);
  const rows = withLive(base, { five_hour: { used_percentage: 12.6, resets_at: now + 3600 }, seven_day: { used_percentage: 35, resets_at: now + 86400 } });
  assert.deepEqual(rows.map((r) => [r.key, r.pct]), [['current-session', 13], ['current-week-all-models', 35], ['current-week-fable', 0], ['usage-credits', 0]]);
  // Live numbers alone (no report yet) still make rows.
  assert.deepEqual(withLive(null, { seven_day: { used_percentage: 40 } }).map((r) => r.key), ['current-week-all-models']);
  let changes = 0;
  const u = new Usage(() => changes++);
  u.fromStatus({ seven_day: { used_percentage: 40, resets_at: now + 10 } });
  u.fromStatus({ seven_day: { used_percentage: 40, resets_at: now + 10 } });
  u.fromStatus(null);
  assert.equal(changes, 1, 'the same numbers again are not a change');
  assert.equal(u.view().claude.rows[0].pct, 40);
});
