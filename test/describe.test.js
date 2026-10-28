// Projects describe themselves: stack, one-line description, and their own logo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, makeRepo } from './helpers.js';
import { describe, safeLogo } from '../server/describe.js';

let ctx;
before(async () => {
  ctx = await boot();
});
after(() => ctx.s.shutdown(null));

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf000000020101007e2e1b5b0000000049454e44ae426082', 'hex');

test('Expo app: stack, README sentence (badges skipped), app.json icon', () => {
  const dir = makeRepo(path.join(ctx.tmp, 'glass'), {
    'package.json': JSON.stringify({ name: 'glass', dependencies: { expo: '1', 'react-native': '1' }, devDependencies: { typescript: '5' } }),
    'README.md': '# Glass\n\n[![build](https://x/badge.svg)](https://x)\n<img src="x.png">\n\n투명한 유리 질감의 [카톤](https://x) 디자인 시스템 앱이에요. 두 번째 문장.\n',
    'app.json': JSON.stringify({ expo: { icon: './assets/brand.png' } }),
  });
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/brand.png'), PNG);
  const d = describe(dir);
  assert.deepEqual(d.stack, ['Expo', 'TypeScript']);
  assert.equal(d.desc, 'Expo · TypeScript · 투명한 유리 질감의 카톤 디자인 시스템 앱이에요.');
  assert.equal(d.logo, 'assets/brand.png');
  assert.equal(d.icon, 'device-mobile');
  assert.equal(d.title, 'Glass');
});

test('Rust crate: Cargo description wins over README; favicon found in docs/', () => {
  const dir = makeRepo(path.join(ctx.tmp, 'kms'), { 'Cargo.toml': '[package]\nname = "kms"\ndescription = "FIPS 140-3 key management"\n', 'README.md': '# kms\n\nSomething else.\n' });
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const d = describe(dir);
  assert.equal(d.desc, 'Rust · FIPS 140-3 key management');
  assert.equal(d.logo, 'docs/logo.svg');
});

test('a logo can never point outside the repo', () => {
  const dir = makeRepo(path.join(ctx.tmp, 'sneaky'), { 'README.md': '# s\n', 'app.json': JSON.stringify({ expo: { icon: '../../etc/passwd.png' } }) });
  fs.writeFileSync(path.join(ctx.tmp, 'outside.png'), PNG);
  fs.symlinkSync(path.join(ctx.tmp, 'outside.png'), path.join(dir, 'logo.png'));
  assert.equal(describe(dir).logo, '');
  assert.equal(safeLogo(dir, '../outside.png'), null);
  assert.equal(safeLogo(dir, 'README.md'), null, 'only image files');
});

test('adding a project fills name, description, icon and logo; the logo is served only with the key', async () => {
  const dir = makeRepo(path.join(ctx.tmp, 'shop-front'), {
    'package.json': JSON.stringify({ name: 'shop-front', description: '쇼핑몰 프론트엔드', dependencies: { next: '15', react: '19' } }),
    'README.md': '# Shop Front\n',
  });
  fs.mkdirSync(path.join(dir, 'public'));
  fs.writeFileSync(path.join(dir, 'public/favicon.png'), PNG);
  const p = (await ctx.api('POST', '/api/projects', { path: dir })).json;
  assert.equal(p.name, 'Shop Front');
  assert.equal(p.desc, 'Next.js · 쇼핑몰 프론트엔드');
  assert.equal(p.icon, 'world');
  assert.equal(p.logo, 'public/favicon.png');
  // The logo comes back as bytes plus an image type; the window shows it as a blob in an <img>.
  const r = await ctx.api('GET', `/api/projects/${p.id}/logo`);
  assert.equal(r.status, 200);
  assert.equal(r.binary.type, 'image/png');
  assert.equal(Buffer.compare(Buffer.from(r.binary.data), PNG), 0);

  // A description typed in settings is kept; automatic refills leave it alone.
  await ctx.api('PATCH', `/api/projects/${p.id}`, { desc: '내가 쓴 설명', manual: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'shop-front', description: '바뀐 설명', dependencies: { next: '15' } }));
  // Logo color is applied once, and never over a color the person picked.
  assert.equal((await ctx.api('PATCH', `/api/projects/${p.id}`, { color: '#3D8EF0', logoColor: true })).json.color, '#3D8EF0');
  assert.equal((await ctx.api('PATCH', `/api/projects/${p.id}`, { color: '#E5484D', logoColor: true })).json.color, '#3D8EF0');
  const state = (await ctx.api('GET', '/api/state')).json.projects.find((x) => x.id === p.id);
  assert.equal(state.desc, '내가 쓴 설명');
  // "다시 채우기" is explicit, so it does refresh.
  assert.equal((await ctx.api('POST', `/api/projects/${p.id}/autofill`)).json.desc, 'Next.js · 바뀐 설명');
});
