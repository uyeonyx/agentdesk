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

// ------------------------------------------------------------ updates

import crypto from 'node:crypto';
import { compareVersions, assetName, pickUpdate, verifyDownload, bundleInfo, replaceableApp } from '../desktop/update.js';

test('versions compare numerically; a pre-release comes before its release', () => {
  assert.equal(compareVersions('0.3.10', '0.3.9'), 1);
  assert.equal(compareVersions('v0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.3.0-beta.1', '0.3.0'), -1);
  assert.equal(compareVersions('0.3.0', '0.2.99'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
});

const release = (tag, names, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/uyeonyx/agentdesk/releases/tag/${tag}`,
  body: 'notes',
  assets: names.map((name) => ({ name, size: 10, browser_download_url: `https://example.test/${name}` })),
  ...extra,
});

test('an update is offered only when newer, complete, and built for this OS and CPU', () => {
  const all = ['AgentDesk-0.4.0-mac-arm64.zip', 'AgentDesk-0.4.0-mac-x64.zip', 'AgentDesk-0.4.0-win-x64.exe', 'SHA256SUMS', 'SHA256SUMS.sig'];
  const u = pickUpdate(release('v0.4.0', all), '0.3.0', 'darwin', 'arm64');
  assert.equal(u.version, '0.4.0');
  assert.equal(u.asset.name, 'AgentDesk-0.4.0-mac-arm64.zip');
  assert.equal(pickUpdate(release('v0.4.0', all), '0.3.0', 'win32', 'x64').asset.name, 'AgentDesk-0.4.0-win-x64.exe');
  assert.equal(pickUpdate(release('v0.4.0', all), '0.4.0', 'darwin', 'arm64'), null, 'same version');
  assert.equal(pickUpdate(release('v0.4.0', all), '0.3.0', 'win32', 'arm64'), null, 'no build for this CPU');
  assert.equal(pickUpdate(release('v0.4.0', all.filter((n) => n !== 'SHA256SUMS.sig')), '0.3.0', 'darwin', 'arm64'), null, 'unsigned release');
  assert.equal(pickUpdate(release('v0.4.0', all, { prerelease: true }), '0.3.0', 'darwin', 'arm64'), null);
  assert.equal(assetName('0.4.0', 'linux', 'x64'), null);
});

test('a download is accepted only with our signature over its checksum', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const file = 'AgentDesk-0.4.0-mac-arm64.zip';
  const sha = 'a'.repeat(64);
  const sums = `${sha}  ${file}\n${'b'.repeat(64)}  AgentDesk-0.4.0-win-x64.exe\n`;
  const sign = (text, key = privateKey) => crypto.sign(null, Buffer.from(text), key).toString('base64');
  assert.ok(verifyDownload({ sumsText: sums, sigBase64: sign(sums), publicKeyPem: pem, fileName: file, fileSha256: sha }));
  assert.ok(!verifyDownload({ sumsText: sums, sigBase64: sign(sums), publicKeyPem: pem, fileName: file, fileSha256: 'c'.repeat(64) }), 'file changed');
  assert.ok(!verifyDownload({ sumsText: sums, sigBase64: sign(sums, other), publicKeyPem: pem, fileName: file, fileSha256: sha }), 'someone else signed');
  const forged = sums.replace(sha, 'c'.repeat(64));
  assert.ok(!verifyDownload({ sumsText: forged, sigBase64: sign(sums), publicKeyPem: pem, fileName: file, fileSha256: 'c'.repeat(64) }), 'checksums edited after signing');
  assert.ok(!verifyDownload({ sumsText: sums, sigBase64: sign(sums), publicKeyPem: pem, fileName: 'Other.zip', fileSha256: sha }), 'file not listed');
  assert.ok(!verifyDownload({ sumsText: sums, sigBase64: 'garbage', publicKeyPem: pem, fileName: file, fileSha256: sha }));
});

test('the shipped public key is a valid Ed25519 key', async () => {
  const { PUBLIC_KEY } = await import('../desktop/update-key.js');
  assert.equal(crypto.createPublicKey(PUBLIC_KEY).asymmetricKeyType, 'ed25519');
});

test('a downloaded .app is checked by bundle id and version; only a writable, installed copy swaps itself', () => {
  const appDir = path.join(tmp, 'Apps', 'Agent Desk.app');
  fs.mkdirSync(path.join(appDir, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'Contents', 'Info.plist'), '<plist><dict><key>CFBundleIdentifier</key>\n<string>dev.uyeon.agentdesk</string><key>CFBundleShortVersionString</key><string>0.4.0</string></dict></plist>');
  assert.deepEqual(bundleInfo(appDir), { id: 'dev.uyeon.agentdesk', version: '0.4.0' });
  assert.deepEqual(bundleInfo(path.join(tmp, 'missing.app')), {});
  const exe = path.join(appDir, 'Contents', 'MacOS', 'Agent Desk');
  if (process.platform !== 'win32') assert.equal(replaceableApp(exe), appDir);
  assert.equal(replaceableApp('/private/var/folders/x/AppTranslocation/ABC/d/Agent Desk.app/Contents/MacOS/Agent Desk'), null);
  assert.equal(replaceableApp('/Volumes/Agent Desk/Agent Desk.app/Contents/MacOS/Agent Desk'), null);
});
