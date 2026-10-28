// The app shell's boundary rules, without Electron: what app://desk/ serves, which frames may talk
// to the core, which links may leave, and what environment agents get when launched from Finder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve, isTrustedFrame, isExternalAllowed, CSP } from '../desktop/protocol.js';
import { mergeEnv, loginShellEnv } from '../desktop/env.js';
import { retireDaemon } from '../desktop/legacy.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-shell-'));
const dist = path.join(tmp, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Desk</title>');
fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'export {}');
fs.writeFileSync(path.join(dist, 'assets', 'font.woff2'), 'w2');
fs.writeFileSync(path.join(tmp, 'secret.txt'), 'TOP SECRET');
fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(dist, 'assets', 'link.js'));

test('app://desk/ serves the UI with the right types and a strict CSP', () => {
  const page = serve(dist, 'app://desk/');
  assert.equal(page.status, 200);
  assert.match(page.headers['Content-Type'], /^text\/html/);
  assert.equal(serve(dist, 'app://desk/some/route').status, 200, 'routes without an extension get the page');
  const js = serve(dist, 'app://desk/assets/app.js');
  assert.match(js.headers['Content-Type'], /^text\/javascript/, 'module scripts need a JS type');
  assert.equal(serve(dist, 'app://desk/assets/font.woff2').headers['Content-Type'], 'font/woff2');
  for (const r of [page, js]) {
    assert.equal(r.headers['Content-Security-Policy'], CSP);
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  }
  assert.match(CSP, /script-src 'self'(;|$)/);
  assert.doesNotMatch(CSP, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.match(CSP, /connect-src 'self'(;|$)/, 'the page has nothing to connect to');
  assert.match(CSP, /frame-ancestors 'none'/);
});

test('app://desk/ never reads outside the UI folder', () => {
  for (const u of ['app://desk/../secret.txt', 'app://desk/%2e%2e/secret.txt', 'app://desk/assets/..%2f..%2fsecret.txt', 'app://desk/assets/link.js', 'app://desk/%E0%A4%A.js', 'app://other/index.html', 'app://desk/nope.js']) {
    const r = serve(dist, u);
    assert.notEqual(r.status, 200, u);
    assert.ok(!String(r.body).includes('TOP SECRET'), u);
  }
});

test('only our own top-level page counts as the app', () => {
  assert.ok(isTrustedFrame({ url: 'app://desk/', parent: null }));
  assert.ok(isTrustedFrame({ url: 'app://desk/some/route', parent: null }));
  assert.ok(!isTrustedFrame({ url: 'app://desk/', parent: {} }), 'a subframe');
  assert.ok(!isTrustedFrame({ url: 'https://evil.example/', parent: null }));
  assert.ok(!isTrustedFrame({ url: 'app://desk.evil/', parent: null }));
  assert.ok(!isTrustedFrame({ url: 'file:///Users/x/index.html', parent: null }));
  assert.ok(!isTrustedFrame(null));
});

test('links that may leave the app: web pages and VS Code only', () => {
  for (const u of ['https://github.com/a/b/pull/1', 'http://localhost:3000', 'vscode://file/Users/x/a.js:3', 'vscode://file/C:/x/a.js:3']) assert.ok(isExternalAllowed(u), u);
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'ms-msdt:/id', 'x-apple.systempreferences:', 'not a url']) assert.ok(!isExternalAllowed(u), u);
});

test('Finder launch: the login shell environment wins, the app keeps its own variables, a locale is set', () => {
  const base = { PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '', AGENTDESK_HOME: '/a', HOME: '/Users/x' };
  const shell = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', AGENTDESK_HOME: '/b', ELECTRON_X: '1', SHLVL: '2', _: '/usr/bin/env', GH_TOKEN: 't' };
  const env = mergeEnv(base, shell, 'ko-KR');
  assert.equal(env.PATH, '/opt/homebrew/bin:/usr/bin:/bin');
  assert.equal(env.AGENTDESK_HOME, '/a');
  assert.equal(env.ELECTRON_X, undefined);
  assert.equal(env.SHLVL, undefined);
  assert.equal(env.GH_TOKEN, 't');
  assert.equal(env.LANG, 'ko_KR.UTF-8');
  assert.equal(mergeEnv({ LC_ALL: 'C.UTF-8' }, {}, 'ko-KR').LANG, undefined, 'an existing locale is kept');
  assert.deepEqual(mergeEnv(base, null).PATH, '/usr/bin:/bin', 'no shell env: unchanged');
});

test('the login shell is read between markers, whatever the rc files print', { skip: process.platform === 'win32' && 'macOS/Linux only' }, async () => {
  const rc = path.join(tmp, 'noisy.sh');
  fs.writeFileSync(rc, '#!/bin/sh\necho "welcome banner"\nexport DESK_PROBE="a=b\nc"\nexec /bin/sh -c "$2"\n', { mode: 0o755 });
  const env = await loginShellEnv({ shell: rc, ms: 5000 });
  assert.equal(env.DESK_PROBE, 'a=b\nc');
  assert.equal(await loginShellEnv({ shell: path.join(tmp, 'missing-shell'), ms: 2000 }), null);
});

test('0.2.x leftovers: nothing running → its files are removed, state.json stays', async () => {
  const dir = path.join(tmp, 'home');
  fs.mkdirSync(dir);
  for (const f of ['daemon.json', 'auth.json', 'open.html', 'state.json']) fs.writeFileSync(path.join(dir, f), f === 'daemon.json' ? JSON.stringify({ pid: 2 ** 22 + 7, port: 1 }) : '{}');
  assert.equal(await retireDaemon(dir), 'none');
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});
