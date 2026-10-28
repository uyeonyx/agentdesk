// Updates without code signing: the app checks GitHub Releases, downloads the build for this OS
// on request, and checks it against SHA256SUMS signed by the release workflow's Ed25519 key
// (desktop/update-key.js). The swap happens when the app quits, never under running agents.
// The pure parts (versions, asset choice, verification) take no Electron and are unit tested.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const REPO = 'uyeonyx/agentdesk';
export const APP_ID = 'dev.uyeon.agentdesk';

/** -1, 0 or 1. Pre-releases (1.2.0-beta.1) sort before their release. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = ''] = String(v).replace(/^v/, '').split('-', 2);
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] || 0) !== (y.nums[i] || 0)) return (x.nums[i] || 0) > (y.nums[i] || 0) ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** The file this machine installs: `AgentDesk-<v>-mac-<arch>.zip` or `AgentDesk-<v>-win-<arch>.exe`. */
export function assetName(version, platform, arch) {
  const v = String(version).replace(/^v/, '');
  if (platform === 'darwin') return `AgentDesk-${v}-mac-${arch}.zip`;
  if (platform === 'win32') return `AgentDesk-${v}-win-${arch}.exe`;
  return null;
}

/** From a GitHub "latest release" response: {version, notes, url, asset, sums, sig} or null if nothing newer. */
export function pickUpdate(release, current, platform, arch) {
  if (!release || release.draft || release.prerelease) return null;
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!version || compareVersions(version, current) <= 0) return null;
  const byName = new Map((release.assets || []).map((a) => [a.name, a]));
  const name = assetName(version, platform, arch);
  const asset = byName.get(name);
  const sums = byName.get('SHA256SUMS');
  const sig = byName.get('SHA256SUMS.sig');
  if (!asset || !sums || !sig) return null;
  const url = (a) => a.browser_download_url;
  return { version, notes: String(release.body || '').slice(0, 2000), page: release.html_url, asset: { name, url: url(asset), size: asset.size }, sums: url(sums), sig: url(sig) };
}

/**
 * True only if `sumsText` carries a valid Ed25519 signature by `publicKeyPem` and lists `fileName`
 * with exactly `fileSha256`.
 */
export function verifyDownload({ sumsText, sigBase64, publicKeyPem, fileName, fileSha256 }) {
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(sumsText, 'utf8'), crypto.createPublicKey(publicKeyPem), Buffer.from(String(sigBase64).trim(), 'base64'));
  } catch {
    return false;
  }
  if (!ok) return false;
  for (const line of sumsText.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim() === fileName) return m[1].toLowerCase() === String(fileSha256).toLowerCase();
  }
  return false;
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** CFBundleIdentifier and CFBundleShortVersionString of an unpacked .app (XML Info.plist). */
export function bundleInfo(appDir) {
  try {
    const plist = fs.readFileSync(path.join(appDir, 'Contents', 'Info.plist'), 'utf8');
    const get = (k) => plist.match(new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`))?.[1];
    return { id: get('CFBundleIdentifier'), version: get('CFBundleShortVersionString') };
  } catch {
    return {};
  }
}

/** The .app this process runs from, or null when it can't be replaced in place (read-only, App Translocation). */
export function replaceableApp(execPath) {
  const app = path.resolve(execPath, '..', '..', '..');
  if (!app.endsWith('.app') || app.includes('/AppTranslocation/') || app.startsWith('/Volumes/')) return null;
  try {
    fs.accessSync(path.dirname(app), fs.constants.W_OK);
    fs.accessSync(app, fs.constants.W_OK);
    return app;
  } catch {
    return null;
  }
}

/**
 * Shell script that waits for `pid` to exit, moves the old .app to the Trash, puts the new one in
 * its place and opens it. If the swap fails it reopens whatever is there.
 */
export function macSwapScript() {
  return `#!/bin/sh
# $1 pid of the quitting app, $2 installed .app, $3 new .app
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
old="$HOME/.Trash/$(basename "$2" .app) $(date +%Y%m%d%H%M%S).app"
if mv "$2" "$old"; then
  mv "$3" "$2" || mv "$old" "$2"
fi
open "$2"
`;
}
