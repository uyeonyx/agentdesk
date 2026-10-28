import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomId, tilde, realPath } from './util.js';
import { isRepo, repoRoot } from './git.js';
import { describe } from './describe.js';

export const PALETTE = ['#8B7CF6', '#F2783B', '#22B8A4', '#EC5A9C', '#3D8EF0', '#8CC84B', '#F2B53D', '#E5484D', '#2CB6E6', '#B07D5B', '#7D8FA3', '#33A66C'];

export const ICONS = [
  'stack-2', 'checklist', 'device-mobile', 'lock', 'server', 'world', 'cloud', 'database', 'brain', 'book', 'device-gamepad-2', 'shopping-cart',
  'chart-bar', 'palette', 'rocket', 'cpu', 'terminal-2', 'message-circle', 'music', 'camera', 'map-pin', 'heart',
  'briefcase', 'school', 'leaf', 'bolt',
];

const GUESS = [
  [/mobile|ios|android|app\b|rn-|react-?native|flutter/i, 'device-mobile'],
  [/crypt|secur|auth|vault|key|kms|cipher|암호/i, 'lock'],
  [/api|server|backend|svc|service|gateway/i, 'server'],
  [/web|site|front|landing|blog|www/i, 'world'],
  [/infra|terraform|k8s|kube|cloud|deploy|ops/i, 'cloud'],
  [/data|db|sql|etl|warehouse|pipeline/i, 'database'],
  [/ml|ai|llm|model|agent|gpt|claude/i, 'brain'],
  [/doc|wiki|book|note/i, 'book'],
  [/game|unity|godot/i, 'device-gamepad-2'],
  [/shop|store|commerce|cart|pay/i, 'shopping-cart'],
  [/todo|task|투두|할일/i, 'checklist'],
  [/design|ui|ux|theme/i, 'palette'],
  [/cli|tool|script|dotfile/i, 'terminal-2'],
  [/chat|bot|slack|discord/i, 'message-circle'],
];

function nameIcon(name) {
  for (const [re, icon] of GUESS) if (re.test(name)) return icon;
  return '';
}

function guessIcon(name) {
  for (const [re, icon] of GUESS) if (re.test(name)) return icon;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ICONS[h % ICONS.length];
}

function nextColor(projects) {
  const used = new Set(projects.map((p) => p.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[projects.length % PALETTE.length];
}

/** A group bundles several git projects; tasks in it get one worktree per member. */
export function addGroup(store, input) {
  const ids = [...new Set((Array.isArray(input.members) ? input.members : []).map(String))].slice(0, 12);
  const members = ids.map((id) => store.project(id));
  if (members.length < 2 || members.some((m) => !m || m.kind === 'group' || !m.isGit)) throw httpError(400, '묶으려면 git 저장소 프로젝트를 2개 이상 고르세요');
  const name = String(input.name || '').trim() || members.map((m) => m.name).join(' + ');
  const proj = {
    id: randomId('p'),
    kind: 'group',
    name: name.slice(0, 60),
    members: ids,
    path: members[0].path,
    color: validColor(input.color) || nextColor(store.projects),
    icon: validIcon(input.icon) || 'stack-2',
    desc: String(input.desc || members.map((m) => m.name).join(' · ')).slice(0, 120),
    careful: !!input.careful || members.some((m) => m.careful),
    isGit: true,
    createdAt: Date.now(),
  };
  store.projects.push(proj);
  store.save();
  return proj;
}

export async function addProject(store, input) {
  if (input.kind === 'group') return addGroup(store, input);
  let p = String(input.path || '').trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (!p || !path.isAbsolute(p)) throw httpError(400, '절대 경로를 입력하세요 (예: ~/projects/my-app)');
  let real;
  try {
    real = realPath(p);
    if (!fs.statSync(real).isDirectory()) throw new Error();
  } catch {
    throw httpError(400, `폴더를 찾을 수 없어요: ${tilde(p)}`);
  }
  const git = await isRepo(real);
  if (git) real = realPath(await repoRoot(real));
  if (store.projects.some((x) => x.kind !== 'group' && x.path === real)) throw httpError(409, '이미 추가된 프로젝트예요');
  // Name, description and logo come from the repo itself; nothing to fill in by hand.
  const d = describe(real);
  const base = path.basename(real);
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  // The README title is used when it's the folder name written properly ("Shop Front" for shop-front).
  const name = String(input.name || '').trim() || (d.title && norm(d.title) === norm(base) && /[A-Z]/.test(d.title) ? d.title : base);
  const proj = {
    id: randomId('p'),
    name: name.slice(0, 60),
    path: real,
    color: validColor(input.color) || nextColor(store.projects),
    // What the name says ("crypto" → lock) beats what the stack says (Rust → chip).
    icon: validIcon(input.icon) || nameIcon(name + ' ' + base) || d.icon || guessIcon(name + ' ' + base),
    desc: String(input.desc || d.desc || '').slice(0, 120),
    logo: d.logo || '',
    careful: !!input.careful,
    isGit: git,
    auto: { desc: !input.desc, icon: !input.icon, color: !input.color },
    described: 1,
    createdAt: Date.now(),
  };
  store.projects.push(proj);
  store.save();
  return proj;
}

export function updateProject(store, id, patch) {
  const p = store.project(id);
  if (!p) throw httpError(404, 'project not found');
  // Edits from the settings form are the person's choice: automatic filling leaves them alone.
  if (patch.manual === true) {
    p.auto ||= {};
    for (const k of ['desc', 'icon', 'color']) if (patch[k] !== undefined && patch[k] !== p[k]) p.auto[k] = false;
  }
  if (typeof patch.showLogo === 'boolean') p.showLogo = patch.showLogo;
  // The color picked from the logo, once, while the color is still automatic.
  if (patch.logoColor === true) {
    if (validColor(patch.color) && p.auto?.color !== false && !p.logoColorDone) {
      p.color = patch.color;
      p.logoColorDone = true;
      store.save();
    }
    return p;
  }
  if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 60);
  if (patch.color !== undefined && validColor(patch.color)) p.color = patch.color;
  if (patch.icon !== undefined && validIcon(patch.icon)) p.icon = patch.icon;
  if (typeof patch.desc === 'string') p.desc = patch.desc.slice(0, 120);
  if (typeof patch.careful === 'boolean') p.careful = patch.careful;
  if (typeof patch.remote === 'boolean') p.remote = patch.remote;
  if (patch.remote === null) delete p.remote;
  if (p.kind === 'group' && Array.isArray(patch.members)) {
    const ids = [...new Set(patch.members.map(String))].slice(0, 12);
    if (ids.length < 2 || ids.some((id) => { const m = store.project(id); return !m || m.kind === 'group' || !m.isGit; })) throw httpError(400, '묶으려면 git 저장소 프로젝트를 2개 이상 고르세요');
    p.members = ids;
  }
  store.save();
  return p;
}

/** Fill name-independent identity again from the repo (only fields still automatic, unless forced). */
export function autofill(store, id, { force = false } = {}) {
  const p = store.project(id);
  if (!p) throw httpError(404, 'project not found');
  if (p.kind === 'group') return p;
  const d = describe(p.path);
  p.auto ||= {};
  if (d.desc && (force || p.auto.desc !== false || !p.desc)) {
    p.desc = d.desc.slice(0, 120);
    p.auto.desc = true;
  }
  if (d.logo) p.logo = d.logo;
  if (force) {
    if (d.icon) p.icon = d.icon;
    p.auto.icon = true;
    p.showLogo = true;
  }
  p.described = 1;
  store.save();
  return p;
}

/** Projects added before automatic filling: add a description and logo once, change nothing else. */
export function backfill(store) {
  let n = 0;
  for (const p of store.projects) {
    if (p.kind === 'group' || p.described) continue;
    const d = describe(p.path);
    p.auto ||= {};
    if (!p.desc && d.desc) {
      p.desc = d.desc.slice(0, 120);
      p.auto.desc = true;
    }
    if (!p.logo && d.logo) p.logo = d.logo;
    p.described = 1;
    n++;
  }
  if (n) store.save();
}

export function removeProject(store, id) {
  const live = store.tasks.some((t) => t.projectId === id && !['merged', 'discarded'].includes(t.state));
  if (live) throw httpError(409, '진행 중인 작업이 있어서 삭제할 수 없어요. 먼저 작업을 정리하세요.');
  store.projects = store.projects.filter((p) => p.id !== id);
  store.tasks = store.tasks.filter((t) => t.projectId !== id);
  // A removed repo leaves its groups; a group that drops below two members dissolves.
  for (const g of store.projects.filter((p) => p.kind === 'group')) g.members = (g.members || []).filter((m) => m !== id);
  store.projects = store.projects.filter((p) => p.kind !== 'group' || p.members.length >= 2 || store.tasks.some((t) => t.projectId === p.id));
  store.save();
}

function validColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : undefined;
}
function validIcon(i) {
  return typeof i === 'string' && /^[a-z0-9-]{2,40}$/.test(i) ? i : undefined;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ---------- discovery ----------

const SKIP = new Set(['node_modules', 'Library', 'Applications', 'Pictures', 'Movies', 'Music', 'Documents', 'Desktop', 'Downloads', '.Trash', 'vendor', 'target', 'dist', 'build', '.cache', 'Pods']);

/** Find git repos under common code folders (skips macOS-protected folders to avoid permission prompts). */
export function discoverRepos(existing) {
  const home = os.homedir();
  const roots = ['Projects', 'projects', 'dev', 'Dev', 'Developer', 'code', 'Code', 'src', 'work', 'Work', 'workspace', 'repos', 'git', 'github', 'GitHub', 'sites']
    .map((d) => path.join(home, d))
    .filter((d) => fs.existsSync(d));
  roots.push(home);
  const found = new Map();
  const deadline = Date.now() + 1500;
  const known = new Set(existing.map((p) => p.path));
  const walk = (dir, depth) => {
    if (Date.now() > deadline || found.size >= 150) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === '.git')) {
      if (!known.has(dir)) {
        let mtime = 0;
        try {
          mtime = fs.statSync(path.join(dir, '.git')).mtimeMs;
        } catch {}
        found.set(dir, { path: dir, display: tilde(dir), name: path.basename(dir), mtime });
      }
      return;
    }
    if (depth <= 0) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), depth - 1);
    }
  };
  for (const r of roots) walk(r, r === home ? 1 : 3);
  return [...found.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 60);
}

/** Folder autocomplete for the add-project field. */
export function listDirs(input) {
  const home = os.homedir();
  // "/" works as a separator on every OS; Windows also takes "\".
  const endsWithSep = (s) => /[\\/]$/.test(s);
  let q = String(input || '').replace(/^~(?=$|[\\/])/, home) || home + path.sep;
  if (!path.isAbsolute(q)) q = path.join(home, q);
  const base = endsWithSep(q) ? q : path.dirname(q);
  const prefix = endsWithSep(q) ? '' : path.basename(q).toLowerCase();
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name.toLowerCase().startsWith(prefix))
    .slice(0, 40)
    .map((e) => {
      const full = path.join(base, e.name);
      return { path: full, display: tilde(full) + path.sep, git: fs.existsSync(path.join(full, '.git')) };
    });
}
