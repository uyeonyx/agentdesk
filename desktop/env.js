// An app opened from Finder gets launchd's environment: PATH=/usr/bin:/bin:/usr/sbin:/sbin, no LANG.
// Agents, git, gh and the person's shell need what their terminal has, so read it from a login shell.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const KEEP_OURS = /^(ELECTRON_|CHROME_|AGENTDESK_|NODE_OPTIONS$|__CF|XPC_)/;

/** Environment of an interactive login shell, or null if it can't be read within `ms`. */
export function loginShellEnv({ shell = process.env.SHELL || '/bin/zsh', ms = 10000 } = {}) {
  const mark = randomBytes(8).toString('hex');
  return new Promise((resolve) => {
    let out = Buffer.alloc(0);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    // rc files may print anything; only what sits between the markers counts.
    const p = spawn(shell, ['-ilc', `printf '%s' ${mark}; /usr/bin/env -0; printf '%s' ${mark}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTARTED: 'true', ZSH_TMUX_AUTOSTART: 'false' },
      detached: true,
    });
    const timer = setTimeout(() => {
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {}
      finish(null);
    }, ms);
    p.stdout.on('data', (d) => (out = Buffer.concat([out, d])));
    p.on('error', () => finish(null));
    p.on('close', () => {
      const s = out.toString('utf8');
      const a = s.indexOf(mark);
      const b = s.lastIndexOf(mark);
      if (a < 0 || b <= a) return finish(null);
      const env = {};
      for (const kv of s.slice(a + mark.length, b).split('\0')) {
        const i = kv.indexOf('=');
        if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
      }
      finish(env);
    });
  });
}

/** `base` with the login shell's variables on top (ours win for app-internal ones), plus a UTF-8 locale. */
export function mergeEnv(base, shellEnv, locale = 'en_US') {
  const env = { ...base };
  for (const [k, v] of Object.entries(shellEnv || {})) {
    if (KEEP_OURS.test(k) || k === 'SHLVL' || k === '_' || k === 'PWD' || k === 'OLDPWD') continue;
    env[k] = v;
  }
  // Without a locale, zsh in the shell pane mangles Hangul and git escapes Korean file names.
  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = `${locale.replace(/-/g, '_')}.UTF-8`;
  return env;
}
