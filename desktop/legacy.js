// Moving from 0.2.x (a CLI-started daemon on 127.0.0.1) to the app: stop that daemon so two Desks
// never write the same state, and remove the files only it used. Projects and tasks (state.json)
// carry over unchanged. Remove this file once 0.2.x is gone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson } from '../server/util.js';

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

async function post(port, what, headers, body) {
  const r = await fetch(`http://127.0.0.1:${port}/internal/${what}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(1500),
  });
  return r.json();
}

/** @returns {Promise<'none'|'stopped'|'unreachable'>} */
export async function retireDaemon(dir) {
  const info = readJson(path.join(dir, 'daemon.json'), null);
  const secret = readJson(path.join(dir, 'auth.json'), {}).cliSecret;
  let result = 'none';
  if (info?.port && info?.pid && secret && alive(info.pid)) {
    result = 'unreachable';
    try {
      // The old CLI's rule: the daemon proves it knows the secret before we send it.
      const nonce = crypto.randomBytes(24).toString('hex');
      const j = await post(info.port, 'hello', {}, { nonce });
      const want = crypto.createHmac('sha256', secret).update(`${nonce}:${info.port}`).digest('hex');
      if (typeof j.proof === 'string' && j.proof.length === want.length && crypto.timingSafeEqual(Buffer.from(j.proof), Buffer.from(want)) && j.pid === info.pid) {
        await post(info.port, 'shutdown', { 'x-agentdesk-secret': secret });
        for (let i = 0; i < 40 && alive(info.pid); i++) await new Promise((r) => setTimeout(r, 100));
        result = alive(info.pid) ? 'unreachable' : 'stopped';
      }
    } catch {}
  }
  if (result !== 'unreachable') {
    for (const f of ['daemon.json', 'auth.json', 'open.html', 'daemon.log']) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  }
  return result;
}
