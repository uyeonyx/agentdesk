// Temporary diagnostic for Windows session matching (see .github/workflows/debug-paths.yml).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { boot, makeRepo } from './helpers.js';

const t = os.tmpdir();
console.log({ tmpdir: t, real: fs.realpathSync(t), native: fs.realpathSync.native(t), cwd: process.cwd() });
const ctx = await boot();
const repo = fs.realpathSync(makeRepo(path.join(ctx.tmp, 'shop')));
const proj = (await ctx.api('POST', '/api/projects', { path: repo })).json;
console.log({ repo, projPath: proj.path, native: fs.realpathSync.native(repo) });
const id = randomUUID();
const dir = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${id}.jsonl`), JSON.stringify({ type: 'user', cwd: repo, sessionId: id, message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }) + '\n');
const list = (await ctx.api('GET', '/api/sessions?fresh=1')).json.sessions;
console.log(JSON.stringify(list.find((x) => x.sessionId === id), null, 1));
console.log(JSON.stringify((await ctx.api('GET', '/api/state')).json.projects.map((p) => ({ id: p.id, path: p.path, kind: p.kind }))));
ctx.s.shutdown();
process.exit(0);
