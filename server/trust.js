// Claude Code asks once whether to trust a folder, and a folder inside a trusted one isn't asked
// again. Desk answers that question for its own empty folders only (the usage reader's, and the one
// that holds sessions not tied to a project yet), so those sessions start without it. A person's own
// folders are never answered for: there the question shows up in the session as usual.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pty from '@lydell/node-pty';
import { AGENTS } from './agents.js';
import { inheritedEnv, commandFor, realPath } from './util.js';

const PTY_WIN = process.platform === 'win32' ? { useConptyDll: true } : {};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const configFile = () => (process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'));

/** true / false from Claude Code's own record (the folder or a parent trusted); null when there's none to read. */
export function isTrusted(dir) {
  let projects;
  try {
    projects = JSON.parse(fs.readFileSync(configFile(), 'utf8'))?.projects || {};
  } catch {
    return null;
  }
  let d = dir;
  try {
    d = realPath(dir);
  } catch {}
  for (let cur = d; ; cur = path.dirname(cur)) {
    if (projects[cur]?.hasTrustDialogAccepted || projects[cur.replace(/\\/g, '/')]?.hasTrustDialogAccepted) return true;
    if (path.dirname(cur) === cur) return false;
  }
}

const trusting = new Map();

/** Trust one of Desk's own folders, once: a helper Claude opens there, says yes, and quits. */
export function trustOwnFolder(dir) {
  if (isTrusted(dir) !== false) return Promise.resolve();
  if (!trusting.has(dir)) trusting.set(dir, answer(dir).finally(() => trusting.delete(dir)));
  return trusting.get(dir);
}

async function answer(dir) {
  const bin = AGENTS.claude.bin();
  if (!bin) return;
  const [file, ...pre] = commandFor(bin);
  // No user or project settings (so none of the person's hooks run) and no Remote Control.
  const args = ['--setting-sources', 'project', '--settings', JSON.stringify({ remoteControlAtStartup: false })];
  const p = pty.spawn(file, [...pre, ...args], { name: 'xterm-256color', cols: 100, rows: 30, cwd: dir, env: inheritedEnv(), ...PTY_WIN });
  let out = '';
  p.onData((d) => (out += d));
  try {
    for (let t = 0; t < 15000 && !/trust this folder|for shortcuts|Try "|❯/i.test(out); t += 200) await delay(200);
    if (/trust this folder/i.test(out)) {
      await delay(1500);
      p.write('\x1b[B');
      await delay(200);
      p.write('\r');
      await delay(2500);
    }
  } finally {
    try {
      p.write('\x03');
      await delay(150);
      p.write('\x03');
      await delay(300);
    } catch {}
    try {
      p.kill();
    } catch {}
  }
}
