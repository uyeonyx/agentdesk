// How much of the plan is used. Two sources, both Claude Code's own, neither a model call:
//  - live: every running Desk session's status line carries the 5-hour and weekly limits
//    (rate_limits), so they move as the work goes on, with no extra process;
//  - now and then: `claude -p /usage` with stream-json hands back the whole report as data
//    (per-model weeks, extra credits). It runs in Desk's own empty folder with no user or project
//    settings, so none of the person's hooks run and nothing is saved. CLIs too old for that report
//    get the /usage screen read the old way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import pty from '@lydell/node-pty';
import { AGENTS } from './agents.js';
import { dataDir, inheritedEnv, commandFor, realPath } from './util.js';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
const PTY_WIN = process.platform === 'win32' ? { useConptyDll: true } : {};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Resets Nov 4 at 12am (Asia/Seoul)" → "11월 4일 0시", "Resets 3:59pm" → "15:59". The words as a fallback. */
export function resetText(s) {
  const t = String(s || '').replace(/^\s*Resets\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const m = t.match(/^(?:([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s*)?(?:at\s+)?(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (!m || (!m[1] && !m[3])) return t;
  let time = '';
  if (m[3]) {
    let h = Number(m[3]);
    const min = m[4] || '00';
    if (m[5]) h = (h % 12) + (/pm/i.test(m[5]) ? 12 : 0);
    time = min === '00' ? `${h}시` : `${h}:${min}`;
  }
  const mon = m[1] && MONTHS[m[1].toLowerCase()];
  return [mon ? `${mon}월 ${Number(m[2])}일` : '', time].filter(Boolean).join(' ') || t;
}

/** Korean names for the rows Claude Code shows; anything new keeps its own words. */
export function labelOf(title) {
  const t = title.trim();
  if (/^current session/i.test(t)) return '5시간 한도';
  const wk = t.match(/^current week\s*\(([^)]+)\)/i);
  if (wk) return /all models/i.test(wk[1]) ? '이번 주 · 모든 모델' : `이번 주 · ${wk[1]}`;
  if (/^current week/i.test(t)) return '이번 주';
  if (/usage credits|extra usage/i.test(t)) return '추가 크레딧';
  return t;
}

/**
 * The limits on Claude Code's /usage screen: a title line, a bar ending in "NN% used", and a
 * "Resets …" line. Credits also carry "$a / $b spent". null when the screen has none of it.
 */
export function usageFromLines(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(\d{1,3})%\s+used\s*$/i);
    if (!m) continue;
    let title = '';
    for (let k = i - 1; k >= 0 && k >= i - 2; k--) {
      const t = lines[k].replace(/[█▉▊▋▌▍▎▏░▒▓\s]+$/g, '').trim();
      if (t && !/%\s+used/i.test(t) && !/^[█▉▊▋▌▍▎▏░▒▓\s]+$/.test(lines[k])) {
        title = t;
        break;
      }
    }
    if (!title) continue;
    const next = (lines[i + 1] || '').trim();
    const spent = next.match(/\$([\d.,]+)\s*\/\s*\$([\d.,]+)\s*spent/i);
    const resetLine = /resets/i.test(next) ? next.replace(/^.*?(Resets)/i, '$1') : '';
    rows.push({
      key: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      label: labelOf(title),
      pct: Math.min(100, Number(m[1])),
      resets: resetText(resetLine),
      ...(spent ? { spent: `$${spent[1]} / $${spent[2]}` } : {}),
    });
  }
  return rows.length ? rows : null;
}

const pad2 = (n) => String(n).padStart(2, '0');
/** A reset time as people say it: "15:59" today, "11월 4일 0시" on another day. */
export function resetAt(when, now = Date.now()) {
  const t = typeof when === 'number' ? (when < 1e12 ? when * 1000 : when) : Date.parse(when);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hm = `${d.getHours()}:${pad2(d.getMinutes())}`;
  if (d.toDateString() === new Date(now).toDateString()) return hm;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getMinutes() ? hm : `${d.getHours()}시`}`;
}

const MONEY = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', KRW: '₩' };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The rows from the structured /usage report (`usage_report.rate_limits` in stream-json): one per
 * limit the plan has, then extra credits when the plan carries them. null without a report.
 */
export function usageFromReport(report, now = Date.now()) {
  const rl = report?.rate_limits;
  if (!rl || !Array.isArray(rl.limits)) return null;
  const rows = [];
  for (const l of rl.limits) {
    if (typeof l?.percent !== 'number') continue;
    const model = l.scope?.model?.display_name;
    const session = l.group === 'session' || /session|five|5h/i.test(l.kind || '');
    const row = session
      ? { key: 'current-session', label: '5시간 한도' }
      : l.kind === 'weekly_all'
        ? { key: 'current-week-all-models', label: '이번 주 · 모든 모델' }
        : model
          ? { key: `current-week-${slug(model)}`, label: `${l.group === 'weekly' ? '이번 주 · ' : ''}${model}` }
          : { key: slug(l.kind || 'limit'), label: String(l.kind || '한도') };
    rows.push({ ...row, pct: Math.min(100, Math.round(l.percent)), resets: l.resets_at ? resetAt(l.resets_at, now) : '' });
  }
  const x = rl.extra_usage;
  if (x && (x.is_enabled || x.monthly_limit)) {
    const sym = MONEY[x.currency] || '';
    const money = (c) => `${sym}${(Number(c || 0) / 100).toFixed(2)}`;
    const pct = typeof x.utilization === 'number' ? x.utilization : x.monthly_limit ? (100 * Number(x.used_credits || 0)) / x.monthly_limit : 0;
    rows.push({ key: 'usage-credits', label: '추가 크레딧', pct: Math.min(100, Math.round(pct)), resets: '', ...(x.monthly_limit ? { spent: `${money(x.used_credits)} / ${money(x.monthly_limit)}` } : {}) });
  }
  return rows;
}

/** The status line's live limits (`rate_limits`: five_hour, seven_day) laid over the rows. */
export function withLive(rows, live, now = Date.now()) {
  const out = (rows || []).map((r) => ({ ...r }));
  const put = (key, label, w) => {
    if (!w || typeof w.used_percentage !== 'number') return;
    const v = { key, label, pct: Math.min(100, Math.round(w.used_percentage)), resets: w.resets_at ? resetAt(w.resets_at, now) : '' };
    const i = out.findIndex((r) => r.key === key);
    if (i >= 0) out[i] = { ...out[i], pct: v.pct, resets: v.resets || out[i].resets };
    else if (key === 'current-session') out.unshift(v);
    else out.splice(out[0]?.key === 'current-session' ? 1 : 0, 0, v);
  };
  put('current-session', '5시간 한도', live?.five_hour);
  put('current-week-all-models', '이번 주 · 모든 모델', live?.seven_day);
  return out;
}

/** Claude Code's usage, refreshed now and then while anything runs, and when someone looks. */
export class Usage {
  constructor(onChange) {
    this.onChange = onChange;
    this.claude = null; // { rows, at, liveAt? } | { error, at }
    this.report = null; // the rows from the last full report
    this.live = null; // the latest status-line limits, { five_hour, seven_day }
    this.liveAt = 0;
    this.running = null;
    this.timer = null;
  }

  view() {
    return { claude: this.claude };
  }

  /** A running session's status line reported its limits: show them now (when they changed). */
  fromStatus(rateLimits) {
    if (!rateLimits || typeof rateLimits !== 'object') return;
    const live = { five_hour: rateLimits.five_hour || null, seven_day: rateLimits.seven_day || null };
    if (!live.five_hour && !live.seven_day) return;
    this.liveAt = Date.now();
    const same = JSON.stringify(live) === JSON.stringify(this.live);
    this.live = live;
    if (same && this.claude?.rows) return;
    this.claude = { rows: withLive(this.report, live), at: this.claude?.at || Date.now(), liveAt: this.liveAt };
    this.onChange?.();
  }

  /** At most every `minMs`; one read at a time. */
  refresh({ minMs = 60_000 } = {}) {
    if (this.running) return this.running;
    if (this.claude?.at && Date.now() - this.claude.at < minMs) return Promise.resolve(this.view());
    if (!AGENTS.claude.bin()) return Promise.resolve(this.view());
    this.running = this.readClaude()
      .then((rows) => {
        if (rows) {
          this.report = rows;
          this.claude = { rows: Date.now() - this.liveAt < 15 * 60_000 ? withLive(rows, this.live) : rows, at: Date.now(), ...(this.liveAt ? { liveAt: this.liveAt } : {}) };
        } else this.claude = { ...(this.claude || {}), error: '사용량을 읽지 못했어요', at: Date.now() };
      })
      .catch((e) => {
        this.claude = { ...(this.claude || {}), error: String(e?.message || e).slice(0, 200), at: Date.now() };
      })
      .finally(() => {
        this.running = null;
        this.onChange?.();
      });
    return this.running.then(() => this.view());
  }

  /**
   * While sessions run: the status lines keep the 5-hour and weekly numbers live, so the full report
   * (per-model weeks, credits) is read every half hour; without live numbers, every 10 minutes.
   */
  start(busy) {
    clearInterval(this.timer);
    this.timer = setInterval(() => busy() && this.refresh({ minMs: Date.now() - this.liveAt < 10 * 60_000 ? 30 * 60_000 : 9 * 60_000 }), 60_000);
    this.timer.unref?.();
    setTimeout(() => busy() && this.refresh(), 8000).unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** The full report: `claude -p /usage` as stream-json, or the /usage screen on an older CLI. */
  async readClaude() {
    const report = await this.readReport().catch(() => undefined);
    if (report) return report;
    // undefined: this CLI has no structured report (or -p failed); read the screen instead.
    return report === null ? null : this.readScreen();
  }

  /** rows, null (the report came and had no limits), or undefined (no report from this CLI). */
  readReport() {
    const bin = AGENTS.claude.bin();
    const dir = path.join(dataDir(), 'usage');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const [file, ...pre] = commandFor(bin);
    const args = ['-p', '/usage', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--setting-sources', 'project', '--settings', JSON.stringify({ remoteControlAtStartup: false })];
    const started = Date.now();
    return new Promise((resolve) => {
      let out = '';
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch {}
        dropHelperSessions(dir, started);
        resolve(v);
      };
      const child = spawn(file, [...pre, ...args], { cwd: dir, env: inheritedEnv(), stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      const timer = setTimeout(() => finish(undefined), 25_000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        out += d;
        if (out.length > 2_000_000) finish(undefined);
      });
      child.on('error', () => finish(undefined));
      child.on('close', () => {
        let found;
        for (const line of out.split('\n')) {
          if (!line.includes('usage_report')) continue;
          try {
            const r = JSON.parse(line).usage_report;
            if (r) found = r;
          } catch {}
        }
        if (!found) return finish(undefined);
        const rows = usageFromReport(found);
        finish(rows && rows.length ? rows : null);
      });
    });
  }

  /** The /usage screen in a PTY, for a CLI without the structured report. */
  async readScreen() {
    const bin = AGENTS.claude.bin();
    const dir = path.join(dataDir(), 'usage');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const cols = 100;
    const rows = 50;
    const term = new Terminal({ cols, rows, allowProposedApi: true });
    const [file, ...pre] = commandFor(bin);
    // No user settings (hooks, model) and no Remote Control: nothing of this shows up anywhere.
    const args = ['--setting-sources', 'project', '--settings', JSON.stringify({ remoteControlAtStartup: false })];
    const started = Date.now();
    const p = pty.spawn(file, [...pre, ...args], { name: 'xterm-256color', cols, rows, cwd: dir, env: inheritedEnv(), ...PTY_WIN });
    p.onData((d) => term.write(d));
    const lines = async () => {
      await new Promise((r) => term.write('', r));
      const b = term.buffer.active;
      const out = [];
      for (let y = 0; y < term.rows; y++) out.push(b.getLine(b.viewportY + y)?.translateToString(true) ?? '');
      return out;
    };
    const until = async (test, ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const l = await lines();
        if (test(l)) return l;
        await delay(200);
      }
      return null;
    };
    try {
      // Desk's own empty folder: trusted once, the first time.
      const first = await until((l) => l.some((x) => /Yes, I trust this folder|for shortcuts|Try "|^\s*❯/i.test(x)), 15000);
      if (first?.some((x) => /Yes, I trust this folder/i.test(x))) {
        await delay(1500);
        p.write('\x1b[B');
        await delay(200);
        p.write('\r');
        await delay(2500);
      } else await delay(1200);
      p.write('/usage');
      await delay(300);
      p.write('\r');
      let got = await until((l) => l.some((x) => /%\s+used/i.test(x)), 12000);
      if (!got) {
        p.write('\r');
        got = await until((l) => l.some((x) => /%\s+used/i.test(x)), 8000);
      }
      if (!got) return null;
      // The numbers come in a moment after the screen opens.
      const settled = (await until((l) => !l.some((x) => /Refreshing…|Loading/i.test(x)), 6000)) || got;
      return usageFromLines(settled) || usageFromLines(got);
    } finally {
      try {
        p.write('\x1b');
        await delay(150);
        p.write('\x03');
        await delay(150);
        p.write('\x03');
        await delay(300);
      } catch {}
      try {
        p.kill();
      } catch {}
      term.dispose();
      dropHelperSessions(dir, started);
    }
  }
}

/** The CLI keeps a small session file for each read (the /usage command); only ours, in our folder. */
function dropHelperSessions(dir, since) {
  let real = dir;
  try {
    real = realPath(dir);
  } catch {}
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  for (const d of new Set([real, dir])) {
    const pd = path.join(home, 'projects', d.replace(/[^a-zA-Z0-9]/g, '-'));
    let names = [];
    try {
      names = fs.readdirSync(pd);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const f = path.join(pd, n);
      try {
        if (fs.statSync(f).mtimeMs >= since - 1000) fs.unlinkSync(f);
      } catch {}
    }
  }
}
