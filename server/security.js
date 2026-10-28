// Who may report for a task. The UI needs no credential: it talks to the core over a MessagePort
// that the app hands only to its own window, and nothing listens on a network port.
import crypto from 'node:crypto';
import { randomHex, safeEqual } from './util.js';

export const hmac = (key, msg) => crypto.createHmac('sha256', key).update(String(msg)).digest('hex');

/**
 * hookRoot: per-run root; each task gets HMAC(hookRoot, taskId) so one agent can't speak for another.
 * It lives only in memory, so tokens from an earlier run are worthless.
 */
export class Auth {
  constructor() {
    this.hookRoot = randomHex(32);
  }

  hookTokenFor(taskId) {
    return hmac(this.hookRoot, taskId);
  }

  hookValid(req, taskId) {
    return typeof taskId === 'string' && safeEqual(String(req.headers['x-agentdesk-hook'] || ''), this.hookTokenFor(taskId));
  }
}
