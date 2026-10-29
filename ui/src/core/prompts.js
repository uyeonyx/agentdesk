// The buttons of a prompt card, in the person's words. The CLI's own label stays in the tooltip;
// labels we don't know are shown as they are.

export function translate(label) {
  const l = String(label || '').trim();
  let m;
  if (/^yes$/i.test(l)) return '허락';
  if (/^no$/i.test(l)) return '거절';
  if ((m = l.match(/^yes,? and don.?t ask again for (.+?) commands? in (.+)$/i))) return `허락 · 이 폴더에서 ${m[1]} 명령은 다시 묻지 않기`;
  if (/allow all edits during this session/i.test(l)) return '이번 세션 동안 수정은 모두 허락';
  if (/^yes,? and don.?t ask again/i.test(l)) return '허락 · 다시 묻지 않기';
  if (/^(yes,? )?always/i.test(l)) return '항상 허락';
  if (/^no,? and tell (claude|codex|the agent) what to do differently/i.test(l)) return '거절하고 다르게 지시하기';
  if (/^no,? keep planning/i.test(l)) return '계획 더 다듬기';
  if (/^type something/i.test(l)) return '직접 입력';
  if (/^chat about this/i.test(l)) return '이 질문에 대해 대화하기';
  if (/^submit answers?/i.test(l)) return '답 제출';
  if (/^cancel$/i.test(l)) return '취소';
  if (/^next$/i.test(l)) return '다음';
  return l;
}

/**
 * Permission card buttons, from what the screen offers right now. `needsText`: pressing it asks
 * what to do instead (sent as a message once the agent's input box is back).
 */
export function permissionButtons(prompt) {
  const a = prompt?.screen?.actions || {};
  const out = [];
  if (a.yes) out.push({ action: 'yes', key: a.yes, label: '허락', primary: true });
  if (a.always) out.push({ action: 'always', key: a.always, label: translate(a.alwaysLabel), raw: a.alwaysLabel });
  if (a.no) out.push({ action: 'no', key: a.no, label: '거절', needsText: true });
  return out;
}

/** A menu read off the screen only (no tool call behind it): its own options, translated. */
export function menuButtons(menu) {
  return (menu?.options || []).map((o, i) => ({ action: 'key', key: o.key, label: translate(o.label), raw: o.label, desc: o.desc, primary: i === 0 && /^(yes|예)/i.test(o.label), quiet: /^(no|아니|cancel)/i.test(o.label) }));
}

/** Is this card's main action safe to take with one press? Careful projects arm first. */
export const affirmative = (action) => ['yes', 'always', 'approve', 'answer', 'key'].includes(action);
