import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
const watch = process.argv.includes('--watch');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.copyFileSync(path.join(here, 'index.html'), path.join(out, 'index.html'));

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: false,
  logLevel: 'warning',
  legalComments: 'none',
  loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.svg': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
};

const app = {
  ...common,
  entryPoints: { app: path.join(here, 'src', 'main.jsx') },
  outdir: path.join(out, 'assets'),
  format: 'esm',
  splitting: true,
  chunkNames: 'c/[name]-[hash]',
  assetNames: 'f/[name]-[hash]',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  target: ['chrome115', 'safari16', 'firefox115'],
};

const worker = {
  ...common,
  entryPoints: { 'editor.worker': 'monaco-editor/editor/editor.worker.js' },
  outdir: path.join(out, 'assets'),
  format: 'iife',
  target: ['chrome115', 'safari16', 'firefox115'],
};

if (watch) {
  const a = await esbuild.context(app);
  const w = await esbuild.context(worker);
  await Promise.all([a.watch(), w.watch()]);
  console.log('watching…');
} else {
  await Promise.all([esbuild.build(app), esbuild.build(worker)]);
  // Every supported browser takes the woff2 entry first, so the woff/ttf fallbacks are dead weight.
  const fdir = path.join(out, 'assets', 'f');
  for (const f of fs.readdirSync(fdir)) if (/^tabler-icons.*\.(woff|ttf)$/.test(f)) fs.rmSync(path.join(fdir, f));
  const size = (d) => fs.readdirSync(d, { recursive: true }).reduce((s, f) => {
    const p = path.join(d, f);
    return fs.statSync(p).isFile() ? s + fs.statSync(p).size : s;
  }, 0);
  console.log(`built ui/dist (${(size(out) / 1e6).toFixed(1)} MB)`);
}
