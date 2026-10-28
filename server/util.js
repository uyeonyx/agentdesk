import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function dataDir() {
  const d = process.env.AGENTDESK_HOME || path.join(os.homedir(), '.agentdesk');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

export function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomId(prefix = '') {
  return prefix + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Write JSON atomically with owner-only permissions. */
export function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameRetrying(tmp, file);
}

/** Windows refuses to replace a file someone holds open (antivirus, an indexer) for a moment: retry briefly. */
function renameRetrying(from, to) {
  for (let i = 0; ; i++) {
    try {
      return fs.renameSync(from, to);
    } catch (e) {
      if (!WIN || i >= 8 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (i + 1));
    }
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: opts.env || process.env, timeout: opts.timeout ?? 30000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = String(stdout || '');
          err.stderr = String(stderr || '');
          reject(err);
        } else resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });
}

export function errText(e) {
  if (e?.code === 'ENOENT') return `${e.path || 'command'} not found`;
  const s = (e?.stderr || '').trim() || (e?.stdout || '').trim() || e?.message || String(e);
  return s.split('\n').slice(0, 6).join('\n').slice(0, 800);
}

const WIN = process.platform === 'win32';

/**
 * The one spelling of a path used for storing and comparing. On Windows the same folder can come as
 * C:\Users\RUNNER~1\… (8.3 short name), C:/Users/runneradmin/… (git) or with other letter case;
 * the native call returns what's on disk. macOS keeps the plain realpath.
 */
export const realPath = (p) => (WIN ? fs.realpathSync.native(p) : fs.realpathSync(p));

/** Find an executable on PATH plus common install dirs. On Windows: by PATHEXT, no execute bit to check. */
export function which(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'));
  if (WIN) dirs.push(...[process.env.APPDATA && path.join(process.env.APPDATA, 'npm'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs')].filter(Boolean));
  else dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  // Windows npm installs a POSIX script without an extension next to the .cmd: never pick that one.
  const names = WIN && !path.extname(name) ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => name + e.toLowerCase()) : [name];
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && (WIN || st.mode & 0o111)) return p;
      } catch {}
    }
  }
  return undefined;
}

/**
 * argv that runs `bin` without a shell. On Windows a .cmd/.bat (an npm shim) would go through
 * cmd.exe, which re-reads quotes, &, |, % and ^ in every argument: a prompt could break its
 * arguments or run commands. So the shim is read instead, and its target run directly.
 */
export function commandFor(bin) {
  if (!WIN || !/\.(cmd|bat)$/i.test(bin)) return [bin];
  let text = '';
  try {
    text = fs.readFileSync(bin, 'utf8');
  } catch {}
  const dir = path.dirname(bin);
  const targets = [...text.matchAll(/"%~?dp0%?\\?([^"%]+)"/g)].map((m) => path.join(dir, m[1]));
  const target = targets.reverse().find((t) => /\.(exe|js|cjs|mjs)$/i.test(t) && fs.existsSync(t));
  if (target && /\.exe$/i.test(target)) return [target];
  if (target) {
    const node = fs.existsSync(path.join(dir, 'node.exe')) ? path.join(dir, 'node.exe') : which('node');
    if (node) return [node, target];
  }
  const e = new Error(`${path.basename(bin)}를 안전하게 실행할 수 없어요 (.exe 설치를 권장해요)`);
  e.status = 400;
  throw e;
}

/** Resolve `rel` inside `root`, refusing anything that escapes it (including via symlinks). */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return undefined;
  if (path.isAbsolute(rel)) return undefined;
  const realRoot = realPath(root);
  const abs = path.resolve(realRoot, rel);
  if (abs !== realRoot && !abs.startsWith(realRoot + path.sep)) return undefined;
  try {
    const real = realPath(abs);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return undefined;
    return real;
  } catch {
    return abs; // may not exist (deleted file); still inside root lexically
  }
}

export const tilde = (p) => {
  const h = os.homedir();
  return p === h ? '~' : p.startsWith(h + path.sep) ? '~' + p.slice(h.length) : p;
};
