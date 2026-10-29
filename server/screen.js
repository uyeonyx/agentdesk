// Reading what an agent's CLI shows right now, from the rows of its headless terminal. Pure: the
// rows come in as strings, so every screen we support can be pinned down in a test.

const OPT = /^\s*[│┃|]?\s*(❯|>|›)?\s*(\d{1,2})[.)]\s+(.+?)\s*[│┃|]?\s*$/;
const PROMPT = /^\s*[│┃|]?\s*[>›❯](\s|$)/;
const RULE = /^[─━═\s]+$/;
const strip = (l) => l.replace(/^\s*[│┃|╭╰─]+/, '').replace(/[│┃|╮╯─]+\s*$/, '').trim();
// Multi-select options carry a checkbox in front of the label.
const BOX = /^(?:\[([ xX✓✔●■])\]|([☐☑☒◯◉○●□■]))\s+/;
const CHECKED = /[xX✓✔●■☑☒◉]/;

/**
 * A numbered choice menu: permission prompts, plan approval, and AskUserQuestion forms where each
 * option has description lines under it and the last ones sit below a separator.
 * Returns { question, options:[{key,label,desc,selected,checked?}], tabs?, review, free? } or null.
 */
export function menuFromLines(lines) {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  // The bottom-most option, then upwards through 1: each step must be exactly one lower,
  // with at most a few description / separator lines in between.
  let y = end - 1;
  let last = -1;
  for (; y >= Math.max(0, end - 40); y--) {
    if (OPT.test(lines[y])) {
      last = y;
      break;
    }
  }
  if (last < 0) return null;
  // An input prompt below the options means the menu was already answered.
  for (let k = last + 1; k < end; k++) if (PROMPT.test(lines[k]) && !OPT.test(lines[k])) return null;
  const opts = [];
  let want = Number(lines[last].match(OPT)[2]);
  let gap = 0;
  let desc = [];
  let firstIdx = last;
  for (y = last; y >= Math.max(0, end - 60) && want >= 1; y--) {
    const m = lines[y].match(OPT);
    if (m && Number(m[2]) === want) {
      opts.unshift(option(m, desc.reverse().join(' ')));
      firstIdx = y;
      want--;
      gap = 0;
      desc = [];
    } else {
      if (m || ++gap > 6) break;
      const t = strip(lines[y]);
      if (t && !RULE.test(t)) desc.push(t);
    }
  }
  if (want !== 0 || opts.length < 2 || opts.length > 9) return null;
  let question = '';
  let qAt = -1;
  for (let k = firstIdx - 1; k >= 0 && k >= firstIdx - 6; k--) {
    const t = strip(lines[k]);
    if (t && !RULE.test(t) && !TABS.test(t)) {
      question = t.slice(0, 160);
      qAt = k;
      break;
    }
  }
  const menu = { question, options: opts, review: opts.some((o) => /^submit/i.test(o.label)) };
  const tabs = tabsAbove(lines, qAt >= 0 ? qAt : firstIdx);
  if (tabs) menu.tabs = tabs;
  const free = opts.find((o) => /^type something/i.test(o.label));
  if (free) menu.free = free.key;
  return menu;
}

function option(m, desc) {
  let label = m[3].trim();
  const o = { key: m[2], label: '', desc: desc.slice(0, 160), selected: !!m[1] };
  const box = label.match(BOX);
  if (box) {
    o.checked = CHECKED.test(box[1] ?? box[2]);
    label = label.slice(box[0].length);
  }
  o.label = label.slice(0, 90);
  return o;
}

// AskUserQuestion with several questions: "←  ☐ 주제  ✔ 범위  ✔ Submit  →" above the question.
const TABS = /^←\s+(.+?)\s+→$/;

function tabsAbove(lines, from) {
  for (let k = from - 1; k >= 0 && k >= from - 6; k--) {
    const m = strip(lines[k]).match(TABS);
    if (!m) continue;
    return m[1]
      .split(/\s{2,}/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const mark = s.match(/^([☐☑☒✔✓■□])\s*/);
        return { label: mark ? s.slice(mark[0].length) : s, done: !!mark && /[☑☒✔✓■]/.test(mark[1]) };
      });
  }
  return null;
}

/**
 * The text in the agent's input box, if the cursor is in one: Claude Code's "> " / "│ > " box and
 * Codex's "› ". `lines` should have dim placeholder text blanked out. null when there is no input
 * box under the cursor (or a menu is up: Enter there picks an option, it's never a message).
 */
export function promptTextFromLines(lines, cursorY, hasMenu = false) {
  if (hasMenu) return null;
  const cy = cursorY;
  const border = (l) => /^[\s╭╮╰╯┌┐└┘─━═]*$/.test(l) && /[─━═]/.test(l);
  const unbox = (l) => l.replace(/^\s*[│┃|]\s?/, '').replace(/\s*[│┃|]\s*$/, '');
  let top = cy;
  while (top > 0 && cy - top < 12 && !border(lines[top - 1]) && lines[top - 1].trim() && !/^\s*[>›❯]/.test(unbox(lines[top]))) top--;
  const first = unbox(lines[top] || '');
  const m = first.match(/^\s*([>›❯])\s?(.*)$/);
  if (!m || /^\d[.)]\s/.test(m[2])) return null;
  const body = [m[2]];
  for (let y = top + 1; y <= Math.min(lines.length - 1, cy + 12); y++) {
    if (border(lines[y]) || (!lines[y].trim() && y > cy)) break;
    body.push(unbox(lines[y]).replace(/^\s{0,2}/, ''));
  }
  return body.join('\n').replace(/\s+$/g, '').trim();
}

/**
 * What each button of a prompt card means on this screen, matched by label (never by position:
 * the CLIs reorder and reword their menus between versions).
 */
export function menuActions(menu) {
  if (!menu) return null;
  const ALWAYS = /(don.?t ask|always|allow all|this session|for the session)/i;
  const always = menu.options.find((o) => ALWAYS.test(o.label) && !/^(no|아니)/i.test(o.label));
  const yes = menu.options.find((o) => o !== always && /^(yes|예|허용|allow|approve|proceed|run)\b/i.test(o.label));
  const no = menu.options.find((o) => /^(no|아니|deny|reject|cancel)\b/i.test(o.label));
  const out = {};
  if (yes) out.yes = yes.key;
  if (always) {
    out.always = always.key;
    out.alwaysLabel = always.label;
  }
  if (no) out.no = no.key;
  return out;
}

/** Plan approval (ExitPlanMode) options, in the person's words. */
export function planChoices(menu, { careful = false } = {}) {
  if (!menu) return [];
  const out = [];
  for (const o of menu.options) {
    const l = o.label;
    let action = '';
    let ko = '';
    if (/bypass/i.test(l)) {
      if (careful) continue;
      action = 'approve';
      ko = '승인 · 권한 확인 없이 진행';
    } else if (/auto.?accept|accept edits|allow all edits/i.test(l)) {
      action = 'approve';
      ko = '승인 · 수정은 자동 허락';
    } else if (/manual/i.test(l)) {
      action = 'approve';
      ko = '승인 · 수정마다 확인';
    } else if (/^yes/i.test(l)) {
      action = 'approve';
      ko = '승인';
    } else if (/keep planning|^no\b|tell claude|what to change/i.test(l)) {
      action = 'keep';
      ko = '계획 더 다듬기';
    } else continue;
    out.push({ key: o.key, label: l, ko, action });
  }
  return out;
}
