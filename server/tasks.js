import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import pty from '@lydell/node-pty';
import { randomId, run, errText, resolveInside, tilde, dataDir, commandFor, realPath } from './util.js';
import * as G from './git.js';
import { AGENTS, lastAssistantText, summarize } from './agents.js';
import { httpError, addProject } from './projects.js';
import { findSession, liveClaude, stopClaude, queueCodex, claudeTranscriptOf } from './sessions.js';
import { Watcher, readHistory } from './watch.js';
import { commandsIn } from './shells.js';
import { ActivityTracker, activityView, emptyActivity, findRollout } from './activity.js';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

/**
 * Windows: node-pty's own conpty.dll + OpenConsole.exe instead of the system's ConPTY. The system
 * one can hang on close (seen on Windows Server 2025 / 11 24H2), and its kill path forks a Node
 * helper that the app binary can't run (RunAsNode is off).
 */
export const PTY_WIN = process.platform === 'win32' ? { useConptyDll: true } : {};

const LIVE = new Set(['starting', 'working', 'waiting', 'needs_input', 'review', 'exited']);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A task runs one agent in `task.cwd`. Its code lives in `task.repos`: zero (plain folder),
 * one (a worktree inside that repo), or several (a task folder holding one worktree per repo,
 * each at `<prefix>`). File paths the UI sees are prefixed the same way.
 */
export class Tasks {
  constructor(store, auth, sock, changed) {
    this.store = store;
    this.auth = auth;
    this.sock = sock; // () => where the hook server listens
    this.changed = changed;
    /** id -> runtime { proc, term, ser, lastOut, lastIn, idleTimer, burst, burstAt, byHook, startedAt } */
    this.rt = new Map();
    this.trackers = new Map();
    /** peer (a window's connection) -> taskId */
    this.viewers = new Map();
    this.watchers = new Map();
    this.pastLogs = new Map(); // task id -> { key, entries }: a stopped session's transcript, read once
    for (const t of store.tasks) {
      migrate(t);
      if (t.watch) continue; // followed again by the watch poll
      if (['starting', 'working', 'waiting', 'needs_input', 'review'].includes(t.state)) {
        t.state = 'exited';
        t.reason = 'Desk가 다시 시작됐어요 · 재개할 수 있어요';
      }
    }
    store.save();
    this.changesTimer = setInterval(() => this.pollChanges(), 6000);
    this.codexTimer = setInterval(() => this.pollCodex(), 2000);
    this.watchTimer = setInterval(() => this.pollWatch(), 1200);
    // Main may have moved while Desk was closed (and older versions counted what came with it): recount once.
    this.recountTimer = setTimeout(() => this.recount(), 2000);
  }

  // ------------------------------------------------------------ watching sessions that run elsewhere

  watcher(task) {
    let w = this.watchers.get(task.id);
    if (!w) {
      const tracker = this.tracker(task);
      w = new Watcher(task, {
        tracker,
        onPrompt: (text, at, backlog) => {
          const clean = safeTyped(text).trim().slice(0, 4000);
          if (task.messages.some((m) => m.at === at && m.text === clean)) return;
          task.messages.push({ id: randomId('m'), text: clean, at, snap: null, source: 'outside' });
          if (task.messages.length > 300) task.messages.splice(1, task.messages.length - 300);
          if (!backlog) tracker.a.current = '';
          this.store.save();
          this.changed();
        },
        onReply: (text) => {
          task.lastReply = String(text || '').slice(-6000);
        },
        onStatus: (st) => this.watchStatus(task, st),
        onLink: () => {
          this.store.save();
          this.changed();
        },
      });
      this.watchers.set(task.id, w);
    }
    return w;
  }

  async pollWatch() {
    for (const t of this.store.tasks) {
      if (!t.watch || t.archived || ['merged', 'discarded'].includes(t.state)) continue;
      try {
        await this.watcher(t).poll();
      } catch {}
    }
  }

  async watchStatus(task, st) {
    const where = task.watch?.where || '다른 곳';
    if (st === 'busy') return this.setState(task, 'working', `${where}에서 작업 중`);
    if (st === 'waiting') return this.setState(task, 'needs_input', `${where}에서 선택을 기다려요`, { ask: 'choice' });
    if (st === 'idle') {
      this.tracker(task).turnEnded();
      return this.settle(task, `${where}에서 다음 지시를 기다려요`, task.lastReply);
    }
    // The process ended: take over right away if asked, otherwise offer it.
    if (task.watch?.autoTakeover && task.agent === 'claude') {
      await delay(400);
      this.takeOver(task, `${where}에서 닫혀서 여기서 이어받았어요`);
      return;
    }
    this.setState(task, 'exited', `${where}의 세션이 끝났어요 · 여기서 이어갈 수 있어요`);
  }

  takeOver(task, reason) {
    this.watchers.delete(task.id);
    const where = task.watch?.where;
    delete task.watch;
    if (task.imported) task.imported.mode = 'takeover';
    this.spawn(task, { resume: true });
    if (reason || where) task.reason = reason || `${where}에서 이어받았어요`;
    this.store.save();
    this.changed();
  }

  transcript(id) {
    const task = this.need(id);
    const w = this.watchers.get(id);
    if (w) return { entries: w.entries.slice(-150), status: w.status || null };
    return { entries: this.history(task).slice(-150), status: null };
  }

  /** What was said in a task's own session, so a stopped one still shows what it was about. */
  history(task) {
    const file =
      task.agent === 'claude'
        ? [task.sessionId, ...(task.pastSessionIds || []).slice().reverse()].map((sid) => sid && claudeTranscriptOf(sid)).find(Boolean)
        : task.watch?.file || (task.cwd && findRollout(task.cwd, 0));
    if (!file) return [];
    let key;
    try {
      const st = fs.statSync(file);
      key = `${file}:${st.size}:${st.mtimeMs}`;
    } catch {
      return [];
    }
    const hit = this.pastLogs.get(task.id);
    if (hit?.key === key) return hit.entries;
    const entries = readHistory(task.agent, file, task.cwd);
    this.pastLogs.set(task.id, { key, entries });
    return entries;
  }

  setWatch(id, patch) {
    const task = this.need(id);
    if (!task.watch) throw httpError(400, '보고만 있는 세션이 아니에요');
    if (typeof patch.autoTakeover === 'boolean') task.watch.autoTakeover = patch.autoTakeover;
    this.store.save();
    this.changed();
    // Already closed over there: take over now.
    if (task.watch.autoTakeover && this.watchers.get(id)?.status === 'gone') this.takeOver(task);
  }

  tracker(task) {
    let t = this.trackers.get(task.id);
    if (!t) {
      t = new ActivityTracker(task, () => {
        this.store.save();
        this.changed();
      });
      this.trackers.set(task.id, t);
    }
    return t;
  }

  // ------------------------------------------------------------ public view

  view(t) {
    const r = this.rt.get(t.id);
    const menu = t.state === 'needs_input' && r ? this.menuOf(r) : null;
    const main = t.repos[0];
    return {
      id: t.id,
      projectId: t.projectId,
      agent: t.agent,
      title: t.title,
      state: t.state,
      ask: t.state === 'needs_input' ? t.ask || askOfMenu(menu) : '',
      // A question on screen says more than the hook's generic "needs your permission".
      reason: (menu?.question && !/^(do you want|proceed)/i.test(menu.question) ? menu.question : '') || t.reason || '',
      summary: t.summary || '',
      branch: main?.branch || '',
      multi: t.repos.length > 1,
      repos: t.repos.map((x) => ({ name: x.name, prefix: x.prefix, branch: x.branch, projectId: x.projectId, path: tilde(x.repo) })),
      worktree: tilde(t.cwd),
      worktreeAbs: t.cwd,
      isolated: t.repos.length > 0,
      changes: t.changes || { files: 0, adds: 0, dels: 0 },
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      running: !!r,
      prUrl: t.prUrls?.[0]?.url,
      prUrls: t.prUrls || [],
      mergedInto: t.mergedInto,
      archived: !!t.archived,
      archivedAt: t.archivedAt || null,
      adopted: t.repos.some((x) => x.adopted) || (!!t.imported && !t.repos.length),
      imported: t.imported ? { mode: t.imported.mode, at: t.imported.at } : null,
      sessionId: t.sessionId || '',
      commands: commandsIn(t.lastReply),
      watching: t.watch ? { where: t.watch.where || '', autoTakeover: !!t.watch.autoTakeover, status: this.watchers.get(t.id)?.status || null, canSend: t.agent === 'codex' } : null,
      remote: !!t.remote,
      remoteUrl: t.remote || t.watch ? t.remoteUrl || '' : '',
      activity: activityView(t.activity),
      menu,
      // Put-away tasks can pile up; their history comes back with them when they're taken out.
      messages: (t.archived ? [] : t.messages || []).map((m) => ({ id: m.id, text: m.text, at: m.at, undone: !!m.undone, canUndo: !!m.snap && !m.undone, source: m.source })),
    };
  }

  // ------------------------------------------------------------ lifecycle

  /**
   * @param {{projectId:string, agent:string, prompt:string, extraProjectIds?:string[]}} input
   */
  async create({ projectId, agent, prompt, extraProjectIds = [], remote, import: imp }) {
    if (imp) return this.adopt({ ...imp, projectId, remote });
    const project = this.store.project(projectId);
    if (!project) throw httpError(404, '프로젝트를 찾을 수 없어요');
    const ad = AGENTS[agent];
    if (!ad) throw httpError(400, 'unknown agent');
    if (!ad.bin()) throw httpError(400, `${ad.label} CLI를 찾을 수 없어요. 설치 후 다시 시도하세요.`);
    prompt = safeTyped(prompt || '').trim();
    if (prompt.length < 2) throw httpError(400, '할 일을 입력하세요');

    // Which repos does this task span?
    const members = project.kind === 'group' ? (project.members || []).map((id) => this.store.project(id)).filter(Boolean) : [project];
    for (const id of Array.isArray(extraProjectIds) ? extraProjectIds.slice(0, 12) : []) {
      const p = this.store.project(String(id));
      if (!p || p.kind === 'group') throw httpError(400, '추가할 저장소를 찾을 수 없어요');
      if (!members.some((m) => m.id === p.id)) members.push(p);
    }
    const gitMembers = [];
    for (const m of members) {
      if (m.isGit && (await G.head(m.path))) gitMembers.push(m);
      else if (members.length > 1) throw httpError(400, `${m.name}은(는) 커밋이 있는 git 저장소여야 여러 저장소 작업에 넣을 수 있어요`);
    }

    const id = randomId('t');
    const slug = id.slice(1);
    const task = {
      id,
      projectId,
      agent,
      title: titleOf(prompt),
      prompt,
      state: 'starting',
      reason: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      repos: [],
      cwd: project.path,
      activity: emptyActivity(),
      // Known up front, so resuming reopens exactly this conversation (not just the latest one here).
      sessionId: agent === 'claude' ? randomUUID() : undefined,
      remote: this.wantsRemote(agent, project, remote),
    };

    const made = [];
    try {
      if (gitMembers.length === 1 && members.length === 1) {
        const m = gitMembers[0];
        const wt = path.join(m.path, '.agentdesk', 'worktrees', slug);
        G.excludeFromStatus(m.path, '/.agentdesk/');
        const base = await G.head(m.path);
        await G.addWorktree(m.path, wt, `desk/${slug}`, base);
        made.push({ repo: m.path, wt, branch: `desk/${slug}` });
        task.repos.push({ name: m.name, prefix: '', repo: m.path, worktree: wt, branch: `desk/${slug}`, baseRef: base, projectId: m.id });
        task.cwd = wt;
      } else if (gitMembers.length > 1) {
        // One folder per task, one worktree per repo inside it. The agent runs in the folder.
        const dir = path.join(dataDir(), 'tasks', slug);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const used = new Set();
        for (const m of gitMembers) {
          let name = folderName(m.name, path.basename(m.path));
          for (let n = 2; used.has(name); n++) name = `${folderName(m.name, path.basename(m.path))}-${n}`;
          used.add(name);
          const wt = path.join(dir, name);
          const base = await G.head(m.path);
          await G.addWorktree(m.path, wt, `desk/${slug}`, base);
          made.push({ repo: m.path, wt, branch: `desk/${slug}` });
          task.repos.push({ name, prefix: name + '/', repo: m.path, worktree: wt, branch: `desk/${slug}`, baseRef: base, projectId: m.id });
        }
        const guide = workspaceGuide(task.repos);
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'), guide);
        fs.writeFileSync(path.join(dir, 'AGENTS.md'), guide);
        task.cwd = dir;
        task.folder = dir;
      }
    } catch (e) {
      for (const x of made) await G.removeWorktree(x.repo, x.wt, x.branch).catch(() => {});
      throw httpError(500, `worktree를 만들지 못했어요: ${errText(e)}`);
    }

    const snap = await this.snapshotAll(task, 'start');
    task.messages.push({ id: randomId('m'), text: prompt, at: Date.now(), snap, source: 'start' });
    this.store.tasks.push(task);
    this.store.save();
    this.spawn(task, { prompt });
    this.changed();
    return task;
  }

  wantsRemote(agent, project, explicit) {
    if (!AGENTS[agent]?.remote) return false;
    if (typeof explicit === 'boolean') return explicit;
    if (typeof project?.remote === 'boolean') return project.remote;
    return !!this.store.prefs?.remote;
  }

  /** The name the session gets in the Claude app, so it's recognizable on a phone. */
  remoteName(task) {
    const p = this.store.project(task.projectId);
    return `${p?.name || 'Desk'} · ${task.title}`.slice(0, 80);
  }

  spawn(task, { prompt, resume = false, fork = false, fromSession, latest = false } = {}) {
    const ad = AGENTS[task.agent];
    const bin = ad.bin();
    if (!bin) throw httpError(400, `${ad.label} CLI를 찾을 수 없어요`);
    const env = { ...process.env };
    // Don't let a parent agent session or the app's own runtime leak into the child.
    for (const k of Object.keys(env)) if (/^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CODEX_SANDBOX|CODEX_THREAD|ELECTRON_|CHROME_)/.test(k)) delete env[k];
    Object.assign(env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AGENTDESK_SOCK: this.sock(),
      AGENTDESK_HOOK_TOKEN: this.auth.hookTokenFor(task.id),
      AGENTDESK_TASK: task.id,
    });
    const cols = task.cols || 120;
    const rows = task.rows || 34;
    this.tracker(task).restart();
    const args = ad.args({
      prompt,
      resume,
      fork,
      sessionId: latest ? undefined : fromSession || task.sessionId,
      newSessionId: resume ? undefined : task.sessionId,
      remote: task.remote ? this.remoteName(task) : false,
      name: task.agent === 'claude' ? task.title : undefined,
    });
    if (task.remote) task.remoteUrl = '';
    const [file, ...pre] = commandFor(bin);
    const proc = pty.spawn(file, [...pre, ...args], { name: 'xterm-256color', cols, rows, cwd: fs.existsSync(task.cwd) ? task.cwd : undefined, env, ...PTY_WIN });
    const term = new Terminal({ cols, rows, scrollback: 4000, allowProposedApi: true });
    const ser = new SerializeAddon();
    term.loadAddon(ser);
    const r = { proc, term, ser, lastOut: Date.now(), lastIn: Date.now(), idleTimer: undefined, burst: 0, burstAt: 0, byHook: false, startedAt: Date.now(), expect: [], rawEnterAt: 0, head: '' };
    // Prompts we send ourselves come back through UserPromptSubmit; anything else came from elsewhere (the phone).
    if (prompt) r.expect.push(Date.now());
    task.pid = proc.pid;
    if (task.remote) r.remoteUntil = Date.now() + 30000;
    this.rt.set(task.id, r);
    this.tracker(task);
    this.setState(task, 'working', resume ? '이어서 시작하는 중' : '시작하는 중');

    proc.onData((d) => {
      if (r.head.length < 4096) r.head += d;
      term.write(d);
      this.broadcast(task.id, { t: 'o', task: task.id, d });
      this.onOutput(task, r, d.length);
    });
    proc.onExit(({ exitCode }) => {
      if (this.rt.get(task.id) !== r) return;
      clearTimeout(r.idleTimer);
      this.rt.delete(task.id);
      try {
        term.dispose();
      } catch {}
      this.tracker(task).turnEnded();
      // A conversation that was never saved can't be reopened by id: fall back to the latest one here.
      // Only inside Desk's own worktree: in a person's real folder "latest" could be another live session.
      const ownFolder = !task.imported && task.repos.length > 0 && !task.repos.some((x) => x.adopted);
      if (ownFolder && resume && !latest && !fork && !task.archived && task.sessionId && Date.now() - r.startedAt < 4000 && /No conversation found/i.test(r.head)) {
        this.spawn(task, { resume: true, latest: true });
        return;
      }
      if (LIVE.has(task.state)) this.setState(task, 'exited', exitCode ? `종료됨 (코드 ${exitCode}) · 재개할 수 있어요` : '세션이 끝났어요 · 재개할 수 있어요');
      this.broadcast(task.id, { t: 'exit', task: task.id, code: exitCode });
    });
  }

  setState(task, state, reason, extra = {}) {
    task.state = state;
    if (reason !== undefined) task.reason = reason;
    if (extra.summary) task.summary = extra.summary;
    // What the agent is stuck on mid-turn until a person answers: 'permission', 'choice' or 'question'.
    task.ask = state === 'needs_input' ? extra.ask || '' : '';
    const r = this.rt.get(task.id);
    if (r) r.askTool = null;
    task.updatedAt = Date.now();
    this.store.save();
    this.changed();
  }

  onOutput(task, r, n) {
    const now = Date.now();
    r.lastOut = now;
    if (now - r.burstAt > 2000) {
      r.burst = 0;
      r.burstAt = now;
    }
    r.burst += n;
    // A guessed idle state flips back to working when real output resumes.
    if (!r.byHook && ['needs_input', 'review'].includes(task.state) && r.burst > 2500 && now - r.lastIn < 30000) {
      this.setState(task, 'working', '');
    }
    clearTimeout(r.idleTimer);
    r.idleTimer = setTimeout(() => this.onIdle(task, r), AGENTS[task.agent].idleMs);
    // Throttled, not debounced: a busy agent prints all the time and the link must still be found.
    if (task.remote && !task.remoteUrl && !r.remoteTimer) {
      r.remoteTimer = setTimeout(() => {
        r.remoteTimer = null;
        this.scanRemote(task, r);
      }, 300);
    }
    // A permission menu can appear without any hook (Codex): re-broadcast so widgets get buttons.
    if (task.state === 'needs_input') {
      clearTimeout(r.menuTimer);
      r.menuTimer = setTimeout(() => this.changed(), 250);
    }
  }

  async onIdle(task, r) {
    if (this.rt.get(task.id) !== r) return;
    if (task.state !== 'working') return;
    r.byHook = false;
    await this.settle(task, this.menuOf(r) ? '선택을 기다려요' : '입력을 기다리는 것 같아요');
  }

  /**
   * Decide between "needs you" and "ready for review" once the agent stops, unless background work
   * (`pending`, in words) will wake it again: then it's neither done nor asking, just waiting.
   */
  async settle(task, reason, summary, pending) {
    const files = await this.refreshChanges(task);
    const hasChanges = files && files.length > 0;
    const r = this.rt.get(task.id);
    const waitingOnMenu = r && this.menuOf(r);
    if (pending && !waitingOnMenu) return this.setState(task, 'waiting', pending, { summary: summarize(summary) });
    this.setState(task, hasChanges && !waitingOnMenu ? 'review' : 'needs_input', reason, { summary: summarize(summary), ask: askOfMenu(waitingOnMenu) });
  }

  /** The agent stopped mid-turn on something only a person can answer: a permission, a choice, a question. */
  blockOn(task, r, p, ask, reason) {
    if (r) {
      clearTimeout(r.idleTimer);
      r.byHook = true;
    }
    this.setState(task, 'needs_input', reason, { ask });
    if (r && p.tool_name) r.askTool = { name: p.tool_name, input: JSON.stringify(p.tool_input ?? null) };
  }

  markInput(task) {
    const r = this.rt.get(task.id);
    if (r) {
      r.lastIn = Date.now();
      r.byHook = false;
    }
    if (task.state !== 'working') this.setState(task, 'working', '');
  }

  async hook(body) {
    const task = this.store.task(String(body.task || ''));
    // A put-away task's agent is gone; a hook still in flight from it changes nothing.
    if (!task || task.archived) return;
    const r = this.rt.get(task.id);
    const p = body.payload && typeof body.payload === 'object' ? body.payload : {};
    if (body.agent === 'claude') {
      const ev = p.hook_event_name;
      // Forks and /clear start a new conversation id; follow it so resume reopens the right one.
      if (typeof p.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(p.session_id) && p.session_id !== task.sessionId && transcriptBelongs(p.session_id, task.cwd)) {
        if (task.sessionId) task.pastSessionIds = [...new Set([...(task.pastSessionIds || []), task.sessionId])].slice(-20);
        task.sessionId = p.session_id;
        this.store.save();
      }
      if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop'].includes(ev)) {
        this.tracker(task).claude(p);
        // Asking the person is a tool too, and the agent stops on it until they answer.
        if (ev === 'PreToolUse' && !p.agent_id && ASKS_PERSON.has(p.tool_name)) return this.blockOn(task, r, p, 'choice', choiceAsk(p));
        // Tool activity means the agent is working (unless it's waiting on a permission prompt).
        if (ev === 'PreToolUse' && !p.agent_id && task.state !== 'working' && task.state !== 'needs_input') this.setState(task, 'working', '');
        // Answered where Desk doesn't see it (the phone): the call it was stuck on went ahead.
        if (ev !== 'PreToolUse' && task.ask && r?.askTool?.name === p.tool_name && (ASKS_PERSON.has(p.tool_name) || r.askTool.input === JSON.stringify(p.tool_input ?? null))) {
          this.setState(task, 'working', '');
        }
        return;
      }
      if (ev === 'UserPromptSubmit') return this.promptArrived(task, r, p.prompt);
      // Right when the prompt opens, with the command itself (the Notification comes ~6 s later).
      if (ev === 'PermissionRequest') return ASKS_PERSON.has(p.tool_name) ? this.blockOn(task, r, p, 'choice', choiceAsk(p)) : this.blockOn(task, r, p, 'permission', permissionAsk(p));
      if (ev === 'Notification') {
        const msg = String(p.message || '입력이 필요해요');
        const type = String(p.notification_type || '');
        if (type === 'permission_prompt' || (!type && /permission|권한/i.test(msg))) {
          return task.state === 'needs_input' && task.ask ? undefined : this.blockOn(task, r, {}, 'permission', msg);
        }
        if (type === 'elicitation_dialog' || type === 'elicitation_url_dialog') return this.blockOn(task, r, {}, 'question', msg);
        // "Finished a minute ago and you haven't typed" says nothing new unless Desk still thinks it's working;
        // the other kinds (signed in, quota notices…) don't change what the task is doing.
        if (type && !(type === 'idle_prompt' && task.state === 'working')) return;
      }
      if (r) {
        clearTimeout(r.idleTimer);
        r.byHook = true;
      }
      if (ev === 'Notification') return this.settle(task, String(p.message || '입력이 필요해요'));
      if (ev === 'Stop') {
        this.tracker(task).turnEnded();
        const text = lastAssistantText(p.transcript_path) || p.last_assistant_message;
        task.lastReply = typeof text === 'string' ? text.slice(-6000) : '';
        return this.settle(task, '응답을 마쳤어요', text, pendingOf(p));
      }
    } else if (body.agent === 'codex') {
      if (p.type === 'approval-requested' || p.type === 'async-question') {
        const what = p.type === 'approval-requested' ? '승인을 기다려요' : '질문이 있어요';
        return this.blockOn(task, r, {}, p.type === 'approval-requested' ? 'permission' : 'question', p.message ? `${what} · ${String(p.message).slice(0, 160)}` : what);
      }
      if (p.type === 'agent-turn-complete') {
        if (r) {
          clearTimeout(r.idleTimer);
          r.byHook = true;
        }
        this.tracker(task).pollCodex(r?.startedAt || task.createdAt);
        this.tracker(task).turnEnded();
        task.lastReply = typeof p['last-assistant-message'] === 'string' ? p['last-assistant-message'].slice(-6000) : '';
        return this.settle(task, '응답을 마쳤어요', p['last-assistant-message']);
      }
    }
  }

  pollCodex() {
    for (const [id, r] of this.rt) {
      const task = this.store.task(id);
      if (task?.agent === 'codex') this.tracker(task).pollCodex(r.startedAt);
    }
  }

  /**
   * The agent accepted a prompt. If we didn't send it (the Claude app on a phone did, or an Enter
   * we couldn't read), record it here too, after a snapshot: the hook is synchronous, so the
   * snapshot lands before the agent touches anything, and undo works for it like any other.
   */
  async promptArrived(task, r, prompt) {
    const now = Date.now();
    if (r) {
      r.expect = r.expect.filter((t) => now - t < 10000);
      if (r.expect.length) {
        r.expect.shift();
        return this.markInput(task);
      }
    }
    const text = safeTyped(String(prompt || '')).trim();
    if (!text || /^\/remote-control\b/.test(text)) return this.markInput(task);
    const fromHere = r && now - r.rawEnterAt < 4000;
    const snap = await this.snapshotAll(task, text.slice(0, 60));
    task.messages.push({ id: randomId('m'), text: text.slice(0, 4000), at: now, snap, source: fromHere ? 'terminal' : task.remote ? 'remote' : 'outside' });
    if (task.messages.length > 300) task.messages.splice(1, task.messages.length - 300);
    this.markInput(task);
    this.store.save();
    this.changed();
  }

  /** Remote Control prints the session's claude.ai link; show it so it can be opened on a phone. */
  scanRemote(task, r) {
    if (this.rt.get(task.id) !== r || task.remoteUrl) return;
    // Only the CLI's own Remote Control line, only shortly after Remote Control was asked for, and
    // never replaced: an agent (or a file it prints) must not be able to plant its own link.
    if (!r.remoteUntil || Date.now() > r.remoteUntil) return;
    for (const line of this.screenText(r).split('\n')) {
      if (!/remote.?control/i.test(line)) continue;
      const m = line.match(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+(?![A-Za-z0-9_\-/?=&.%])/);
      if (!m) continue;
      task.remoteUrl = m[0];
      this.store.save();
      this.changed();
      return;
    }
  }

  /** Visible screen plus recent scrollback as text, with soft-wrapped rows joined. */
  screenText(r) {
    const b = r.term.buffer.active;
    const out = [];
    const from = Math.max(0, b.length - r.term.rows - 200);
    for (let y = from; y < b.length; y++) {
      const line = b.getLine(y);
      if (!line) continue;
      const t = line.translateToString(true);
      if (line.isWrapped && out.length) out[out.length - 1] += t;
      else out.push(t);
    }
    return out.join('\n');
  }

  /** Turn Remote Control on for a task (now if it's idle at an empty prompt, else from the next start). */
  async remote(id, on) {
    const task = this.need(id);
    if (!AGENTS[task.agent].remote) throw httpError(400, `${AGENTS[task.agent].label}은(는) Claude 앱 원격 연결을 지원하지 않아요`);
    const r = this.rt.get(id);
    if (!on) {
      task.remote = false;
      task.remoteUrl = '';
      this.store.save();
      this.changed();
      return { applied: r ? 'next' : 'now' };
    }
    if (task.remote && (task.remoteUrl || !r)) return { applied: 'now' };
    task.remote = true;
    task.remoteUrl = '';
    this.store.save();
    this.changed();
    if (!r) return { applied: 'next' };
    await new Promise((res) => r.term.write('', res));
    if (task.state === 'working' || this.promptText(r) !== '') {
      return { applied: 'next', hint: '에이전트가 쉬고 입력창이 비어 있을 때 다시 누르면 지금 바로 연결해요' };
    }
    r.remoteUntil = Date.now() + 30000;
    r.proc.write('/remote-control');
    setTimeout(() => r.proc.write('\r'), 120);
    return { applied: 'now' };
  }

  // ------------------------------------------------------------ screen reading

  /** Plain text of the visible screen, one string per row (dim placeholder text dropped). */
  screenLines(r, { skipDim = false } = {}) {
    const b = r.term.buffer.active;
    const out = [];
    const cell = b.getNullCell?.();
    for (let y = 0; y < r.term.rows; y++) {
      const line = b.getLine(b.viewportY + y);
      if (!line) {
        out.push('');
        continue;
      }
      if (!skipDim || !cell) {
        out.push(line.translateToString(true));
        continue;
      }
      let s = '';
      for (let x = 0; x < line.length; x++) {
        const c = line.getCell(x, cell);
        if (!c) break;
        const ch = c.getChars();
        if (c.getWidth() === 0) continue;
        s += c.isDim() ? ' '.repeat(Math.max(1, ch.length)) : ch || ' ';
      }
      out.push(s.replace(/\s+$/, ''));
    }
    return out;
  }

  /**
   * The text in the agent's input box, if the cursor is in one. Recognizes Claude Code's
   * "> " / "│ > " box and Codex's "› ". Placeholder hints are dim, so they're ignored.
   */
  promptText(r) {
    // A choice menu on screen means Enter picks an option; that's never a message.
    if (this.menuOf(r)) return null;
    const b = r.term.buffer.active;
    const lines = this.screenLines(r, { skipDim: true });
    const cy = b.cursorY;
    const border = (l) => /^[\s╭╮╰╯┌┐└┘─━═]*$/.test(l) && /[─━═]/.test(l);
    const strip = (l) => l.replace(/^\s*[│┃|]\s?/, '').replace(/\s*[│┃|]\s*$/, '');
    let top = cy;
    while (top > 0 && cy - top < 12 && !border(lines[top - 1]) && lines[top - 1].trim() && !/^\s*[>›❯]/.test(strip(lines[top]))) top--;
    const first = strip(lines[top] || '');
    const m = first.match(/^\s*([>›❯])\s?(.*)$/);
    if (!m || /^\d[.)]\s/.test(m[2])) return null;
    const body = [m[2]];
    for (let y = top + 1; y <= Math.min(lines.length - 1, cy + 12); y++) {
      if (border(lines[y]) || (!lines[y].trim() && y > cy)) break;
      body.push(strip(lines[y]).replace(/^\s{0,2}/, ''));
    }
    const text = body.join('\n').replace(/\s+$/g, '').trim();
    return text || '';
  }

  /**
   * A numbered choice menu on screen: permission prompts, and AskUserQuestion forms where each
   * option has description lines under it and the last ones sit below a separator.
   * Returns { question, options:[{key,label,desc,selected}] } or null.
   */
  menuOf(r) {
    const lines = this.screenLines(r);
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    const OPT = /^\s*[│┃|]?\s*(❯|>|›)?\s*(\d{1,2})[.)]\s+(.+?)\s*[│┃|]?\s*$/;
    const PROMPT = /^\s*[│┃|]?\s*[>›❯](\s|$)/;
    const strip = (l) => l.replace(/^\s*[│┃|╭╰─]+/, '').replace(/[│┃|╮╯─]+\s*$/, '').trim();
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
        opts.unshift({ key: m[2], label: m[3].trim().slice(0, 90), desc: desc.reverse().join(' ').slice(0, 160), selected: !!m[1] });
        firstIdx = y;
        want--;
        gap = 0;
        desc = [];
      } else {
        if (m || ++gap > 6) break;
        const t = strip(lines[y]);
        if (t && !/^[─━═\s]+$/.test(t)) desc.push(t);
      }
    }
    if (want !== 0 || opts.length < 2 || opts.length > 9) return null;
    let question = '';
    for (let k = firstIdx - 1; k >= 0 && k >= firstIdx - 6; k--) {
      const t = strip(lines[k]);
      if (t && !/^[─━═\s]+$/.test(t)) {
        question = t.slice(0, 160);
        break;
      }
    }
    return { question, options: opts };
  }

  screen(id, n = 10) {
    const r = this.rt.get(id);
    if (!r) return { lines: [], running: false };
    const lines = this.screenLines(r);
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    return { lines: lines.slice(Math.max(0, end - Math.min(40, n)), end), running: true, menu: this.menuOf(r) };
  }

  // ------------------------------------------------------------ terminal I/O

  attach(ws, id, cols, rows) {
    this.viewers.set(ws, id);
    const task = this.store.task(id);
    const r = this.rt.get(id);
    if (!task) return;
    if (r && cols > 10 && rows > 3) this.resize(id, cols, rows);
    ws.send(JSON.stringify({ t: 'snap', task: id, d: r ? r.ser.serialize({ scrollback: 2000 }) : '', running: !!r }));
  }

  detach(ws) {
    this.viewers.delete(ws);
  }

  resize(id, cols, rows) {
    const r = this.rt.get(id);
    const task = this.store.task(id);
    if (!r || !task) return;
    cols = Math.max(20, Math.min(400, cols | 0));
    rows = Math.max(5, Math.min(200, rows | 0));
    if (cols === task.cols && rows === task.rows) return;
    task.cols = cols;
    task.rows = rows;
    try {
      r.proc.resize(cols, rows);
      r.term.resize(cols, rows);
    } catch {}
  }

  /** Raw keystrokes from the attached terminal (everything except a submitting Enter). */
  input(id, data) {
    const r = this.rt.get(id);
    const task = this.store.task(id);
    if (!r || !task || typeof data !== 'string') return;
    r.proc.write(data);
    // Meta+Enter / Ctrl+J are new lines inside the message, not a send.
    if (/[\r\n]/.test(data) && data !== '\x1b\r' && data !== '\n') {
      r.rawEnterAt = Date.now();
      this.markInput(task);
    }
  }

  /**
   * Enter pressed in the terminal. If the cursor sits in the agent's input box, this is a
   * message: snapshot first, then let the Enter through, and record what was sent.
   * Anything else (a menu choice, a confirm) just passes through.
   */
  async submit(id) {
    const task = this.store.task(id);
    const r = this.rt.get(id);
    if (!task || !r) return null;
    await new Promise((res) => r.term.write('', res)); // flush pending output into the screen model
    const text = this.promptText(r);
    if (!text) {
      r.rawEnterAt = Date.now();
      r.proc.write('\r');
      this.markInput(task);
      return null;
    }
    const snap = await this.snapshotAll(task, text.slice(0, 60));
    r.expect.push(Date.now());
    r.proc.write('\r');
    const msg = { id: randomId('m'), text: text.slice(0, 4000), at: Date.now(), snap, source: 'terminal' };
    task.messages.push(msg);
    if (task.messages.length > 300) task.messages.splice(1, task.messages.length - 300);
    this.markInput(task);
    this.store.save();
    this.changed();
    return msg;
  }

  /** Put text into the agent's input box without sending it (review comments, file refs). */
  paste(id, text) {
    const r = this.rt.get(id);
    if (!r) throw httpError(409, '세션이 멈춰 있어요. 먼저 재개하세요.');
    const clean = safeTyped(text).trim();
    if (!clean) return;
    r.proc.write('\x1b[200~' + clean.replace(/\n/g, '\r') + '\x1b[201~');
  }

  /** Answer a menu by its number (from a widget button). Only digits 1-9. */
  choose(id, key) {
    const r = this.rt.get(id);
    const task = this.store.task(id);
    if (!r || !task || !/^[1-9]$/.test(String(key))) return;
    const menu = this.menuOf(r);
    if (!menu || !menu.options.some((o) => o.key === String(key))) throw httpError(409, '선택지가 화면에서 사라졌어요');
    r.proc.write(String(key));
    this.markInput(task);
  }

  broadcast(id, msg) {
    const s = JSON.stringify(msg);
    for (const [ws, tid] of this.viewers) if (tid === id && ws.readyState === 1) ws.send(s);
  }

  writeText(r, text) {
    // Composer text is *typed* into a terminal, so control bytes must never get through:
    // an ESC could close bracketed paste early and a CR would submit an extra line.
    const clean = safeTyped(text);
    // One message at a time: two sends close together must not interleave into one line.
    r.chain = (r.chain || Promise.resolve()).then(async () => {
      const task = this.store.task(this.taskOfRt(r));
      if (!task) return;
      r.expect.push(Date.now());
      if (/\n/.test(clean)) r.proc.write('\x1b[200~' + clean.replace(/\n/g, '\r') + '\x1b[201~');
      else r.proc.write(clean);
      await delay(80);
      // Marked before the Enter goes out: a fast reply must not be overwritten by "working".
      this.markInput(task);
      r.proc.write('\r');
      await delay(60);
    }).catch(() => {});
    return r.chain;
  }

  taskOfRt(r) {
    for (const [id, x] of this.rt) if (x === r) return id;
    return null;
  }

  // ------------------------------------------------------------ messages

  /** Send from the narrow-screen composer or a widget's quick reply. */
  async send(id, text) {
    const task = this.need(id);
    text = safeTyped(text || '').trim();
    if (!text) throw httpError(400, '보낼 내용이 없어요');
    if (task.watch) {
      if (task.agent !== 'codex') throw httpError(409, `${task.watch.where || '다른 곳'}에서 실행 중인 Claude Code 세션에는 바깥에서 입력을 넣을 수 없어요. 거기서 닫으면 여기서 이어받거나, 복사본으로 분기하세요.`);
      try {
        await queueCodex(task.watch.sessionId, text);
      } catch (e) {
        throw httpError(409, `Codex 세션에 넣지 못했어요: ${errText(e)}`);
      }
      const msg = { id: randomId('m'), text, at: Date.now(), snap: null, source: 'queue' };
      task.messages.push(msg);
      this.store.save();
      this.changed();
      return msg;
    }
    const r = this.rt.get(id);
    if (!r) throw httpError(409, '세션이 멈춰 있어요. 먼저 재개하세요.');
    const snap = await this.snapshotAll(task, text.slice(0, 60));
    const msg = { id: randomId('m'), text, at: Date.now(), snap, source: 'composer' };
    task.messages.push(msg);
    await this.writeText(r, text);
    this.store.save();
    this.changed();
    return msg;
  }

  async snapshotAll(task, label) {
    if (!task.repos.length) return null;
    try {
      const snaps = await Promise.all(task.repos.map(async (x, i) => ({ i, ...(await G.snapshot(x.worktree, label)) })));
      return snaps;
    } catch {
      return null;
    }
  }

  /** Stop the agent, put files back to just before `msgId`, and tell the agent to ignore it. */
  async undo(id, msgId) {
    const task = this.need(id);
    const idx = task.messages.findIndex((m) => m.id === msgId);
    const msg = task.messages[idx];
    if (!msg) throw httpError(404, 'message not found');
    if (!msg.snap) throw httpError(400, '이 지시는 되돌릴 스냅샷이 없어요');
    // In a person's own checkout, undo must not reach past what Desk did: if the branch or commit
    // moved since the snapshot (their own work, another session), refuse instead of resetting it.
    for (const s of msg.snap) {
      const repo = task.repos[s.i];
      if (!repo?.adopted) continue;
      const head = await G.head(repo.worktree);
      const branch = (await G.currentBranch(repo.worktree)) || '';
      if ((s.parent && head !== s.parent) || branch !== (repo.branch || '')) {
        throw httpError(409, `${repo.name}: 그 뒤로 이 폴더의 브랜치나 커밋이 바뀌어서 되돌리면 다른 작업까지 지워질 수 있어요. 되돌리지 않았어요.`);
      }
    }
    const r = this.rt.get(id);
    if (r) {
      r.proc.write('\x1b'); // interrupt
      await delay(350);
    }
    for (const s of msg.snap) {
      const repo = task.repos[s.i];
      if (repo && fs.existsSync(repo.worktree)) await G.restore(repo.worktree, s);
    }
    for (const m of task.messages.slice(idx)) m.undone = true;
    await this.refreshChanges(task);
    if (r && msg.source !== 'start' && msg.source !== 'import') {
      await delay(250);
      const short = msg.text.length > 40 ? msg.text.slice(0, 40) + '…' : msg.text;
      await this.writeText(
        r,
        `[취소] 방금 보낸 "${short.replace(/\n/g, ' ')}" 지시는 실수로 보낸 거야. 실행하지 말고 완전히 무시해. 파일은 내가 그 이전 상태로 이미 되돌렸어. 아무것도 하지 말고 다음 지시를 기다려줘.`
      );
    } else if (msg.source === 'start' || msg.source === 'import') {
      this.setState(task, 'needs_input', '처음 상태로 되돌렸어요');
    }
    this.store.save();
    this.changed();
    return { ...this.view(task), undoneText: msg.text };
  }

  // ------------------------------------------------------------ control

  stop(id) {
    const r = this.rt.get(id);
    if (r) r.proc.kill();
  }

  resume(id) {
    const task = this.need(id);
    if (this.rt.get(id)) return;
    if (task.watch) {
      const st = this.watchers.get(id)?.status;
      if (st && st !== 'gone') throw httpError(409, `아직 ${task.watch.where || '다른 곳'}에서 실행 중이에요. 거기서 닫으면 이어받을 수 있어요 (자동 이어받기를 켜두면 바로 넘어와요).`);
      return this.takeOver(task);
    }
    if (!LIVE.has(task.state)) throw httpError(409, '이미 정리된 작업이에요');
    if (!fs.existsSync(task.cwd)) throw httpError(409, '작업 폴더가 없어요');
    this.spawn(task, { resume: true });
  }

  /**
   * Open a session that already exists on this machine as a task. It keeps working in its own
   * folder (no new worktree). A session still running somewhere else is opened as a copy
   * (`--fork-session`) so two processes never write one conversation; a background session can
   * instead be stopped and taken over.
   */
  async adopt({ agent, sessionId, mode = 'auto', projectId, remote }) {
    if (!AGENTS[agent]) throw httpError(400, 'unknown agent');
    if (!AGENTS[agent].bin()) throw httpError(400, `${AGENTS[agent].label} CLI를 찾을 수 없어요`);
    const s = await findSession(this.store, agent, sessionId);
    if (!s) throw httpError(404, '그 세션을 찾을 수 없어요');
    // Watching only makes sense for a session that's running right now.
    const watch = mode === 'watch' && (s.live || s.recent);
    const ownedHere = (t) => t && (!s.live || s.live.pid === t.pid || this.rt.get(t.id)?.proc.pid === s.live.pid || !!t.watch);
    if (s.taskId && mode !== 'fork' && ownedHere(this.store.task(s.taskId))) {
      const t = this.store.task(s.taskId);
      if (t) {
        if (t.archived) this.unarchive(t.id);
        if (!this.rt.get(t.id) && LIVE.has(t.state) && fs.existsSync(t.cwd)) this.spawn(t, { resume: true });
        return t;
      }
    }
    let cwd;
    try {
      cwd = realPath(s.cwd);
      if (!fs.statSync(cwd).isDirectory()) throw new Error();
    } catch {
      throw httpError(409, `그 세션의 폴더가 없어요: ${tilde(s.cwd)}`);
    }
    let project = s.projectId && this.store.project(s.projectId);
    if (!project && projectId) {
      const p = this.store.project(String(projectId));
      if (p && p.kind !== 'group' && (cwd === realPath(p.path) || cwd.startsWith(realPath(p.path) + path.sep))) project = p;
    }
    if (!project) project = await addProject(this.store, { path: cwd });

    let fork = mode === 'fork';
    if (watch) {
      // nothing to stop or copy: we only read along
    } else if (s.live) {
      if (s.live.kind === 'background' && mode === 'takeover') {
        await stopClaude(s.live.shortId || s.sessionId);
        for (let i = 0; i < 20; i++) {
          const live = await liveClaude({ fresh: true });
          if (!live.some((l) => l.sessionId === s.sessionId)) break;
          await delay(300);
        }
      } else fork = true;
    }

    const repos = [];
    if (await G.isRepo(cwd)) {
      const top = (await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'])).stdout.trim();
      const common = (await run('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
      const main = path.basename(common) === '.git' ? path.dirname(common) : top;
      const base = await G.head(top);
      if (base) repos.push({ name: path.basename(main), prefix: '', repo: main, worktree: top, branch: (await G.currentBranch(top)) || '', baseRef: base, projectId: project.id, adopted: true });
    }
    const id = randomId('t');
    const task = {
      id,
      projectId: project.id,
      agent,
      title: titleOf(s.title || s.first || '불러온 세션'),
      prompt: s.first || s.title || '',
      state: 'starting',
      reason: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      repos,
      cwd,
      activity: emptyActivity(),
      sessionId: fork ? undefined : s.sessionId,
      pastSessionIds: fork ? [s.sessionId] : [],
      imported: { from: s.sessionId, mode: watch ? 'watch' : fork ? 'fork' : s.live ? 'takeover' : 'resume', at: Date.now() },
      remote: this.wantsRemote(agent, project, remote),
    };
    const snap = await this.snapshotAll(task, 'import');
    task.messages.push({ id: randomId('m'), text: `불러온 세션: ${task.title}`, at: Date.now(), snap, source: 'import' });
    this.store.tasks.push(task);
    if (watch) {
      task.watch = { agent, sessionId: s.sessionId, pid: s.live?.pid, where: s.live?.where || (agent === 'codex' ? '다른 터미널' : '다른 곳'), file: agent === 'codex' ? s.file : undefined, autoTakeover: false };
      task.state = 'working';
      task.reason = `${task.watch.where}에서 실행 중인 세션을 따라 읽는 중`;
      this.store.save();
      await this.watcher(task).poll();
      this.changed();
      return task;
    }
    this.store.save();
    this.spawn(task, { resume: true, fork, fromSession: s.sessionId });
    this.changed();
    return task;
  }

  /** All-or-nothing as far as git allows: every repo is checked before any is merged. */
  async merge(id) {
    const task = this.need(id);
    if (!task.repos.length) throw httpError(400, 'git worktree에서 돌아간 작업만 머지할 수 있어요');
    if (task.repos.some((x) => x.adopted)) throw httpError(400, '불러온 세션은 원래 폴더에서 바로 작업해서 머지할 브랜치가 따로 없어요. 변경은 이미 그 폴더에 있어요.');
    try {
      for (const x of task.repos) await G.commitAll(x.worktree, task.title);
      for (const x of task.repos) {
        if (await G.isDirty(x.repo)) throw httpError(409, `${x.name}: 메인 체크아웃(${tilde(x.repo)})에 커밋 안 된 변경이 있어서 머지할 수 없어요`);
      }
      for (const x of task.repos) {
        if ((await G.mergeConflicts(x.repo, x.branch)) === true) throw httpError(409, `${x.name}: 머지하면 충돌이 나요. 아무 저장소도 머지하지 않았어요.`);
      }
      const into = [];
      for (const x of task.repos) {
        try {
          await G.mergeInto(x.repo, x.branch, `Merge ${x.branch}: ${task.title}`);
          into.push({ name: x.name, branch: (await G.currentBranch(x.repo)) || 'HEAD' });
        } catch (e) {
          const done = into.map((d) => d.name).join(', ');
          throw httpError(409, `${x.name}에서 머지가 실패했어요: ${errText(e)}${done ? ` (이미 머지됨: ${done})` : ''}`);
        }
      }
      this.stop(id);
      await delay(150);
      for (const x of task.repos) await G.removeWorktree(x.repo, x.worktree, x.branch, { force: true, deleteBranch: true, unmergedOk: false });
      if (task.folder) fs.rmSync(task.folder, { recursive: true, force: true });
      this.onGone?.(id);
      task.mergedInto = into.map((d) => (task.repos.length > 1 ? `${d.name}:${d.branch}` : d.branch)).join(', ');
      this.setState(task, 'merged', `${task.mergedInto}에 머지했어요`);
      return { into: task.mergedInto };
    } catch (e) {
      if (e.status) throw e;
      throw httpError(409, `머지하지 못했어요: ${errText(e)}`);
    }
  }

  async pr(id) {
    const task = this.need(id);
    if (!task.repos.length) throw httpError(400, 'git worktree에서 돌아간 작업만 PR을 만들 수 있어요');
    const urls = [];
    const body = (others) =>
      `${task.summary || task.prompt}${others.length ? `\n\n같은 작업의 다른 저장소:\n${others.map((o) => `- ${o.name}: ${o.url}`).join('\n')}` : ''}\n\n---\nAgent Desk · ${AGENTS[task.agent].label}`;
    try {
      for (const x of task.repos) {
        await G.commitAll(x.worktree, task.title);
        if (!(await G.isDirty(x.worktree)) && (await run('git', ['-C', x.worktree, 'rev-list', '--count', `${await this.since(x)}..HEAD`])).stdout.trim() === '0') continue;
        await G.push(x.worktree, x.branch);
        // `--flag=value` so a title starting with "-" can't be read as another flag.
        const { stdout } = await run('gh', ['pr', 'create', `--head=${x.branch}`, `--title=${task.title}`, `--body=${body(urls)}`], { cwd: x.worktree, timeout: 120000 });
        urls.push({ name: x.name, url: (stdout.match(/https?:\/\/\S+/) || [])[0] || '' });
      }
      // Link the PRs to each other once they all exist.
      if (urls.length > 1) {
        for (const u of urls) {
          const x = task.repos.find((r) => r.name === u.name);
          await run('gh', ['pr', 'edit', u.url, `--body=${body(urls.filter((o) => o !== u))}`], { cwd: x.worktree, timeout: 60000 }).catch(() => {});
        }
      }
      task.prUrls = urls;
      this.setState(task, task.state, urls.length ? `PR ${urls.length}개를 만들었어요` : task.reason);
      return { urls, url: urls[0]?.url };
    } catch (e) {
      task.prUrls = urls;
      throw httpError(409, `PR을 만들지 못했어요: ${errText(e)}${urls.length ? ` (만든 PR: ${urls.map((u) => u.name).join(', ')})` : ''}`);
    }
  }

  async discard(id) {
    const task = this.need(id);
    this.stop(id);
    await delay(150);
    // An imported session worked in the person's own folder: never delete anything there.
    // Discarding is one step: it also leaves the list (nothing left to clear afterwards).
    task.archived = true;
    this.onGone?.(id);
    if (task.imported) {
      this.watchers.delete(id);
      delete task.watch;
      return this.setState(task, 'discarded', '목록에서 뺐어요 · 파일은 그대로예요');
    }
    for (const x of task.repos) await G.removeWorktree(x.repo, x.worktree, x.branch, { force: true, deleteBranch: true, unmergedOk: true });
    if (task.folder) fs.rmSync(task.folder, { recursive: true, force: true });
    this.setState(task, 'discarded', '버렸어요');
  }

  /**
   * Put a task away without losing anything: its agent stops (the conversation is already saved),
   * the worktree and branch stay, and 꺼내기 brings it back to resume. Watching a session that runs
   * elsewhere just pauses; that session itself is left alone.
   */
  async archive(id) {
    const task = this.need(id);
    if (task.archived) return;
    task.archived = true;
    task.archivedAt = Date.now();
    this.watchers.delete(id);
    this.onGone?.(id);
    const r = this.rt.get(id);
    if (r) {
      const exited = new Promise((resolve) => r.proc.onExit(() => resolve()));
      r.proc.kill();
      await Promise.race([exited, delay(3000)]);
    }
    if (LIVE.has(task.state) && !task.watch) {
      task.state = 'exited';
      task.reason = '보관했어요 · 꺼내면 이어서 할 수 있어요';
    }
    this.store.save();
    this.changed();
  }

  /** Back from 보관함 the way it went in: stopped, ready to resume. */
  unarchive(id) {
    const task = this.need(id);
    if (!task.archived) return;
    task.archived = false;
    delete task.archivedAt;
    if (LIVE.has(task.state) && !task.watch) task.reason = '보관함에서 꺼냈어요 · 재개할 수 있어요';
    task.updatedAt = Date.now();
    this.store.save();
    this.changed();
  }

  rename(id, title) {
    const task = this.need(id);
    if (typeof title === 'string' && title.trim()) task.title = safeTyped(title).trim().slice(0, 80);
    this.store.save();
    this.changed();
  }

  // ------------------------------------------------------------ files

  async refreshChanges(task) {
    if (!task.repos.length) return null;
    try {
      const all = [];
      for (const x of task.repos) {
        if (!fs.existsSync(x.worktree)) continue;
        for (const f of await G.changes(x.worktree, await this.since(x))) all.push({ ...f, path: x.prefix + f.path, repo: x.name });
      }
      const c = { files: all.length, adds: all.reduce((a, f) => a + f.adds, 0), dels: all.reduce((a, f) => a + f.dels, 0) };
      const prev = task.changes;
      task.changes = c;
      if (!prev || prev.files !== c.files || prev.adds !== c.adds || prev.dels !== c.dels) {
        this.store.save();
        this.changed();
      }
      return all;
    } catch {
      return null;
    }
  }

  /** Where this repo's own changes start (it moves once the agent pulls main in); kept for the diff view. */
  async since(x) {
    x.since = await G.forkPoint(x.worktree, x.baseRef, await G.landingRefs(x.repo, x.worktree));
    return x.since;
  }

  async recount() {
    for (const t of this.store.tasks) if (!t.archived && LIVE.has(t.state) && t.repos.length) await this.refreshChanges(t);
  }

  async pollChanges() {
    for (const t of this.store.tasks) if ((t.state === 'working' || t.state === 'waiting') && this.rt.get(t.id)) await this.refreshChanges(t);
  }

  async changesOf(id) {
    const task = this.need(id);
    return (await this.refreshChanges(task)) || [];
  }

  async files(id) {
    const task = this.need(id);
    if (task.repos.length) {
      const out = [];
      for (const x of task.repos) if (fs.existsSync(x.worktree)) for (const f of await G.listFiles(x.worktree)) out.push(x.prefix + f);
      return out;
    }
    if (!fs.existsSync(task.cwd)) return [];
    if (await G.isRepo(task.cwd)) return G.listFiles(task.cwd);
    return walk(task.cwd);
  }

  /** Which repo a prefixed path belongs to, and the path inside it. */
  locate(task, rel) {
    for (const x of task.repos) if (!x.prefix || rel.startsWith(x.prefix)) return { repo: x, rest: x.prefix ? rel.slice(x.prefix.length) : rel };
    return { repo: null, rest: rel };
  }

  /** ref: "work" (this task), "base" (where its own work starts), "main" (project checkout), "task:<id>" */
  async file(id, rel, ref = 'work') {
    const task = this.need(id);
    if (typeof rel !== 'string' || !rel) throw httpError(400, 'bad path');
    const { repo, rest } = this.locate(task, rel);
    let root;
    if (!task.repos.length) {
      root = ref === 'main' || ref === 'work' ? task.cwd : null;
    } else if (!repo) {
      throw httpError(400, 'bad path');
    } else if (ref === 'base') {
      const content = await G.showAt(repo.worktree, await this.since(repo), rest);
      return { content, binary: content != null && isBinary(Buffer.from(content)) };
    } else if (ref === 'main') root = repo.repo;
    else if (ref === 'work') root = repo.worktree;
    else if (ref.startsWith('task:')) {
      const other = this.store.task(ref.slice(5));
      const o = other?.repos.find((y) => y.repo === repo.repo);
      if (!other || !o) throw httpError(404, 'task not found');
      root = o.worktree;
    }
    if (!root || !fs.existsSync(root)) return { content: null };
    const abs = resolveInside(root, task.repos.length ? rest : rel);
    if (!abs) throw httpError(400, 'bad path');
    try {
      const st = fs.lstatSync(abs);
      if (!st.isFile()) return { content: null };
      if (st.size > 3_000_000) return { content: null, tooLarge: true };
      const buf = fs.readFileSync(abs);
      if (isBinary(buf)) return { content: null, binary: true };
      return { content: buf.toString('utf8') };
    } catch {
      return { content: null };
    }
  }

  activity(id) {
    const task = this.need(id);
    return task.activity || emptyActivity();
  }

  need(id) {
    const t = this.store.task(id);
    if (!t) throw httpError(404, '작업을 찾을 수 없어요');
    return t;
  }

  /** Stops every agent; resolves once their terminals have closed (Windows needs a moment for ConPTY). */
  shutdown() {
    clearTimeout(this.recountTimer);
    clearInterval(this.changesTimer);
    clearInterval(this.codexTimer);
    clearInterval(this.watchTimer);
    const closed = [];
    for (const [, r] of this.rt) {
      closed.push(new Promise((resolve) => r.proc.onExit(() => resolve())));
      try {
        r.proc.kill();
      } catch {}
    }
    return Promise.all(closed);
  }
}

/**
 * A session id reported by an agent's hook is only adopted if Claude Code keeps that conversation
 * for this task's folder; an agent can't attach one of the person's other sessions to its task.
 */
/** Tools whose whole job is to ask the person something; the agent waits on the answer. */
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode']);

/** A menu on screen is a permission prompt ("Do you want to proceed?") or some other choice. */
function askOfMenu(menu) {
  if (!menu) return '';
  return /do you want|proceed|allow|permission|허용|권한/i.test(menu.question || '') ? 'permission' : 'choice';
}

const oneLine = (v, n) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/** "Bash · npm install", from a PermissionRequest: what exactly the agent wants to do. */
function permissionAsk(p) {
  const tool = String(p.tool_name || '');
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' · ') : tool || '도구';
  const i = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  const what = oneLine(i.command || i.file_path || i.url || i.path || i.pattern || i.description || '', 120);
  return `허락을 기다려요 · ${name}${what ? `: ${what}` : ''}`;
}

/** The question an AskUserQuestion puts to the person, or the plan waiting for approval. */
function choiceAsk(p) {
  if (p.tool_name === 'ExitPlanMode') return '계획을 승인할지 기다려요';
  const qs = Array.isArray(p.tool_input?.questions) ? p.tool_input.questions : [];
  const q = oneLine(qs[0]?.question, 140);
  return q ? `${q}${qs.length > 1 ? ` 외 ${qs.length - 1}개` : ''}` : '선택을 기다려요';
}

const BG_KIND = { shell: '셸', subagent: '서브에이전트', monitor: '모니터', workflow: '워크플로', teammate: '팀원', 'cloud session': '클라우드 세션', 'MCP task': 'MCP 작업' };

/**
 * What a finished Claude turn still waits on, in words, or '' when nothing will wake it: its Stop
 * hook lists the background work in flight (shells, subagents, monitors…) and scheduled wakeups.
 */
export function pendingOf(p) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const tasks = list(p.background_tasks).filter((b) => !/^(completed|failed|killed|stopped|cancell?ed|done|error)$/i.test(String(b.status || '')));
  const crons = list(p.session_crons);
  if (!tasks.length && !crons.length) return '';
  const head = tasks.length ? '백그라운드 작업이 끝나면 이어서 해요' : '예약한 때가 되면 이어서 해요';
  const kind = (b) => BG_KIND[b.type] || '작업';
  if (tasks.length === 1 && !crons.length) {
    const b = tasks[0];
    const what = String(b.description || b.command || b.agent_type || b.name || '').replace(/\s+/g, ' ').trim();
    return `${head} · ${kind(b)}${what ? `: ${what.length > 80 ? what.slice(0, 79) + '…' : what}` : ''}`;
  }
  const n = new Map();
  for (const b of tasks) n.set(kind(b), (n.get(kind(b)) || 0) + 1);
  if (crons.length) n.set('예약', crons.length);
  return `${head} · ${[...n].map(([k, c]) => `${k} ${c}개`).join(', ')}`;
}

function transcriptBelongs(sessionId, cwd) {
  const f = claudeTranscriptOf(sessionId);
  if (!f) return false;
  let real = cwd;
  try {
    real = realPath(cwd);
  } catch {}
  return path.basename(path.dirname(f)) === real.replace(/[^a-zA-Z0-9]/g, '-');
}

/** 0.1 tasks had one repo in flat fields. */
function migrate(t) {
  if (!Array.isArray(t.repos)) {
    t.repos = t.isolated && t.repo ? [{ name: path.basename(t.repo), prefix: '', repo: t.repo, worktree: t.worktree, branch: t.branch, baseRef: t.baseRef }] : [];
    t.cwd = t.worktree;
    for (const m of t.messages || []) if (m.snap && !Array.isArray(m.snap)) m.snap = [{ i: 0, ...m.snap }];
    if (t.prUrl && !t.prUrls) t.prUrls = [{ name: path.basename(t.repo || ''), url: t.prUrl }];
    for (const k of ['repo', 'worktree', 'branch', 'baseRef', 'isolated', 'prUrl']) delete t[k];
  }
  if (!t.activity) t.activity = emptyActivity();
}

function folderName(name, fallback) {
  const s = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || String(fallback || 'repo').toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'repo';
}

function workspaceGuide(repos) {
  return `# 작업 폴더 (Agent Desk)

이 폴더에는 이번 작업에 쓰는 git 저장소들이 들어 있어요. 각 폴더는 독립된 git worktree예요.

${repos.map((r) => `- \`${r.name}/\` · 브랜치 \`${r.branch}\``).join('\n')}

- 저장소마다 따로 커밋하세요 (\`cd <폴더> && git commit\`).
- 이 폴더 자체는 git 저장소가 아니에요. 여기 있는 이 파일은 고치지 마세요.
`;
}

/** Keep printable text, tabs and newlines; drop every other C0/C1 control and DEL. */
export function safeTyped(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/[\u2028\u2029]/g, '\n');
}

function titleOf(prompt) {
  const first = prompt.split('\n').find((l) => l.trim()) || prompt;
  const t = first.trim().replace(/\s+/g, ' ');
  return t.length > 60 ? t.slice(0, 58) + '…' : t;
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function walk(root, max = 20000) {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.venv', 'venv', '__pycache__']);
  const go = (dir, rel) => {
    if (out.length >= max) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) go(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  go(root, '');
  return out;
}
