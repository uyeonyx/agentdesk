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
const codexNew = process.env.MOCK_CODEX_FORMAT === 'new';

// Transcript lines the way Claude Code writes them: a uuid chain with timestamps. A subagent's
// lines go to <session>/subagents/agent-<id>.jsonl, with a meta file naming the Agent call.
const last = {};
const agentCalls = []; // Agent tool calls not yet matched to a subagent, oldest first
const subFiles = {};
function tline(obj, sub) {
  if (kind !== 'claude') return;
  let file = transcriptPath();
  if (sub) {
    if (!subFiles[sub]) {
      const dir = path.join(path.dirname(file), sid, 'subagents');
      fs.mkdirSync(dir, { recursive: true });
      subFiles[sub] = path.join(dir, `agent-${sub}.jsonl`);
      const call = agentCalls.shift() || {};
      fs.writeFileSync(path.join(dir, `agent-${sub}.meta.json`), JSON.stringify({ agentType: call.type || 'general-purpose', description: call.desc || '', toolUseId: call.id || '' }));
      fs.writeFileSync(subFiles[sub], '');
      tline({ type: 'user', message: { role: 'user', content: call.prompt || '' } }, sub);
    }
    file = subFiles[sub];
  }
  const uuid = randomUUID();
  const key = sub || '';
  fs.appendFileSync(file, JSON.stringify({ parentUuid: last[key] || null, isSidechain: !!sub, ...(sub ? { agentId: sub } : {}), uuid, timestamp: new Date().toISOString(), cwd: process.cwd(), sessionId: sid, ...obj }) + '\n');
  last[key] = uuid;
}
const userLine = (text) => tline({ type: 'user', message: { role: 'user', content: text } });
const replyLine = (text) => tline({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const thinkLine = (text) => tline({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: text, signature: 'mock' }] } });

/** What Claude Code keeps about a finished tool call (toolUseResult), close enough to the real shapes. */
function richResult(name, input, res) {
  if (name === 'Bash') return { stdout: res.stdout || '', stderr: res.stderr || '', interrupted: false, isImage: false };
  if (name === 'Write' || name === 'Edit') return { filePath: input.file_path, ...res };
  if (name === 'Read') return { type: 'text', file: { filePath: input.file_path, content: '', numLines: 3, startLine: 1, totalLines: 3 } };
  if (name === 'Agent') return { agentId: res.agentId || '', content: [{ type: 'text', text: res.text || '' }] };
  return res;
}
const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

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
  const id = `toolu_mock${String(++tid).padStart(4, '0')}`;
  const sub = extra.agent_id;
  if (name === 'Agent') agentCalls.push({ id, type: input.subagent_type, desc: input.description, prompt: input.prompt });
  tline({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }, sub);
  hook('PreToolUse', { tool_name: name, tool_input: input, tool_use_id: id, ...extra });
  return (response = {}, failed = false, rich) => {
    const text = failed === 'rejected' ? REJECTED : failed ? `Exit code 1\n${response.stdout || ''}` : response.stdout || response.text || 'ok';
    tline({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, ...(failed ? { is_error: true } : {}) }] }, toolUseResult: failed === 'rejected' ? `Error: ${REJECTED}` : rich || richResult(name, input, response) }, sub);
    hook(failed ? 'PostToolUseFailure' : 'PostToolUse', { tool_name: name, tool_input: input, tool_use_id: id, tool_response: response, ...extra });
  };
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
const ts = () => new Date().toISOString();
const codexCall = (name, args) => {
  const id = `call_${++tid}`;
  if (codexNew && (name === 'exec_command' || name === 'shell')) {
    // Newer Codex: commands run inside a JS `exec` wrapper; the command shows up when it's done.
    codexLog({ timestamp: ts(), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: `await tools.exec_command({ cmd: ${JSON.stringify(args.cmd)} })`, call_id: id } });
    return { id, cmd: args.cmd };
  }
  codexLog({ timestamp: ts(), type: 'response_item', payload: { type: 'function_call', name, arguments: JSON.stringify(args), call_id: id } });
  return id;
};
function codexDone(call, output, exit = 0) {
  if (call && typeof call === 'object') {
    codexLog({ timestamp: ts(), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', id: `exec-${call.id}`, command: ['/bin/zsh', '-lc', call.cmd], cwd: process.cwd(), aggregated_output: output, exit_code: exit, duration: { secs: 0, nanos: 300000000 } } } });
    codexLog({ timestamp: ts(), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: call.id, output: [{ type: 'input_text', text: output }] } });
  } else if (call) codexLog({ timestamp: ts(), type: 'response_item', payload: { type: 'function_call_output', call_id: call, output: `Exit code: ${exit}\nOutput:\n${output}` } });
}
function codexSay(role, text) {
  if (codexNew) codexLog({ timestamp: ts(), type: 'event_msg', payload: { type: 'item_completed', item: role === 'user' ? { type: 'UserMessage', content: [{ type: 'text', text }] } : { type: 'AgentMessage', id: `msg_${++tid}`, content: [{ type: 'text', text }], phase: 'final_answer' } } });
  else codexLog({ timestamp: ts(), type: 'event_msg', payload: role === 'user' ? { type: 'user_message', message: text } : { type: 'agent_message', message: text } });
}
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
    const existed = fs.existsSync(file);
    const before = existed ? fs.readFileSync(file, 'utf8') : '';
    let after;
    if (existed) {
      const src = before.split('\n');
      src.splice(Math.min(3, src.length), 0, `// ${text}`, `const urgentWithinHours = 24;`);
      after = src.join('\n').replace('fontSize: 22', 'fontSize: 24, fontWeight: "700"');
    } else {
      after = `# ${text.replace(/^create \S+\s*/, '')}\n\n- 로테이션 주기: 90일 이하\n- 만료 7일 전 알림\n- 이전 키는 30일간 복호화 전용으로 유지\n`;
    }
    const done = tool('Write', { file_path: path.resolve(file), content: after });
    const cdone = codexCall('apply_patch', { input: `*** Begin Patch\n*** ${existed ? 'Update' : 'Add'} File: ${file}\n${(existed ? before.split('\n').map((l) => '-' + l) : []).concat(after.split('\n').map((l) => '+' + l)).join('\n')}\n*** End Patch` });
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, after);
    const patch = [{ oldStart: existed ? 1 : 0, oldLines: existed ? before.split('\n').length : 0, newStart: 1, newLines: after.split('\n').length, lines: (existed ? before.split('\n').map((l) => '-' + l) : []).concat(after.split('\n').map((l) => '+' + l)) }];
    // Multi-repo task folders: touch a file in every repo folder we can see.
    if (/every repo|모든 저장소/.test(text)) {
      for (const d of fs.readdirSync('.', { withFileTypes: true })) if (d.isDirectory() && fs.existsSync(path.join(d.name, '.git'))) fs.appendFileSync(path.join(d.name, 'CHANGES.md'), `- ${text}\n`);
    }
    if (fs.existsSync('README.md')) fs.appendFileSync('README.md', `\n- ${text.replace(/^create \S+\s*/, '')}\n`);
    done({ success: true }, false, { type: existed ? 'update' : 'create', filePath: path.resolve(file), content: after, structuredPatch: patch, originalFile: existed ? before : null });
    codexLog({ timestamp: ts(), type: 'response_item', payload: { type: 'function_call_output', call_id: cdone, output: 'Done' } });
    reply = `${file}를 업데이트했어요. ${text.replace(/^create \S+\s*/, '')} 반영 완료.`;
  }
  replyLine(/markdown|마크다운/i.test(text) ? `${reply}\n\n## 정리\n\n- **굵게** 쓴 항목\n- \`src/app.ts:12\` 참고\n\n\`\`\`ts\nconst x: number = 1;\n\`\`\`\n\n<b>태그는 글자로</b>` : reply);
  codexSay('assistant', reply);
  if (codexNew) codexLog({ timestamp: ts(), type: 'event_msg', payload: { type: 'task_complete', duration_ms: 900, last_agent_message: reply } });
  W(`\r\x1b[2K\x1b[32m⏺\x1b[0m ${reply}\r\n\r\n> `);
  if (/background|백그라운드/i.test(text) && kind === 'claude') {
    // Like a build left running with run_in_background: the turn ends, then its finish wakes Claude.
    hook('Stop', { last_assistant_message: reply, background_tasks: [{ id: 'bg-1', type: 'shell', status: 'running', description: 'npm run build', command: 'npm run build' }], session_crons: [] });
    setTimeout(() => {
      tool('Bash', { command: 'tail build.log' })({ stdout: 'built' });
      setTimeout(() => {
        replyLine('빌드가 끝났어요');
        W(`\r\x1b[2K\x1b[32m⏺\x1b[0m 빌드가 끝났어요\r\n\r\n> `);
        hook('Stop', { last_assistant_message: '빌드가 끝났어요', background_tasks: [], session_crons: [] });
      }, 400);
    }, +(process.env.MOCK_BG_MS || 1500));
    return;
  }
  tline({ type: 'system', subtype: 'turn_duration', durationMs: 900, isMeta: false });
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
  userLine(text);
  thinkLine('요청을 살펴보는 중');
  if (codexNew) codexLog({ timestamp: ts(), type: 'event_msg', payload: { type: 'task_started', turn_id: `turn_${++tid}` } });
  codexSay('user', text);
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
      end({ agentId: 'sub-1', text: '테스트 3개를 추가했어요' });
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
      bash?.({ exit_code: 0, stdout: 'Tests: 3 passed' });
      if (ccall) codexDone(ccall, 'Tests: 3 passed', 0);
      if (/askedit/i.test(text)) return askEdit(text);
      if (/askq2/i.test(text)) return askQuestions(text);
      if (/planmode/i.test(text)) return planMode(text);
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

// ---------------------------------------------------------------- prompts that wait on a person
// Each one draws the CLI's screen and takes over the keyboard until it's answered.
let form = null; // (key) => void while a form owns stdin

/** An Edit that needs permission: the permission box, then the edit applied (or rejected). */
function askEdit(text) {
  const file = path.resolve('README.md');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# readme\n';
  const old = before.split('\n')[0];
  const input = { file_path: file, old_string: old, new_string: '# 바뀐 제목' };
  const done = tool('Edit', input);
  W('\r\n\x1b[2K' + '─'.repeat(60) + '\r\n Edit file\r\n README.md\r\n  1 -' + old + '\r\n  1 +# 바뀐 제목\r\n Do you want to make this edit to README.md?\r\n ❯ 1. Yes\r\n   2. Yes, allow all edits during this session (shift+tab)\r\n   3. No, and tell Claude what to do differently (esc)\r\n');
  hook('PermissionRequest', { tool_name: 'Edit', tool_input: input });
  form = (k) => {
    if (!/^[123]$/.test(k)) return;
    form = null;
    if (k === '3') {
      done({}, 'rejected');
      W('\r\n\x1b[31m  ⎿  거절됨\x1b[0m\r\n\r\n> ');
      hook('Stop', {});
      return;
    }
    const after = before.replace(old, '# 바뀐 제목');
    fs.writeFileSync(file, after);
    done({ success: true }, false, { filePath: file, oldString: old, newString: '# 바뀐 제목', originalFile: before, replaceAll: false, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-' + old, '+# 바뀐 제목'] }] });
    finish('just answer: 제목을 바꿨어요');
  };
}

/** AskUserQuestion with two questions (one multi-select), a free-text option, and a review step. */
function askQuestions(text) {
  const questions = [
    { question: '어떤 주제로 할까요?', header: '주제', multiSelect: false, options: [{ label: '누름 깊이 테스트', description: '버튼이 눌리는 깊이' }, { label: '토큰 정리', description: '안 쓰는 토큰 지우기' }] },
    { question: '어디까지 바꿀까요?', header: '범위', multiSelect: true, options: [{ label: '버튼' }, { label: '입력창' }, { label: '카드' }] },
  ];
  const done = tool('AskUserQuestion', { questions });
  const answers = {};
  const checked = new Set();
  let typing = null;
  const tabs = (i) => '←  ' + questions.map((q, k) => `${k < i ? '✔' : '☐'} ${q.header}`).join('  ') + `  ${i >= questions.length ? '✔' : '☐'} Submit  →`;
  const draw = (i) => {
    W('\x1b[2J\x1b[H');
    if (i >= questions.length) {
      W(`${tabs(i)}\r\n\r\nReview your answers\r\n\r\n` + questions.map((q) => ` ● ${q.header} → ${answers[q.question]}\r\n`).join('') + '\r\nReady to submit your answers?\r\n\r\n❯ 1. Submit answers\r\n  2. Cancel\r\n');
      return;
    }
    const q = questions[i];
    const opts = q.options.map((o, k) => `  ${k + 1}. ${q.multiSelect ? `[${checked.has(o.label) ? '✔' : ' '}] ` : ''}${o.label}\r\n${o.description ? `     ${o.description}\r\n` : ''}`).join('');
    const n = q.options.length;
    W(`${tabs(i)}\r\n\r\n${q.question}\r\n\r\n${opts}  ${n + 1}. Type something.${typing !== null ? ' ' + typing : ''}\r\n${q.multiSelect ? `  ${n + 2}. Next\r\n` : ''}\r\nEnter to select · Esc to cancel\r\n`);
  };
  let i = 0;
  const next = (answer) => {
    answers[questions[i].question] = answer;
    i++;
    checked.clear();
    draw(i);
  };
  draw(0);
  form = (k) => {
    if (typing !== null) {
      if (k === '\r') {
        const t = typing;
        typing = null;
        return next(t.trim());
      }
      typing += k.replace(/[\r\n]/g, '');
      return draw(i);
    }
    if (i >= questions.length) {
      if (k === '1') {
        form = null;
        done({}, false, { questions, answers, annotations: {} });
        return finish('just answer: 답을 받았어요');
      }
      if (k === '2') {
        form = null;
        done({}, 'rejected');
        W('\r\n> ');
        hook('Stop', {});
      }
      return;
    }
    const q = questions[i];
    const n = q.options.length;
    const d = Number(k);
    if (d >= 1 && d <= n) {
      if (!q.multiSelect) return next(q.options[d - 1].label);
      const l = q.options[d - 1].label;
      checked.has(l) ? checked.delete(l) : checked.add(l);
      return draw(i);
    }
    if (d === n + 1) {
      typing = '';
      return draw(i);
    }
    if ((q.multiSelect && d === n + 2) || k === '\x1b[C') return next(q.options.map((o) => o.label).filter((l) => checked.has(l)).join(', '));
  };
}

/** ExitPlanMode: the plan, then the approval menu. */
function planMode(text) {
  const plan = '# 계획\n\n1. 버튼 크기를 키운다\n2. 테스트를 추가한다';
  const done = tool('ExitPlanMode', { plan });
  W('\r\n\x1b[2K' + plan.replace(/\n/g, '\r\n') + '\r\n\r\n Would you like to proceed?\r\n\r\n ❯ 1. Yes, and auto-accept edits\r\n   2. Yes, and manually approve edits\r\n   3. No, keep planning\r\n');
  hook('PermissionRequest', { tool_name: 'ExitPlanMode', tool_input: { plan } });
  form = (k) => {
    if (!/^[123]$/.test(k)) return;
    form = null;
    if (k === '3') {
      done({}, 'rejected');
      W('\r\n> ');
      hook('Stop', {});
      return;
    }
    done({}, false, { plan, filePath: '', isAgent: false });
    finish('create notes/plan.md 계획대로 진행');
  };
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
  if (form) {
    // Keys typed into a form arrive one at a time or as a burst; arrow keys as one sequence.
    if (s.startsWith('\x1b[')) return form(s);
    for (const ch of s) form?.(ch);
    return;
  }
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
