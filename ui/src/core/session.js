// A session's settings as a person reads them: permission mode, model, effort, context. No DOM.

/** Claude Code's permission modes. `cycle`: reachable with Shift+Tab in a running session. */
export const MODES = [
  { key: 'default', label: '묻고 진행', desc: '처음 쓰는 도구는 매번 물어봐요', icon: 'shield', tone: '', cycle: true },
  { key: 'acceptEdits', label: '수정은 바로', desc: '파일 수정은 묻지 않고 하고, 명령은 물어봐요', icon: 'player-track-next', tone: 'edit', cycle: true },
  { key: 'plan', label: '계획 모드', desc: '코드를 바꾸지 않고 읽기만 해서 계획을 세워요. 승인하면 진행해요', icon: 'player-pause', tone: 'plan', cycle: true },
  { key: 'auto', label: '자동', desc: '안전한 일은 알아서 하고 위험해 보이는 것만 물어봐요', icon: 'refresh', tone: 'auto', cycle: true },
  { key: 'dontAsk', label: '묻지 않기', desc: '묻지 않아요. 허락 규칙에 없는 일은 하지 않아요', icon: 'ban', tone: 'mute', cycle: false },
  { key: 'bypassPermissions', label: '모두 허락', desc: '아무것도 묻지 않고 다 해요. 격리된 환경에서만 쓰세요', icon: 'alert-triangle', tone: 'danger', cycle: false },
];
export const CYCLE = MODES.filter((m) => m.cycle).map((m) => m.key);
export const modeOf = (key) => MODES.find((m) => m.key === key) || MODES[0];
/** The next mode Shift+Tab goes to, the way Claude Code cycles. */
export const nextMode = (key) => CYCLE[(CYCLE.indexOf(key) + 1) % CYCLE.length] || CYCLE[0];

export const EFFORTS = [
  { key: 'low', label: '낮음', desc: '빠르게, 생각은 짧게' },
  { key: 'medium', label: '보통', desc: '가벼운 수정에 알맞아요' },
  { key: 'high', label: '높음', desc: '까다로운 일에 알맞아요' },
  { key: 'xhigh', label: '매우 높음', desc: '어려운 버그와 설계에' },
  { key: 'max', label: '최대', desc: '가장 깊게 생각해요 · 사용량을 많이 써요' },
];
export const effortOf = (key) => EFFORTS.find((e) => e.key === key) || null;

/** The model families the picker offers; the CLI's own picker decides the exact version. */
export const MODELS = [
  { key: 'opus', label: 'Opus', desc: '길고 복잡한 작업에 강해요' },
  { key: 'fable', label: 'Fable', desc: '가장 어려운 일에 · 주간 한도를 따로 써요' },
  { key: 'sonnet', label: 'Sonnet', desc: '빠르고 균형 잡혔어요' },
  { key: 'haiku', label: 'Haiku', desc: '가장 빠르고 가벼워요' },
];

/** "claude-opus-5-5" → "Opus 5.5"; "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelName(id) {
  if (!id) return '';
  const m = String(id).match(/(opus|fable|sonnet|haiku)[-_ ]?(\d+)?(?:[-.](\d+))?/i);
  if (!m) return String(id).replace(/^claude-/, '');
  const fam = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const ver = m[2] ? (m[3] && m[3].length < 3 ? `${m[2]}.${m[3]}` : m[2]) : '';
  return ver ? `${fam} ${ver}` : fam;
}
export const familyOf = (id) => (String(id || '').match(/opus|fable|sonnet|haiku/i)?.[0] || '').toLowerCase();

/** How full the context is, 0–100, or null when unknown (right after a compaction). */
export function ctxPct(ctx) {
  if (!ctx || !ctx.limit || ctx.stale || !ctx.used) return null;
  return Math.min(100, Math.round((ctx.used / ctx.limit) * 100));
}
export const ctxTone = (pct) => (pct == null ? '' : pct >= 90 ? 'max' : pct >= 75 ? 'hi' : '');
export function tokens(n) {
  if (!n) return '0';
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
}
