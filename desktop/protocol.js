// The window's side of the boundary, kept free of Electron so tests can run it under plain Node:
// which files app://desk/ serves, with what policy, which frames count as ours, and which links
// may leave the app.
import fs from 'node:fs';
import path from 'node:path';
import { resolveInside } from '../server/util.js';

export const ORIGIN = 'app://desk';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Monaco and xterm inject <style> elements at runtime.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

const HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };

/**
 * A request for app://desk/<path> → {status, headers, body}. Paths without an extension get the
 * page (the UI routes on its own); nothing outside `dist` is ever read, symlinks included.
 */
export function serve(dist, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { status: 400, headers: HEADERS, body: '' };
  }
  if (`${u.protocol}//${u.host}` !== ORIGIN) return { status: 404, headers: HEADERS, body: '' };
  let p;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return { status: 400, headers: HEADERS, body: '' };
  }
  const rel = p === '/' || !path.extname(p) ? 'index.html' : p.replace(/^\/+/, '');
  const abs = resolveInside(dist, rel);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return { status: 404, headers: HEADERS, body: '' };
  // Module scripts and fonts are refused without the right type.
  return { status: 200, headers: { ...HEADERS, 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream' }, body: fs.readFileSync(abs) };
}

/** Only the app's own top-level page may talk to the core. */
export function isTrustedFrame(frame) {
  if (!frame || frame.parent) return false;
  try {
    const u = new URL(frame.url);
    return `${u.protocol}//${u.host}` === ORIGIN;
  } catch {
    return false;
  }
}

/** Links the app hands to the OS: web pages (PRs, the Claude app) and VS Code. Nothing else leaves. */
export function isExternalAllowed(url) {
  try {
    return ['https:', 'http:', 'vscode:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
