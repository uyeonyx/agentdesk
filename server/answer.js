// Answering what an agent waits on from a button: hooks can't answer prompts, so every answer is
// keystrokes into the CLI. Each key is checked against the screen before the next one goes out;
// when the screen isn't what we expect, we stop and send the person to the terminal instead of
// pressing keys blind.

const POLL = 80;
const norm = (s) =>
  String(s || '')
    .replace(/\s*\((추천|recommended)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
// Labels on screen are cut at 90 characters; the question may be cut too.
const same = (screen, full) => {
  const a = norm(screen);
  const b = norm(full);
  return !!a && !!b && (a === b || b.startsWith(a.replace(/…$/, '')) || a.startsWith(b));
};

export class Fallback extends Error {
  constructor(message, step = '') {
    super(message);
    this.step = step;
  }
}

/**
 * @param io {{ menu():object|null, promptText():string|null, flush():Promise, key(s:string):void }}
 * @param prompt the task's prompt (see prompt.js)
 * @param body {{ action, option?, key?, text?, answers? }}
 * @returns {Promise<{steps:string[], thenSend?:string, reasonPending?:boolean}>}
 */
export async function drive(io, prompt, body) {
  const steps = [];
  const press = (k) => {
    io.key(k);
    steps.push(k);
  };
  // Resolves with { m } once pred holds (m may be null: the menu is gone), or undefined on timeout.
  const waitMenu = async (pred, ms) => {
    const until = Date.now() + ms;
    for (;;) {
      await io.flush();
      const m = io.menu();
      if (pred(m)) return { m };
      if (Date.now() > until) return undefined;
      await new Promise((r) => setTimeout(r, POLL));
    }
  };
  const gone = (before) => (m) => !m || m.question !== before.question || m.options.map((o) => o.label).join('|') !== before.options.map((o) => o.label).join('|');
  const waitInput = async (ms) => {
    const until = Date.now() + ms;
    for (;;) {
      await io.flush();
      if (io.promptText() !== null) return true;
      if (Date.now() > until) return false;
      await new Promise((r) => setTimeout(r, POLL));
    }
  };

  // PermissionRequest can arrive before the menu is drawn.
  const first = (await waitMenu((m) => !!m, 2000))?.m;
  if (!first) throw new Fallback('화면에 선택지가 없어요 · 터미널에서 직접 답해 주세요', 'menu');

  if (body.action === 'key') {
    const k = String(body.key || body.option || '');
    if (!first.options.some((o) => o.key === k)) throw new Fallback('선택지가 화면에서 사라졌어요', 'key');
    press(k);
    return { steps };
  }

  if (prompt.kind === 'plan') {
    const k = String(body.option || '');
    const o = first.options.find((x) => x.key === k);
    if (!o) throw new Fallback('계획 승인 선택지가 화면과 달라요 · 터미널에서 직접 답해 주세요', 'plan');
    press(k);
    if (!(await waitMenu(gone(first), 3000))) throw new Fallback('눌렀지만 화면이 바뀌지 않았어요 · 터미널을 확인해 주세요', 'plan');
    if (body.action === 'keep' && body.text) return { steps, ...(await reason(body.text)) };
    return { steps };
  }

  if (prompt.kind === 'question') return { steps, ...(await questions()) };

  // Permission (or a menu read off the screen): find the option by what it says.
  const ALWAYS = /(don.?t ask|always|allow all|this session|for the session)/i;
  const pick = {
    yes: (o) => !ALWAYS.test(o.label) && /^(yes|예|허용|allow|approve|proceed|run)\b/i.test(o.label),
    always: (o) => ALWAYS.test(o.label) && !/^(no|아니)/i.test(o.label),
    no: (o) => /^(no|아니|deny|reject|cancel)\b/i.test(o.label),
  }[body.action];
  const opt = pick ? first.options.find(pick) : first.options.find((o) => o.key === String(body.option || ''));
  if (!opt) throw new Fallback('이 선택지가 화면에 없어요 · 터미널에서 직접 답해 주세요', 'permission');
  press(opt.key);
  if (!(await waitMenu(gone(first), 3000))) throw new Fallback('눌렀지만 화면이 바뀌지 않았어요 · 터미널을 확인해 주세요', 'permission');
  if (body.action === 'no' && body.text) return { steps, ...(await reason(body.text)) };
  return { steps };

  /** After "no" / "keep planning": the reason goes in as a normal message once the input box is back. */
  async function reason(text) {
    if (await waitInput(2500)) return { thenSend: text };
    return { reasonPending: true };
  }

  async function questions() {
    const qs = prompt.questions || [];
    const answers = Array.isArray(body.answers) ? body.answers : [];
    for (let qi = 0; qi < qs.length; qi++) {
      const q = qs[qi];
      const a = answers[qi] || {};
      const m = (await waitMenu((x) => x && same(x.question, q.question), 2500))?.m;
      if (!m) throw new Fallback(`${qi + 1}번째 질문이 화면에 없어요 · 터미널에서 직접 답해 주세요`, `q${qi + 1}`);
      if (typeof a.text === 'string' && a.text.trim()) {
        if (!m.free) throw new Fallback('직접 입력할 칸이 없어요 · 터미널에서 직접 답해 주세요', `q${qi + 1}`);
        press(m.free);
        await new Promise((r) => setTimeout(r, 150));
        // Typed into the form, not sent as a message: one line, no control bytes.
        press(a.text.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 2000));
        press('\r');
      } else if (q.multi) {
        const want = new Set((a.pick || []).map(norm));
        for (const o of m.options) {
          if (o.checked === undefined) continue;
          if (want.has(norm(o.label)) === o.checked) continue;
          press(o.key);
          const flipped = await waitMenu((x) => x && x.options.find((y) => y.key === o.key)?.checked === !o.checked, 1500);
          if (!flipped) throw new Fallback('선택이 화면에 반영되지 않았어요 · 터미널에서 직접 답해 주세요', `q${qi + 1}`);
        }
        const next = m.options.find((o) => /^(next|submit|다음|제출|done|확인)\b/i.test(o.label));
        press(next ? next.key : '\x1b[C');
      } else {
        const label = norm((a.pick || [])[0]);
        const o = m.options.find((x) => norm(x.label) === label || same(x.label, (a.pick || [])[0]));
        if (!o) throw new Fallback('고른 답이 화면의 선택지와 달라요 · 터미널에서 직접 답해 주세요', `q${qi + 1}`);
        press(o.key);
        // Some versions move on at the digit, others want Enter on the highlighted option.
        const moved = await waitMenu(gone(m), 600);
        if (!moved) press('\r');
      }
      if (!(await waitMenu(gone(m), 2500))) throw new Fallback('답했지만 다음으로 넘어가지 않았어요 · 터미널을 확인해 주세요', `q${qi + 1}`);
    }
    // Several questions end on a review step; a single one may submit right away.
    const review = (await waitMenu((x) => !x || x.review, 1500))?.m;
    if (review?.review) {
      const submit = review.options.find((o) => /^submit/i.test(o.label));
      press(submit.key);
      if (!(await waitMenu(gone(review), 2500))) throw new Fallback('제출했지만 화면이 바뀌지 않았어요 · 터미널을 확인해 주세요', 'submit');
    }
    return {};
  }
}

/** One line for the message history: what was answered, in the person's words. */
export function answerLine(prompt, body) {
  if (prompt.kind === 'plan') {
    const c = prompt.screen?.plan?.find((x) => x.key === String(body.option || ''));
    return body.action === 'keep' ? `계획 더 다듬기${body.text ? ` · ${body.text}` : ''}` : `계획 ${c?.ko || '승인'}`;
  }
  if (prompt.kind === 'question') {
    return (prompt.questions || [])
      .map((q, i) => {
        const a = (body.answers || [])[i] || {};
        return `${q.header || q.question.slice(0, 20)} → ${a.text || (a.pick || []).join(', ')}`;
      })
      .join(' · ');
  }
  return '';
}
