// Claude Code's own settings, shown and changed from the app: MCP servers (via `claude mcp`, and
// read straight from its config files for the list) and permission rules (settings.json files).
// Nothing here is Desk's own config: every change lands where Claude Code itself keeps it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENTS } from './agents.js';
import { run, errText, commandFor, inheritedEnv } from './util.js';
import { httpError } from './projects.js';

const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// ~/.claude.json, or <config dir>/.claude.json when the config dir is moved.
const globalConfigPath = () => (process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'));

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const SCOPES = ['user', 'project', 'local'];

/** One server entry as the app shows it. */
function entry(name, cfg, scope) {
  const kind = cfg?.type === 'http' || cfg?.type === 'sse' ? cfg.type : cfg?.url ? 'http' : 'stdio';
  const target = kind === 'stdio' ? [cfg?.command, ...(Array.isArray(cfg?.args) ? cfg.args : [])].filter(Boolean).join(' ') : cfg?.url || '';
  return { name, scope, kind, target, env: Object.keys(cfg?.env || {}) };
}

/**
 * The MCP servers Claude Code would load in a folder (none: user-wide only): user scope from
 * ~/.claude.json, local scope from its entry for that folder, project scope from <folder>/.mcp.json.
 * claude.ai connectors and plugins only show up after a health check.
 */
export function mcpServers(folder) {
  const g = readJson(globalConfigPath()) || {};
  const out = [];
  for (const [n, c] of Object.entries(g.mcpServers || {})) out.push(entry(n, c, 'user'));
  if (folder) {
    const local = g.projects?.[folder]?.mcpServers || {};
    for (const [n, c] of Object.entries(local)) out.push(entry(n, c, 'local'));
    const proj = readJson(path.join(folder, '.mcp.json'))?.mcpServers || {};
    for (const [n, c] of Object.entries(proj)) out.push(entry(n, c, 'project'));
  }
  return out;
}

/** `claude mcp list` lines: "name: target (HTTP) - ✔ Connected". */
export function parseMcpList(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^(.+?): (.+?)\s+-\s+([✔✓✘✗!⚠])\s*(.*)$/);
    if (!m) continue;
    const mark = m[3];
    const status = mark === '✔' || mark === '✓' ? 'ok' : mark === '!' || mark === '⚠' ? (/auth/i.test(m[4]) ? 'auth' : 'warn') : 'fail';
    const target = m[2].replace(/\s*\((HTTP|SSE|stdio)\)\s*$/i, '').trim();
    const name = m[1].trim();
    const source = /^claude\.ai /.test(name) ? 'claude.ai' : /^plugin:/.test(name) ? 'plugin' : '';
    out.push({ name, target, status, text: m[4].trim(), source });
  }
  return out;
}

const claudeBin = () => {
  const bin = AGENTS.claude.bin();
  if (!bin) throw httpError(400, 'Claude Code CLI를 찾을 수 없어요');
  return commandFor(bin);
};

/** Ask Claude Code which servers connect (it starts each one; this takes a while). */
export async function mcpCheck(folder) {
  const [file, ...pre] = claudeBin();
  try {
    const { stdout } = await run(file, [...pre, 'mcp', 'list'], { cwd: folder || os.homedir(), env: inheritedEnv(), timeout: 90_000 });
    return { at: Date.now(), servers: parseMcpList(stdout) };
  } catch (e) {
    // It exits non-zero when one fails, but still lists them all.
    const servers = parseMcpList(e.stdout || '');
    if (servers.length) return { at: Date.now(), servers };
    throw httpError(500, `연결을 확인하지 못했어요: ${errText(e)}`);
  }
}

/** Split a command line into words, honoring simple quotes. No shell ever sees it. */
export function words(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(s)))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** `claude mcp add` arguments for a server; every value is its own argument. */
export function mcpAddArgs({ name, kind, target, scope, env = {} }) {
  if (!NAME.test(name || '')) throw httpError(400, '이름은 영문·숫자·-_. 로 64자까지예요');
  if (!SCOPES.includes(scope)) throw httpError(400, '범위를 고르세요');
  const args = ['mcp', 'add', '--scope', scope];
  for (const [k, v] of Object.entries(env || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) || /[\r\n]/.test(String(v))) throw httpError(400, `환경 변수 ${k}를 넣을 수 없어요`);
    args.push('-e', `${k}=${v}`);
  }
  if (kind === 'http' || kind === 'sse') {
    let u;
    try {
      u = new URL(String(target || '').trim());
    } catch {}
    if (!u || !/^https?:$/.test(u.protocol)) throw httpError(400, '주소는 http:// 또는 https://로 시작해야 해요');
    args.push('--transport', kind, name, u.toString());
  } else {
    const w = words(target);
    if (!w.length) throw httpError(400, '실행할 명령을 쓰세요');
    if (w[0].startsWith('-')) throw httpError(400, '명령은 -로 시작할 수 없어요');
    args.push(name, '--', ...w);
  }
  return args;
}

export async function mcpAdd(input, folder) {
  if (input.scope !== 'user' && !folder) throw httpError(400, '프로젝트를 고르세요');
  const [file, ...pre] = claudeBin();
  try {
    await run(file, [...pre, ...mcpAddArgs(input)], { cwd: input.scope === 'user' ? os.homedir() : folder, env: inheritedEnv(), timeout: 30_000 });
  } catch (e) {
    throw httpError(400, `추가하지 못했어요: ${errText(e)}`);
  }
  return { servers: mcpServers(folder) };
}

export async function mcpRemove({ name, scope }, folder) {
  if (!NAME.test(name || '') || !SCOPES.includes(scope)) throw httpError(400, '지울 서버를 고르세요');
  if (scope !== 'user' && !folder) throw httpError(400, '프로젝트를 고르세요');
  const [file, ...pre] = claudeBin();
  try {
    await run(file, [...pre, 'mcp', 'remove', '--scope', scope, name], { cwd: scope === 'user' ? os.homedir() : folder, env: inheritedEnv(), timeout: 30_000 });
  } catch (e) {
    throw httpError(400, `지우지 못했어요: ${errText(e)}`);
  }
  return { servers: mcpServers(folder) };
}

// ---------------------------------------------------------------- permissions

const PERM_KINDS = ['allow', 'ask', 'deny'];
// Tool(specifier) or a bare tool / MCP name. No newlines; bounded.
const RULE = /^[A-Za-z_][\w.-]*(\(.{0,400}\))?$/;

/** The settings files whose permission rules apply in a folder, from widest to narrowest. */
export function permFiles(folder) {
  const files = [{ scope: 'user', path: path.join(claudeHome(), 'settings.json') }];
  if (folder) {
    files.push({ scope: 'project', path: path.join(folder, '.claude', 'settings.json') });
    files.push({ scope: 'local', path: path.join(folder, '.claude', 'settings.local.json') });
  }
  return files;
}

export function permissions(folder) {
  return {
    files: permFiles(folder).map((f) => {
      const j = readJson(f.path);
      const p = j?.permissions || {};
      return { scope: f.scope, path: f.path, exists: !!j, defaultMode: p.defaultMode || '', allow: arr(p.allow), ask: arr(p.ask), deny: arr(p.deny) };
    }),
  };
}
const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * Add or remove one rule in one settings file. Only `permissions.<kind>` changes; every other key
 * stays as it was. Written to a temp file and renamed, so a crash never leaves half a file.
 */
export function editPermission({ scope, kind, rule, op }, folder) {
  if (!PERM_KINDS.includes(kind)) throw httpError(400, '규칙 종류를 고르세요');
  rule = String(rule || '').trim();
  if (!RULE.test(rule)) throw httpError(400, '규칙은 Bash(npm test:*) · Edit(docs/**) · WebFetch 같은 모양이에요');
  const f = permFiles(folder).find((x) => x.scope === scope);
  if (!f) throw httpError(400, '범위를 고르세요');
  let text = '';
  try {
    text = fs.readFileSync(f.path, 'utf8');
  } catch {}
  let j = {};
  if (text.trim()) {
    try {
      j = JSON.parse(text);
    } catch {
      throw httpError(409, `${tildeOf(f.path)}를 읽지 못했어요 (JSON이 아니에요) · 직접 고쳐 주세요`);
    }
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw httpError(409, `${tildeOf(f.path)}의 모양이 예상과 달라요`);
  const perms = j.permissions && typeof j.permissions === 'object' ? j.permissions : {};
  const list = arr(perms[kind]);
  const next = op === 'remove' ? list.filter((x) => x !== rule) : list.includes(rule) ? list : [...list, rule];
  // The same rule can't be both allowed and denied: adding moves it.
  const others = op === 'remove' ? {} : Object.fromEntries(PERM_KINDS.filter((k) => k !== kind && arr(perms[k]).includes(rule)).map((k) => [k, arr(perms[k]).filter((x) => x !== rule)]));
  j.permissions = { ...perms, ...others, [kind]: next };
  fs.mkdirSync(path.dirname(f.path), { recursive: true });
  const tmp = `${f.path}.desk-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n', { mode: fs.existsSync(f.path) ? fs.statSync(f.path).mode & 0o777 : 0o644 });
  fs.renameSync(tmp, f.path);
  return permissions(folder);
}

const tildeOf = (p) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);
