// Two sessions changing the same file, and getting them to sort it out between themselves. Desk
// finds the overlap from each worktree's changed files, hands each agent the other's diff, and then
// only carries words: a line ending an agent's reply with "@상대: …" goes to the other session.
// What they decide is their own; no model of Desk's own reads or writes anything here.
import * as G from './git.js';
import { httpError } from './projects.js';

const MAX_RELAYS = 8; // messages carried per talk before Desk stops relaying
const LINE = /^\s*@상대\s*[:：]\s*(.+?)\s*$/gm;
const DONE = /^(끝|끝났어요|끝입니다|done|ok)[.!]?$/i;

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const short = (s, n = 40) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

/** The last "@상대: …" line of a reply, or null. */
export function peerLine(text) {
  let last = null;
  for (const m of String(text || '').matchAll(LINE)) last = m[1].trim();
  return last ? last.slice(0, 600) : null;
}

export class Talks {
  /** @param {import('./tasks.js').Tasks} tasks */
  constructor(tasks) {
    this.tasks = tasks;
    this.paths = new Map(); // task id → Set of "<repo root>\0<path in repo>"
    this.list = new Map(); // pair key → talk
    this.cache = null;
  }

  /** What a task's worktree changed (from refreshChanges). */
  setPaths(task, files) {
    const next = new Set(files.map((f) => `${f.root}\0${f.rel}`));
    const prev = this.paths.get(task.id);
    if (prev && prev.size === next.size && [...next].every((x) => prev.has(x))) return false;
    this.paths.set(task.id, next);
    this.cache = null;
    return true;
  }

  drop(id) {
    this.paths.delete(id);
    this.cache = null;
  }

  /** Pairs of running sessions with files in common: [{ a, b, files }]. */
  clashes() {
    if (this.cache) return this.cache;
    const live = this.tasks.store.tasks.filter((t) => !t.archived && this.tasks.rt.has(t.id) && this.paths.get(t.id)?.size);
    const out = [];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const pb = this.paths.get(b.id);
        const files = [...this.paths.get(a.id)].filter((x) => pb.has(x)).map((x) => x.split('\0')[1]);
        if (files.length) out.push({ key: pairKey(a.id, b.id), a: a.id, b: b.id, files: files.sort() });
      }
    }
    this.cache = out;
    return out;
  }

  /** For a task's view: who else changes its files, and how their talk is going. */
  viewOf(task) {
    const out = [];
    for (const c of this.clashes()) {
      if (c.a !== task.id && c.b !== task.id) continue;
      const other = this.tasks.store.task(c.a === task.id ? c.b : c.a);
      if (!other) continue;
      const tk = this.list.get(c.key);
      out.push({
        with: other.id,
        title: other.title,
        files: c.files.slice(0, 8),
        more: Math.max(0, c.files.length - 8),
        talk: tk ? { state: tk.state, msgs: tk.msgs.slice(-8), result: tk.result || '', startedAt: tk.startedAt, hold: tk.hold || null } : null,
      });
    }
    // A finished or running talk stays visible even after the overlap is gone.
    for (const tk of this.list.values()) {
      if (tk.a !== task.id && tk.b !== task.id) continue;
      if (out.some((x) => x.with === (tk.a === task.id ? tk.b : tk.a))) continue;
      const other = this.tasks.store.task(tk.a === task.id ? tk.b : tk.a);
      if (!other || Date.now() - (tk.endedAt || tk.startedAt) > 30 * 60_000) continue;
      out.push({ with: other.id, title: other.title, files: tk.files, more: 0, talk: { state: tk.state, msgs: tk.msgs.slice(-8), result: tk.result || '', startedAt: tk.startedAt } });
    }
    return out;
  }

  /** A file's change in a task's worktree, for the other session to read. */
  async diffOf(task, rel) {
    const x = task.repos.find((r) => !r.prefix) || task.repos[0];
    if (!x) return '';
    return G.fileDiff(x.worktree, x.since || x.baseRef, rel);
  }

  /**
   * Start the two talking: each gets the other's diff of the shared files, and how to answer.
   * Messages go in like any other instruction (queued if the agent is mid-turn).
   */
  async start(id, otherId) {
    const T = this.tasks;
    const a = T.need(id);
    const b = T.need(otherId);
    const c = this.clashes().find((x) => x.key === pairKey(a.id, b.id));
    if (!c) throw httpError(409, '두 세션이 함께 고치는 파일이 이제 없어요');
    if (!T.rt.has(a.id) || !T.rt.has(b.id)) throw httpError(409, '두 세션이 모두 실행 중이어야 협의할 수 있어요');
    const prev = this.list.get(c.key);
    if (prev?.state === 'talking') return prev;
    const tk = { key: c.key, a: a.id, b: b.id, files: c.files.slice(0, 8), state: 'talking', msgs: [], seen: {}, said: {}, relays: 0, startedAt: Date.now() };
    this.list.set(c.key, tk);
    for (const [me, other] of [
      [a, b],
      [b, a],
    ]) {
      const diffs = [];
      for (const f of tk.files.slice(0, 4)) diffs.push(`### ${f}\n\`\`\`diff\n${(await this.diffOf(other, f)) || '(아직 차이를 읽지 못했어요)'}\n\`\`\``);
      tk.seen[me.id] = me.lastReply || '';
      await T.send(me.id, this.opening(other, tk.files, diffs.join('\n\n')), 'talk');
    }
    T.changed();
    return tk;
  }

  opening(other, files, diffs) {
    return [
      `[Agent Desk · 다른 세션과 협의] 같은 프로젝트의 다른 세션 「${short(other.title, 60)}」도 ${files.map((f) => '`' + f + '`').join(', ')}을(를) 고치고 있어요. 그 세션은 다른 작업 폴더(git worktree)에서 일해서, 나중에 합칠 때 서로의 변경이 부딪힐 수 있어요.`,
      `그 세션의 변경은 이래요:\n\n${diffs}`,
      '당신의 변경과 부딪히는지 확인하고, 필요하면 당신 쪽을 맞춰 주세요. 그 세션의 폴더는 건드리지 마세요.',
      '그 세션에 전할 말은 답의 맨 끝에 한 줄로 `@상대: <할 말>` 이라고 쓰세요. Agent Desk가 그대로 전해 줘요. 더 할 말이 없고 부딪히지 않으면 `@상대: 끝` 이라고 쓰세요.',
    ].join('\n\n');
  }

  /**
   * A session finished a turn: if it's in a talk and its reply ends with "@상대: …", carry that
   * line to the other one. Both saying 끝 (or too many messages) ends the talk.
   */
  async onReply(task) {
    for (const tk of this.list.values()) {
      if (tk.state !== 'talking' || (tk.a !== task.id && tk.b !== task.id)) continue;
      const reply = task.lastReply || '';
      if (reply === tk.seen[task.id]) continue;
      tk.seen[task.id] = reply;
      const line = peerLine(reply);
      if (!line) continue;
      const to = tk.a === task.id ? tk.b : tk.a;
      const done = DONE.test(line);
      tk.msgs.push({ from: task.id, to, text: line, at: Date.now() });
      tk.said[task.id] = done ? 'done' : 'msg';
      if (done && tk.said[to] === 'done') {
        this.finish(tk, '두 세션 모두 부딪히지 않는다고 했어요');
        continue;
      }
      if (++tk.relays > MAX_RELAYS) {
        this.finish(tk, `메시지가 ${MAX_RELAYS}개를 넘어서 협의를 멈췄어요 · 대화를 직접 확인해 주세요`);
        continue;
      }
      // "끝" from one side only goes across as information; the other may still have something to say.
      if (!this.tasks.rt.has(to)) {
        this.finish(tk, '상대 세션이 멈춰서 협의를 마쳤어요');
        continue;
      }
      const from = this.tasks.store.task(task.id);
      const text = done
        ? `[Agent Desk · 「${short(from.title, 60)}」 세션] 그쪽은 더 할 말이 없고 부딪히지 않는다고 했어요. 당신도 문제가 없으면 답 끝에 \`@상대: 끝\`, 전할 말이 있으면 \`@상대: <할 말>\` 이라고 쓰세요.`
        : `[Agent Desk · 「${short(from.title, 60)}」 세션이 보낸 말] ${line}\n\n답할 말이 있으면 답의 맨 끝에 \`@상대: <할 말>\`, 정리됐으면 \`@상대: 끝\` 이라고 쓰세요.`;
      await this.tasks.send(to, text, 'talk').catch(() => this.finish(tk, '상대 세션에 전하지 못했어요'));
    }
    this.tasks.changed();
  }

  finish(tk, result) {
    tk.state = 'done';
    tk.result = result;
    tk.endedAt = Date.now();
  }

  /** Stop carrying messages for a pair. */
  stop(id, otherId) {
    const tk = this.list.get(pairKey(id, otherId));
    if (tk && tk.state === 'talking') this.finish(tk, '협의를 멈췄어요');
    this.tasks.changed();
  }

  /** Ask one session to leave the shared files until the other is done. */
  async hold(id, otherId) {
    const T = this.tasks;
    const me = T.need(id);
    const other = T.need(otherId);
    const c = this.clashes().find((x) => x.key === pairKey(id, otherId));
    const files = (c?.files || []).slice(0, 8);
    await T.send(me.id, `[Agent Desk] 같은 프로젝트의 다른 세션 「${short(other.title, 60)}」도 ${files.map((f) => '`' + f + '`').join(', ') || '같은 파일'}을(를) 고치고 있어요. 그 세션이 끝날 때까지 이 파일들은 건드리지 말고, 다른 부분을 먼저 하거나 기다려 주세요. 이미 바꾼 부분은 그대로 두세요.`, 'talk');
    const key = pairKey(id, otherId);
    const tk = this.list.get(key) || { key, a: id < otherId ? id : otherId, b: id < otherId ? otherId : id, files, state: 'done', msgs: [], seen: {}, said: {}, relays: 0, startedAt: Date.now() };
    tk.hold = { who: id, at: Date.now() };
    if (tk.state !== 'talking') tk.result = `「${short(me.title, 30)}」에게 기다리라고 했어요`;
    tk.endedAt = Date.now();
    this.list.set(key, tk);
    T.changed();
  }
}
