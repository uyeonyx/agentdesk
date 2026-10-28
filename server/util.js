import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const VERSION = '0.2.6';

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
  fs.renameSync(tmp, file);
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

/** Find an executable on PATH plus common install dirs. */
export function which(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'));
  for (const d of dirs) {
    const p = path.join(d, name);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && st.mode & 0o111) return p;
    } catch {}
  }
  return undefined;
}

/** Resolve `rel` inside `root`, refusing anything that escapes it (including via symlinks). */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) return undefined;
  if (path.isAbsolute(rel)) return undefined;
  const realRoot = fs.realpathSync(root);
  const abs = path.resolve(realRoot, rel);
  if (abs !== realRoot && !abs.startsWith(realRoot + path.sep)) return undefined;
  try {
    const real = fs.realpathSync(abs);
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
