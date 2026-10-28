import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, randomHex } from './util.js';

const git = (cwd, args, opts = {}) => run('git', ['-C', cwd, ...args], { timeout: 60000, ...opts });

export async function isRepo(dir) {
  try {
    const { stdout } = await git(dir, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export async function repoRoot(dir) {
  const { stdout } = await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const common = stdout.trim();
  if (path.basename(common) === '.git') return path.dirname(common);
  const { stdout: top } = await git(dir, ['rev-parse', '--show-toplevel']);
  return top.trim();
}

export async function head(dir) {
  try {
    const { stdout } = await git(dir, ['rev-parse', 'HEAD']);
    return stdout.trim();
  } catch {
    return undefined; // repo with no commits
  }
}

export async function currentBranch(dir) {
  try {
    const { stdout } = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** Keep our worktrees out of `git status` in the main checkout. */
export function excludeFromStatus(repo, pattern) {
  try {
    const gitDir = path.join(repo, '.git');
    if (!fs.statSync(gitDir).isDirectory()) return;
    const f = path.join(gitDir, 'info', 'exclude');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    if (!cur.split(/\r?\n/).includes(pattern)) fs.appendFileSync(f, `${cur.endsWith('\n') || !cur ? '' : '\n'}${pattern}\n`);
  } catch {}
}

export async function addWorktree(repo, wtPath, branch, base) {
  fs.mkdirSync(path.dirname(wtPath), { recursive: true });
  const args = ['worktree', 'add', '-q', '-b', branch, wtPath];
  if (base) args.push(base);
  await git(repo, args);
}

export async function removeWorktree(repo, wtPath, branch, { force = true, deleteBranch = true, unmergedOk = true } = {}) {
  try {
    await git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), wtPath]);
  } catch {
    try {
      fs.rmSync(wtPath, { recursive: true, force: true });
      await git(repo, ['worktree', 'prune']);
    } catch {}
  }
  if (deleteBranch && branch) {
    try {
      await git(repo, ['branch', unmergedOk ? '-D' : '-d', branch]);
    } catch {}
  }
}

/** Files that differ from `base`, including untracked ones. */
export async function changes(dir, base) {
  const out = new Map();
  if (base) {
    const { stdout: ns } = await git(dir, ['diff', '--no-renames', '--name-status', base]);
    for (const line of ns.split('\n')) {
      if (!line.trim()) continue;
      const [st, ...rest] = line.split('\t');
      out.set(rest.join('\t'), { path: rest.join('\t'), status: st[0], adds: 0, dels: 0 });
    }
    const { stdout: num } = await git(dir, ['diff', '--no-renames', '--numstat', base]);
    for (const line of num.split('\n')) {
      if (!line.trim()) continue;
      const [a, d, ...rest] = line.split('\t');
      const p = rest.join('\t');
      const e = out.get(p);
      if (e) {
        e.adds = a === '-' ? 0 : +a;
        e.dels = d === '-' ? 0 : +d;
        e.binary = a === '-';
      }
    }
  }
  const { stdout: un } = await git(dir, ['ls-files', '--others', '--exclude-standard', '-z']);
  for (const p of un.split('\0')) {
    if (!p || out.has(p)) continue;
    let adds = 0;
    try {
      // lstat: never follow a symlink (e.g. to /dev/zero) and only read small regular files.
      const st = fs.lstatSync(path.join(dir, p));
      if (st.isFile() && st.size <= 2_000_000) adds = fs.readFileSync(path.join(dir, p)).toString('utf8').split('\n').length;
    } catch {}
    out.set(p, { path: p, status: 'A', adds, dels: 0, untracked: true });
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function listFiles(dir) {
  const { stdout } = await git(dir, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  return [...new Set(stdout.split('\0').filter(Boolean))].filter((p) => {
    try {
      return fs.statSync(path.join(dir, p)).isFile();
    } catch {
      return false;
    }
  });
}

export async function showAt(dir, ref, rel) {
  try {
    const { stdout } = await git(dir, ['show', `${ref}:${rel}`]);
    return stdout;
  } catch {
    return null; // file did not exist at that ref
  }
}

/**
 * Snapshot the full working tree (tracked + untracked, honoring .gitignore) as a commit
 * object without touching HEAD, the index or the working files.
 */
export async function snapshot(dir, label) {
  const idx = path.join(os.tmpdir(), `agentdesk-idx-${randomHex(6)}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    const parent = await head(dir);
    // Start from a copy of the real index: its stat cache means only changed files get hashed,
    // so a snapshot stays fast even in big repos (it runs right before every message).
    let seeded = false;
    try {
      const { stdout: ip } = await git(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
      const real = ip.trim();
      if (real && fs.existsSync(real)) {
        fs.copyFileSync(real, idx);
        seeded = true;
      }
    } catch {}
    if (!seeded && parent) await run('git', ['-C', dir, 'read-tree', parent], { env });
    await run('git', ['-C', dir, 'add', '-A'], { env, timeout: 120000 });
    const { stdout: tree } = await run('git', ['-C', dir, 'write-tree'], { env });
    const args = ['-C', dir, 'commit-tree', tree.trim(), '-m', `agentdesk snapshot: ${label}`];
    if (parent) args.splice(4, 0, '-p', parent);
    const { stdout: sha } = await run('git', args, {
      env: { ...process.env, GIT_AUTHOR_NAME: 'agentdesk', GIT_AUTHOR_EMAIL: 'agentdesk@localhost', GIT_COMMITTER_NAME: 'agentdesk', GIT_COMMITTER_EMAIL: 'agentdesk@localhost' },
    });
    const commit = sha.trim();
    // Keep it reachable so gc never drops it.
    await git(dir, ['update-ref', `refs/agentdesk/snap/${commit}`, commit]);
    return { commit, tree: tree.trim(), parent };
  } finally {
    try {
      fs.unlinkSync(idx);
    } catch {}
  }
}

/** Put the working tree back exactly as it was at `snap` (files created later are removed). */
export async function restore(dir, snap) {
  if (snap.parent) await git(dir, ['reset', '-q', '--mixed', snap.parent]);
  const { stdout: inSnap } = await git(dir, ['ls-tree', '-r', '-z', '--name-only', snap.commit]);
  const keep = new Set(inSnap.split('\0').filter(Boolean));
  if (keep.size) await git(dir, ['checkout', snap.commit, '--', '.']);
  const { stdout: now } = await git(dir, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const realDir = fs.realpathSync(dir);
  for (const p of now.split('\0')) {
    if (p && !keep.has(p)) safeUnlink(realDir, p);
  }
  if (snap.parent) await git(dir, ['reset', '-q', '--mixed', snap.parent]);
  else await git(dir, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.']).catch(() => {});
}

/**
 * Delete <root>/<rel> only if its real parent directory is still inside root.
 * A symlinked parent (planted after the snapshot) must never redirect a delete outside the worktree.
 */
export function safeUnlink(realRoot, rel) {
  try {
    const abs = path.join(realRoot, rel);
    const parent = fs.realpathSync(path.dirname(abs));
    if (parent !== realRoot && !parent.startsWith(realRoot + path.sep)) return false;
    const target = path.join(parent, path.basename(abs));
    const st = fs.lstatSync(target);
    if (st.isDirectory()) return false;
    fs.unlinkSync(target); // removes a symlink itself, never what it points to
    return true;
  } catch {
    return false;
  }
}

export async function isDirty(dir) {
  const { stdout } = await git(dir, ['status', '--porcelain']);
  return stdout.trim().length > 0;
}

export async function commitAll(dir, message) {
  if (!(await isDirty(dir))) return false;
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-q', '-m', message]).catch(async (e) => {
    // No identity configured: fall back so the merge flow still works.
    if (/Please tell me who you are|empty ident/i.test(e.stderr || '')) {
      await git(dir, ['-c', 'user.name=agentdesk', '-c', 'user.email=agentdesk@localhost', 'commit', '-q', '-m', message]);
    } else throw e;
  });
  return true;
}

export async function mergeInto(repo, branch, message) {
  try {
    await git(repo, ['merge', '--no-ff', '-m', message, branch]);
  } catch (e) {
    if (/Please tell me who you are|empty ident/i.test(e.stderr || '')) {
      await git(repo, ['merge', '--abort']).catch(() => {});
      await git(repo, ['-c', 'user.name=agentdesk', '-c', 'user.email=agentdesk@localhost', 'merge', '--no-ff', '-m', message, branch]);
      return;
    }
    await git(repo, ['merge', '--abort']).catch(() => {});
    throw e;
  }
}

export async function push(dir, branch) {
  await git(dir, ['push', '-u', 'origin', branch], { timeout: 120000 });
}

/** Would merging `branch` into the current HEAD of `repo` conflict? null when git is too old to tell. */
export async function mergeConflicts(repo, branch) {
  try {
    await git(repo, ['merge-tree', '--write-tree', '--no-messages', 'HEAD', branch]);
    return false;
  } catch (e) {
    if (e.code === 1) return true;
    return null;
  }
}
