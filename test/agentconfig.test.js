// Claude Code's own settings from the app: `claude mcp list` output (captured from 2.1.316), the
// arguments `claude mcp add` gets, and permission rules edited in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-ac-'));
process.env.CLAUDE_CONFIG_DIR = home;
const { parseMcpList, mcpAddArgs, mcpServers, permissions, editPermission, words } = await import('../server/agentconfig.js');

test('mcp list: names with spaces and colons, three kinds of status', () => {
  const s = parseMcpList(
    [
      'Checking MCP server health…',
      '',
      'claude.ai 에이전투두 (2): https://workspace.example.ts.net/mcp - ✘ Failed to connect — Version negotiation probe timed out after 5000ms',
      'claude.ai Railway: https://mcp.railway.com - ! Needs authentication',
      'plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ✔ Connected',
      'grafana-uyoolabs: /Users/u/.local/bin/mcp-grafana  - ✔ Connected',
    ].join('\n')
  );
  assert.deepEqual(
    s.map((x) => [x.name, x.status, x.source, x.target]),
    [
      ['claude.ai 에이전투두 (2)', 'fail', 'claude.ai', 'https://workspace.example.ts.net/mcp'],
      ['claude.ai Railway', 'auth', 'claude.ai', 'https://mcp.railway.com'],
      ['plugin:figma:figma', 'ok', 'plugin', 'https://mcp.figma.com/mcp'],
      ['grafana-uyoolabs', 'ok', '', '/Users/u/.local/bin/mcp-grafana'],
    ]
  );
});

test('mcp add: every value its own argument, nothing that reads as a flag or a shell', () => {
  assert.deepEqual(mcpAddArgs({ name: 'docs', kind: 'http', target: 'https://mcp.example.com/mcp', scope: 'user' }), ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'docs', 'https://mcp.example.com/mcp']);
  assert.deepEqual(mcpAddArgs({ name: 'pg', kind: 'stdio', target: 'npx server "postgres://h/db name"; rm -rf ~', scope: 'local', env: { TOKEN: 'x' } }), ['mcp', 'add', '--scope', 'local', '-e', 'TOKEN=x', 'pg', '--', 'npx', 'server', 'postgres://h/db name', ';', 'rm', '-rf', '~']);
  assert.throws(() => mcpAddArgs({ name: '--evil', kind: 'stdio', target: 'x', scope: 'user' }));
  assert.throws(() => mcpAddArgs({ name: 'a', kind: 'http', target: 'file:///etc/passwd', scope: 'user' }));
  assert.throws(() => mcpAddArgs({ name: 'a', kind: 'stdio', target: '--help', scope: 'user' }));
  assert.throws(() => mcpAddArgs({ name: 'a', kind: 'stdio', target: 'x', scope: 'everyone' }));
  assert.deepEqual(words(`a 'b c' "d"`), ['a', 'b c', 'd']);
});

test('mcp servers: user from .claude.json, local from its folder entry, project from .mcp.json', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-ac-p-'));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { u: { type: 'http', url: 'https://u' } }, projects: { [folder]: { mcpServers: { l: { command: 'node', args: ['s.js'], env: { K: 'secret' } } } } } }));
  fs.writeFileSync(path.join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { p: { type: 'sse', url: 'https://p' } } }));
  const list = mcpServers(folder);
  assert.deepEqual(list.map((x) => [x.name, x.scope, x.kind, x.target]), [['u', 'user', 'http', 'https://u'], ['l', 'local', 'stdio', 'node s.js'], ['p', 'project', 'sse', 'https://p']]);
  // Env values never leave the core; only their names.
  assert.deepEqual(list[1].env, ['K']);
  assert.ok(!JSON.stringify(list).includes('secret'));
  assert.deepEqual(mcpServers(null).map((x) => x.name), ['u']);
});

test('permissions: a rule added or removed in place, every other key kept, never both allowed and denied', () => {
  const f = path.join(home, 'settings.json');
  fs.writeFileSync(f, JSON.stringify({ model: 'opus', hooks: { Stop: [] }, permissions: { allow: ['Read'], deny: ['Bash(rm:*)'], defaultMode: 'auto' } }, null, 2));
  editPermission({ scope: 'user', kind: 'allow', rule: 'Bash(pnpm test:*)', op: 'add' }, null);
  let j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(j.model, 'opus');
  assert.deepEqual(j.hooks, { Stop: [] });
  assert.deepEqual(j.permissions.allow, ['Read', 'Bash(pnpm test:*)']);
  assert.equal(j.permissions.defaultMode, 'auto');
  // Moving a denied rule to allowed takes it out of deny.
  editPermission({ scope: 'user', kind: 'allow', rule: 'Bash(rm:*)', op: 'add' }, null);
  j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(j.permissions.deny, []);
  editPermission({ scope: 'user', kind: 'allow', rule: 'Read', op: 'remove' }, null);
  assert.deepEqual(permissions(null).files[0].allow, ['Bash(pnpm test:*)', 'Bash(rm:*)']);
  assert.throws(() => editPermission({ scope: 'user', kind: 'allow', rule: 'Bash(x)\n"}', op: 'add' }, null));
  assert.throws(() => editPermission({ scope: 'project', kind: 'allow', rule: 'Read', op: 'add' }, null));
  // A file that isn't JSON is left alone.
  fs.writeFileSync(f, '{ broken');
  assert.throws(() => editPermission({ scope: 'user', kind: 'allow', rule: 'Read', op: 'add' }, null), /JSON/);
  assert.equal(fs.readFileSync(f, 'utf8'), '{ broken');
});
