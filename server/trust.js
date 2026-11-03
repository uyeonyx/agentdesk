// Claude Code asks once whether to trust a folder, and a folder inside a trusted one isn't asked
// again. Desk answers that question for its own empty folders only (the usage reader's, and the one
// that holds sessions not tied to a project yet), so those sessions start without it. A person's own
// folders are never answered for: there the question shows up in the session as usual.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import pty from '@lydell/node-pty';
import { AGENTS } from './agents.js';
import { inheritedEnv, commandFor, realPath } from './util.js';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');

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

/**
 * On Claude Code's trust screen ("❯ No, exit / Yes, I trust this folder", No highlighted): move to
 * Yes, and press Enter only once Yes is the highlighted one, so "No, exit" is never picked.
 * `lines()` reads the rendered screen; `write` types into the terminal. true when it said yes.
 */
export async function sayTrust(lines, write) {
  const yes = (l) => l.some((x) => /❯\s*(\d\.\s*)?Yes, I trust this folder/i.test(x));
  if (!(await lines()).some((x) => /Yes, I trust this folder/i.test(x))) return false;
  for (let k = 0; k < 3 && !yes(await lines()); k++) {
    write('\x1b[B');
    for (let t = 0; t < 1000 && !yes(await lines()); t += 100) await delay(100);
  }
  if (!yes(await lines())) return false;
  write('\r');
  return true;
}

async function answer(dir) {
  const bin = AGENTS.claude.bin();
  if (!bin) return;
  const [file, ...pre] = commandFor(bin);
  // No user or project settings (so none of the person's hooks run) and no Remote Control.
  const args = ['--setting-sources', 'project', '--settings', JSON.stringify({ remoteControlAtStartup: false })];
  const cols = 100;
  const rows = 30;
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const p = pty.spawn(file, [...pre, ...args], { name: 'xterm-256color', cols, rows, cwd: dir, env: inheritedEnv(), ...PTY_WIN });
  p.onData((d) => term.write(d));
  // What's on screen: Claude Code draws spaces as cursor moves, so the raw stream can't be searched.
  const lines = async () => {
    await new Promise((r) => term.write('', r));
    const b = term.buffer.active;
    const out = [];
    for (let y = 0; y < term.rows; y++) out.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? '');
    return out;
  };
  try {
    for (let t = 0; t < 15000; t += 200) {
      const l = await lines();
      if (l.some((x) => /trust this folder|for shortcuts|Try "/i.test(x))) break;
      await delay(200);
    }
    if (await sayTrust(lines, (k) => p.write(k))) for (let t = 0; t < 5000 && isTrusted(dir) === false; t += 200) await delay(200);
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
    term.dispose();
  }
}
