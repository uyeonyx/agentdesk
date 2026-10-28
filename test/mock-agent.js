#!/usr/bin/env node
// Behaves enough like `claude` / `codex` for tests: takes a prompt, streams output, edits files,
// shows a numbered permission menu, runs "subagents", keeps a plan, and fires the same
// hooks / notify / session-log entries the real CLIs produce.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const kind = process.env.MOCK_KIND || 'claude';
const argv = process.argv.slice(2);

// `claude agents --json` / `claude stop <id>`: the live-session list lives in a JSON file.
const liveFile = process.env.MOCK_LIVE_FILE;
if (kind === 'claude' && argv[0] === 'agents') {
  // Some machines take seconds to answer this; tests can simulate that.
  const ms = Number(process.env.MOCK_AGENTS_DELAY_MS || 0);
  if (ms) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  process.stdout.write(liveFile && fs.existsSync(liveFile) ? fs.readFileSync(liveFile, 'utf8') : '[]');
  process.exit(0);
}
if (kind === 'claude' && argv[0] === 'stop') {
  if (liveFile && fs.existsSync(liveFile)) {
    const list = JSON.parse(fs.readFileSync(liveFile, 'utf8')).filter((s) => s.id !== argv[1] && s.sessionId !== argv[1]);
    fs.writeFileSync(liveFile, JSON.stringify(list));
  }
  if (process.env.MOCK_STOP_LOG) fs.appendFileSync(process.env.MOCK_STOP_LOG, argv[1] + '\n');
  process.exit(0);
}

if (kind === 'codex' && argv[0] === 'queue') {
  const get = (k) => (argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
  if (process.env.MOCK_QUEUE_LOG) fs.appendFileSync(process.env.MOCK_QUEUE_LOG, JSON.stringify({ thread: get('thread'), message: get('message') }) + '\n');
  process.exit(0);
}

let hooks = {};
let notify;
let prompt;
let resume = false;
let resumeId;
let fork = false;
let sessionArg;
let remote = false;
let name = '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eq = a.match(/^(--[\w-]+)=(.*)$/s);
  if (eq && eq[1] === '--resume') {
    resume = true;
    resumeId = eq[2];
  } else if (eq && eq[1] === '--session-id') sessionArg = eq[2];
  else if (eq && eq[1] === '--remote-control') remote = eq[2] || true;
  else if (eq && eq[1] === '--name') name = eq[2];
  else if (a === '--fork-session') fork = true;
  else if ((a === 'resume' || a === 'fork') && kind === 'codex' && argv[i + 1] && argv[i + 1] !== '--last') {
    resume = true;
    fork = a === 'fork';
    resumeId = argv[++i];
  } else if (a === '--settings') {
    const s = JSON.parse(argv[++i]);
    for (const [ev, list] of Object.entries(s.hooks || {})) hooks[ev] = list?.[0]?.hooks?.[0];
  } else if (a === '-c') {
    const v = argv[++i];
    if (v.startsWith('notify=')) notify = JSON.parse(v.slice(7));
  } else if (a === '--continue' || a === 'resume' || a === '--last') resume = true;
  else prompt = a.trim();
}
if (resumeId === '00000000-0000-4000-8000-000000000000') {
  process.stdout.write(`No conversation found with session ID: ${resumeId}\r\n`);
  process.exit(1);
}
const sid = sessionArg || (resumeId && !fork ? resumeId : randomUUID());

// Like Claude Code: <config>/projects/<cwd with every non-alnum as "-">/<session>.jsonl
let transcript;
const transcriptPath = () => {
  if (transcript) return transcript;
  const dir = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-')) : process.env.MOCK_TRANSCRIPT_DIR || os.tmpdir();
  fs.mkdirSync(dir, { recursive: true });
  transcript = path.join(dir, `${sid}.jsonl`);
  return transcript;
};
const W = (s) => process.stdout.write(s);
let n = 0;
let tid = 0;

function hook(event, extra = {}) {
  if (kind !== 'claude') return;
  const h = hooks[event];
  if (!h?.command) return;
  // Like Claude Code: exec form (`args` present) runs the program directly, shell form goes through sh.
  const p = Array.isArray(h.args) ? spawn(h.command, h.args, { stdio: ['pipe', 'ignore', 'ignore'] }) : spawn('sh', ['-c', h.command], { stdio: ['pipe', 'ignore', 'ignore'] });
  p.on('error', () => {});
  p.stdin.end(JSON.stringify({ hook_event_name: event, session_id: sid, transcript_path: transcriptPath(), cwd: process.cwd(), ...extra }));
}
const tool = (name, input, extra = {}) => {
  const id = `tu_${++tid}`;
  hook('PreToolUse', { tool_name: name, tool_input: input, tool_use_id: id, ...extra });
  return (response = {}, failed = false) => hook(failed ? 'PostToolUseFailure' : 'PostToolUse', { tool_name: name, tool_input: input, tool_use_id: id, tool_response: response, ...extra });
};

// Codex writes a session log; the daemon follows it.
let rollout;
function codexLog(obj) {
  if (kind !== 'codex') return;
  if (!rollout) {
    const dir = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions', '2026', '10', '22');
    fs.mkdirSync(dir, { recursive: true });
    rollout = path.join(dir, `rollout-${Date.now()}-${process.pid}.jsonl`);
    fs.writeFileSync(rollout, JSON.stringify({ type: 'session_meta', payload: { id: sid, cwd: process.cwd() } }) + '\n');
  }
  fs.appendFileSync(rollout, JSON.stringify(obj) + '\n');
}
const codexCall = (name, args) => {
  const id = `call_${++tid}`;
  codexLog({ type: 'response_item', payload: { type: 'function_call', name, arguments: JSON.stringify(args), call_id: id } });
  return id;
};
const notifyCodex = (obj) => kind === 'codex' && notify && spawn(notify[0], [...notify.slice(1), JSON.stringify(obj)], { stdio: 'ignore' });

let busy = null;
let menuOpen = false;
let pendingAfterMenu = null;

function finish(text) {
  let reply;
  if (/no changes|just answer|질문/i.test(text)) {
    reply = `Answer: ${text}`;
  } else {
    n++;
    const m = text.match(/create (\S+)/i);
    let file = m ? m[1] : `notes/change-${n}.md`;
    for (const [re, f] of JSON.parse(process.env.MOCK_FILES || '[]')) if (new RegExp(re, 'i').test(text)) file = f;
    const done = tool('Write', { file_path: path.resolve(file), content: '...' });
    const cdone = codexCall('apply_patch', { input: `*** Begin Patch\n*** Update File: ${file}\n*** End Patch` });
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    if (fs.existsSync(file)) {
      const src = fs.readFileSync(file, 'utf8').split('\n');
      src.splice(Math.min(3, src.length), 0, `// ${text}`, `const urgentWithinHours = 24;`);
      fs.writeFileSync(file, src.join('\n').replace('fontSize: 22', 'fontSize: 24, fontWeight: "700"'));
    } else {
      fs.writeFileSync(file, `# ${text.replace(/^create \S+\s*/, '')}\n\n- 로테이션 주기: 90일 이하\n- 만료 7일 전 알림\n- 이전 키는 30일간 복호화 전용으로 유지\n`);
    }
    // Multi-repo task folders: touch a file in every repo folder we can see.
    if (/every repo|모든 저장소/.test(text)) {
      for (const d of fs.readdirSync('.', { withFileTypes: true })) if (d.isDirectory() && fs.existsSync(path.join(d.name, '.git'))) fs.appendFileSync(path.join(d.name, 'CHANGES.md'), `- ${text}\n`);
    }
    if (fs.existsSync('README.md')) fs.appendFileSync('README.md', `\n- ${text.replace(/^create \S+\s*/, '')}\n`);
    done({ success: true });
    codexLog({ type: 'response_item', payload: { type: 'function_call_output', call_id: cdone, output: 'Done' } });
    reply = `${file}를 업데이트했어요. ${text.replace(/^create \S+\s*/, '')} 반영 완료.`;
  }
  fs.appendFileSync(transcriptPath(), JSON.stringify({ type: 'assistant', cwd: process.cwd(), sessionId: sid, message: { content: [{ type: 'text', text: reply }] } }) + '\n');
  codexLog({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'agent_message', message: reply } });
  W(`\r\x1b[2K\x1b[32m⏺\x1b[0m ${reply}\r\n\r\n> `);
  if (/background|백그라운드/i.test(text) && kind === 'claude') {
    // Like a build left running with run_in_background: the turn ends, then its finish wakes Claude.
    hook('Stop', { last_assistant_message: reply, background_tasks: [{ id: 'bg-1', type: 'shell', status: 'running', description: 'npm run build', command: 'npm run build' }], session_crons: [] });
    setTimeout(() => {
      tool('Bash', { command: 'tail build.log' })({ stdout: 'built' });
      setTimeout(() => {
        fs.appendFileSync(transcriptPath(), JSON.stringify({ type: 'assistant', cwd: process.cwd(), sessionId: sid, message: { content: [{ type: 'text', text: '빌드가 끝났어요' }] } }) + '\n');
        W(`\r\x1b[2K\x1b[32m⏺\x1b[0m 빌드가 끝났어요\r\n\r\n> `);
        hook('Stop', { last_assistant_message: '빌드가 끝났어요', background_tasks: [], session_crons: [] });
      }, 400);
    }, +(process.env.MOCK_BG_MS || 1500));
    return;
  }
  hook('Stop', { last_assistant_message: reply });
  notifyCodex({ type: 'agent-turn-complete', 'last-assistant-message': reply });
}

function work(text) {
  if (text.startsWith('[취소]')) {
    hook('UserPromptSubmit', { prompt: text });
    W(`\r\n\x1b[32m⏺\x1b[0m 알겠어요. 그 지시는 무시할게요.\r\n\r\n> `);
    hook('Stop', {});
    notifyCodex({ type: 'agent-turn-complete', 'last-assistant-message': '알겠어요' });
    return;
  }
  hook('UserPromptSubmit', { prompt: text });
  // Both agents keep the conversation on disk, prompt and reply, the way the real ones do.
  if (kind === 'claude') fs.appendFileSync(transcriptPath(), JSON.stringify({ type: 'user', cwd: process.cwd(), sessionId: sid, timestamp: new Date().toISOString(), message: { role: 'user', content: text } }) + '\n');
  codexLog({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'user_message', message: text } });
  W(`\r\n\x1b[36m⏺\x1b[0m ${text}\r\n`);
  if (/plan|계획/i.test(text)) {
    const todos = [
      { content: '요구사항 정리', status: 'completed', activeForm: '요구사항 정리 중' },
      { content: '구현', status: 'in_progress', activeForm: '구현 중' },
      { content: '테스트 작성', status: 'pending', activeForm: '테스트 작성 중' },
    ];
    tool('TodoWrite', { todos })({});
    codexCall('update_plan', { plan: todos.map((t) => ({ step: t.content, status: t.status })) });
  }
  if (/subagent|서브/i.test(text)) {
    const end = tool('Agent', { description: '테스트 작성', subagent_type: 'general-purpose', prompt: 'write tests' });
    codexCall('spawn_agent', { task_name: '테스트 작성', message: 'write tests' });
    setTimeout(() => hook('SubagentStart', { agent_id: 'sub-1', agent_type: 'general-purpose' }), 60);
    setTimeout(() => tool('Bash', { command: 'npm test -- --watch=false' }, { agent_id: 'sub-1', agent_type: 'general-purpose' })({ stdout: 'ok' }), 160);
    setTimeout(() => {
      hook('SubagentStop', { agent_id: 'sub-1', agent_type: 'general-purpose', last_assistant_message: '테스트 3개를 추가했어요' });
      end({});
    }, /slow|천천히/i.test(text) ? 600000 : 300);
    if (/slow|천천히/i.test(text)) {
      const end2 = tool('Agent', { description: '서브넷 모듈 문서 조사', subagent_type: 'Explore', prompt: 'read docs' });
      setTimeout(() => hook('SubagentStart', { agent_id: 'sub-2', agent_type: 'Explore' }), 90);
      setTimeout(() => tool('Grep', { pattern: 'cidr_block' }, { agent_id: 'sub-2', agent_type: 'Explore' })({}), 200);
      setTimeout(() => tool('Read', { file_path: path.resolve('main.tf') }, { agent_id: 'sub-2', agent_type: 'Explore' })({}), 300);
      setTimeout(() => {
        hook('SubagentStop', { agent_id: 'sub-2', agent_type: 'Explore', last_assistant_message: '모듈 3개로 나누면 돼요' });
        end2({});
      }, 500);
    }
  }
  const bash = /test|테스트/i.test(text) ? tool('Bash', { command: 'npm test' }) : null;
  const ccall = bash ? codexCall('exec_command', { cmd: 'npm test' }) : null;
  let ticks = 0;
  busy = setInterval(() => W(`\r\x1b[2K\x1b[33m✻ Thinking… ${(++ticks / 10).toFixed(1)}s (esc to interrupt)\x1b[0m`), 100);
  setTimeout(
    () => {
      if (!busy) return;
      clearInterval(busy);
      busy = null;
      bash?.({ exit_code: 0 });
      if (ccall) codexLog({ type: 'response_item', payload: { type: 'function_call_output', call_id: ccall, output: 'Exit code: 0' } });
      if (/askq/i.test(text)) {
        // Claude Code's AskUserQuestion form: tabs, descriptions under options, a separator.
        W(
          '\r\n\x1b[2K────────────────────────────────────────\r\n' +
            '←  ☐ 주제  ☐ 범위  ✔ Submit  →\r\n\r\n' +
            '테스트용 계획을 어떤 주제로 세울까요?\r\n\r\n' +
            '  1. 누름 깊이 테스트 (추천)\r\n' +
            '     키캡·버튼이 누르면 두께만큼 가라앉는지 검증합니다.\r\n' +
            '     범위가 작아 테스트용으로 알맞습니다.\r\n' +
            '  2. v1 tokens.css 제거 준비\r\n' +
            '     v1 이름을 아직 쓰는 곳을 찾아 목록을 만듭니다.\r\n' +
            '  3. 대비 쌍 누락 점검\r\n' +
            '     빠진 쌍을 찾아 추가합니다.\r\n' +
            '❯ 4. 카톤 문서 페이지\r\n' +
            '     재질 소개 페이지를 추가합니다.\r\n' +
            '  5. Type something.\r\n' +
            '────────────────────────────────────────\r\n' +
            '  6. Chat about this\r\n\r\n' +
            'Enter to select · Tab/Arrow keys to navigate · Esc to cancel\r\n'
        );
        menuOpen = 6;
        pendingAfterMenu = text;
        // Like Claude Code: the AskUserQuestion call goes out first, the generic notification ~6 s later.
        tool('AskUserQuestion', { questions: [{ question: '테스트용 계획을 어떤 주제로 세울까요?', header: '주제', options: [{ label: '누름 깊이 테스트' }, { label: 'v1 tokens.css 제거 준비' }], multiSelect: false }] });
        hook('Notification', { message: 'Claude needs your permission', notification_type: 'permission_prompt' });
        return;
      }
      if (/ask/i.test(text)) {
        W(
          '\r\n\x1b[2K╭──────────────────────────────────────────╮\r\n│ Bash command                             │\r\n│   rm -rf build                           │\r\n│ Do you want to proceed?                  │\r\n│ ❯ 1. Yes                                 │\r\n│   2. Yes, and don\'t ask again            │\r\n│   3. No, and tell Claude what to do      │\r\n╰──────────────────────────────────────────╯\r\n'
        );
        menuOpen = 3;
        pendingAfterMenu = text;
        hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Remove build' } });
        hook('Notification', { message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' });
        notifyCodex({ type: 'approval-requested', message: 'rm -rf build' });
        return;
      }
      finish(text);
    },
    /slow|천천히/i.test(text) ? 600000 : Number(process.env.MOCK_WORK_MS || 1200)
  );
}

const remoteLine = () => W(`\r\n\x1b[2m/remote-control is active · Continue on your phone: https://claude.ai/code/session_mock${String(process.pid)}\x1b[0m\r\n> `);
W(`\x1b[1mMock ${kind}\x1b[0m ${resume ? `(resumed${resumeId ? ' ' + resumeId : ''}${fork ? ' as fork' : ''})` : ''} session ${sid} ${name ? `"${name}"` : ''} in ${process.cwd()}\r\n> `);
if (remote) setTimeout(remoteLine, 50);
if (prompt) setTimeout(() => work(prompt), 200);

// The "phone": lines appended to <MOCK_REMOTE_DIR>/<session>.txt arrive as prompts, like Remote Control.
if (process.env.MOCK_REMOTE_DIR) {
  const inbox = path.join(process.env.MOCK_REMOTE_DIR, `${sid}.txt`);
  let seen = 0;
  setInterval(() => {
    if (!remote || !fs.existsSync(inbox)) return;
    const lines = fs.readFileSync(inbox, 'utf8').split('\n').filter(Boolean);
    for (const l of lines.slice(seen)) work(l);
    seen = lines.length;
  }, 100);
}

let buf = '';
process.stdin.setRawMode?.(true);
process.stdin.on('data', (d) => {
  let s = d.toString('utf8');
  if (s === '\x1b') {
    if (busy) {
      clearInterval(busy);
      busy = null;
      W('\r\n\x1b[31mInterrupted\x1b[0m\r\n> ');
    }
    return;
  }
  if (s === '\x03') process.exit(0);
  if (menuOpen && new RegExp(`^[1-${menuOpen === 6 ? 6 : 3}]$`).test(s)) {
    menuOpen = false;
    W(`\r\n선택: ${s}\r\n`);
    if (s === '3') {
      W('\x1b[31m취소했어요\x1b[0m\r\n\r\n> ');
      hook('Stop', {});
    } else finish(pendingAfterMenu);
    return;
  }
  // Bracketed paste arrives as one block (shown in the input, not submitted), like the real CLIs.
  const paste = s.match(/\x1b\[200~([\s\S]*?)\x1b\[201~/);
  if (paste) {
    const t = paste[1].replace(/\r/g, ' ');
    buf += t;
    W(t);
    s = s.replace(paste[0], '');
  }
  s = s.replace(/\x1b\[20[01]~/g, '');
  for (const ch of s) {
    if (ch === '\r' || ch === '\n') {
      const line = buf.trim();
      buf = '';
      if (line === '/remote-control') {
        remote = true;
        remoteLine();
      } else if (line) work(line);
    } else if (ch === '\x7f') {
      buf = buf.slice(0, -1);
      W('\b \b');
    } else {
      buf += ch;
      W(ch);
    }
  }
});
