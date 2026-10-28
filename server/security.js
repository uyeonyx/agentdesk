// Everything that decides whether a request may touch this machine lives here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir, randomHex, safeEqual, readJson, writeJsonAtomic } from './util.js';

const CODE_TTL_MS = 120_000;
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const MAX_SESSIONS = 20;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const hmac = (key, msg) => crypto.createHmac('sha256', key).update(String(msg)).digest('hex');

/**
 * Three independent secrets:
 *  - cliSecret:  lets the local CLI ask for login links / shutdown. Never leaves this machine's files.
 *  - sessions:   per-login pair of (cookie token, page key). Only their hashes are stored.
 *                Browsers send localhost cookies to every port, so the cookie alone is never enough:
 *                API and WebSocket calls also need the page key, which lives in this origin's
 *                localStorage (origin = scheme + host + port, so other local servers can't read it).
 *  - hookRoot:   per-run root; each task gets HMAC(hookRoot, taskId) so one agent can't speak for another.
 */
export class Auth {
  constructor() {
    this.port = 0; // set once the server is listening
    this.file = path.join(dataDir(), 'auth.json');
    let data = readJson(this.file, null);
    if (!data || typeof data.cliSecret !== 'string' || data.cliSecret.length < 64) {
      data = { cliSecret: randomHex(32), sessions: [], createdAt: Date.now() };
    }
    if (!Array.isArray(data.sessions)) data.sessions = [];
    delete data.secret; // pre-0.1 single-secret format
    this.data = data;
    this.save();
    this.hookRoot = randomHex(32);
    this.codes = new Map(); // code -> expiry
  }

  save() {
    const now = Date.now();
    this.data.sessions = this.data.sessions.filter((s) => now - s.createdAt < SESSION_TTL_MS).slice(-MAX_SESSIONS);
    writeJsonAtomic(this.file, this.data);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {}
  }

  get cliSecret() {
    return this.data.cliSecret;
  }

  cookieName() {
    return `ad_${this.port}`;
  }

  // ---------------------------------------------------------------- login

  issueLoginCode() {
    const code = randomHex(24);
    this.codes.set(code, Date.now() + CODE_TTL_MS);
    return code;
  }

  consumeLoginCode(code) {
    if (typeof code !== 'string') return false;
    const now = Date.now();
    for (const [c, exp] of this.codes) if (exp < now) this.codes.delete(c);
    for (const [c] of this.codes) {
      if (safeEqual(c, code)) {
        this.codes.delete(c); // single use
        return true;
      }
    }
    return false;
  }

  /** New session: returns the cookie header and the page key (put in the URL fragment, never sent to a server). */
  newSession() {
    const cookie = randomHex(32);
    const key = randomHex(32);
    this.data.sessions.push({ c: sha(cookie), k: sha(key), createdAt: Date.now() });
    this.save();
    return {
      setCookie: `${this.cookieName()}=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
      key,
    };
  }

  sessionFor(req) {
    const v = parseCookies(req.headers.cookie || '')[this.cookieName()];
    if (!v || v.length !== 64) return null;
    const h = sha(v);
    return this.data.sessions.find((s) => safeEqual(s.c, h)) || null;
  }

  /** Cookie only: enough to load the static page, nothing else. */
  cookieValid(req) {
    return !!this.sessionFor(req);
  }

  /** Cookie + matching page key: required for every API call and the WebSocket. */
  fullyValid(req, key) {
    const s = this.sessionFor(req);
    if (!s || typeof key !== 'string' || key.length !== 64) return false;
    return safeEqual(s.k, sha(key));
  }

  // ---------------------------------------------------------------- machine endpoints

  cliValid(req) {
    return safeEqual(String(req.headers['x-agentdesk-secret'] || ''), this.cliSecret);
  }

  /** Lets the CLI check it's talking to the real daemon *before* revealing the secret. Bound to our port. */
  prove(nonce) {
    return hmac(this.cliSecret, `${nonce}:${this.port}`);
  }

  hookTokenFor(taskId) {
    return hmac(this.hookRoot, taskId);
  }

  hookValid(req, taskId) {
    return typeof taskId === 'string' && safeEqual(String(req.headers['x-agentdesk-hook'] || ''), this.hookTokenFor(taskId));
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Blocks DNS rebinding: only loopback host names with our exact port are accepted. */
export function hostAllowed(host, port) {
  if (typeof host !== 'string') return false;
  const h = host.toLowerCase();
  return h === `localhost:${port}` || h === `127.0.0.1:${port}`;
}

/** Exact-match allowlist. Browsers always send Origin on WebSocket and cross-site POST. */
export function allowedOrigins(port) {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

export function originAllowed(origin, port) {
  return typeof origin === 'string' && allowedOrigins(port).has(origin.toLowerCase());
}

export function securityHeaders(port) {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      // Monaco and xterm inject <style> elements at runtime.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
}
