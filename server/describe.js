// Fill in a project's identity from the repo itself: a one-line description, its stack, and
// its real logo if it has one. No network, no model: just files that are already there.
import fs from 'node:fs';
import path from 'node:path';

const LOGO_EXT = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp', '.ico']);
const LOGO_MAX = 512 * 1024;

const read = (dir, f, max = 256 * 1024) => {
  try {
    const p = path.join(dir, f);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size > max) return null;
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const json = (dir, f) => {
  try {
    return JSON.parse(read(dir, f) || 'null');
  } catch {
    return null;
  }
};
const exists = (dir, f) => {
  try {
    fs.accessSync(path.join(dir, f));
    return true;
  } catch {
    return false;
  }
};
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const tomlField = (text, section, key) => {
  if (!text) return '';
  const sec = text.split(/^\s*\[/m).find((b) => b.startsWith(section + ']'));
  const m = sec && sec.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"\\n]*)"`, 'm'));
  return m ? m[1] : '';
};

/** The stack in a few words, most specific first. */
function stackOf(dir, pkg) {
  const out = [];
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const has = (d) => Object.prototype.hasOwnProperty.call(deps, d);
  if (has('expo')) out.push('Expo');
  else if (has('react-native')) out.push('React Native');
  else if (has('next')) out.push('Next.js');
  else if (has('nuxt')) out.push('Nuxt');
  else if (has('@sveltejs/kit') || has('svelte')) out.push('Svelte');
  else if (has('astro')) out.push('Astro');
  else if (has('vue')) out.push('Vue');
  else if (has('electron')) out.push('Electron');
  else if (has('@nestjs/core')) out.push('NestJS');
  else if (has('react')) out.push('React');
  else if (has('preact')) out.push('Preact');
  else if (has('express') || has('fastify') || has('hono')) out.push('Node 서버');
  if (pkg && (has('typescript') || exists(dir, 'tsconfig.json')) && out.length < 2) out.push('TypeScript');
  else if (pkg && !out.length && !exists(dir, 'Cargo.toml')) out.push('Node');
  if (exists(dir, 'Cargo.toml')) out.push(exists(dir, 'src-tauri') ? 'Tauri' : 'Rust');
  if (exists(dir, 'src-tauri/Cargo.toml') && !out.includes('Tauri')) out.push('Tauri');
  if (exists(dir, 'go.mod')) out.push('Go');
  if (exists(dir, 'pubspec.yaml')) out.push('Flutter');
  if (exists(dir, 'Package.swift') || fs.readdirSync(dir).some((f) => f.endsWith('.xcodeproj'))) out.push('Swift');
  if (exists(dir, 'build.gradle.kts') || exists(dir, 'build.gradle')) out.push(exists(dir, 'build.gradle.kts') ? 'Kotlin' : 'Gradle');
  if (exists(dir, 'pom.xml')) out.push('Java');
  if (exists(dir, 'Gemfile')) out.push(read(dir, 'Gemfile')?.includes('rails') ? 'Rails' : 'Ruby');
  if (exists(dir, 'pyproject.toml') || exists(dir, 'requirements.txt') || exists(dir, 'setup.py')) {
    const py = (read(dir, 'pyproject.toml') || '') + (read(dir, 'requirements.txt') || '');
    out.push(/django/i.test(py) ? 'Django' : /fastapi/i.test(py) ? 'FastAPI' : /torch|tensorflow|transformers/i.test(py) ? 'Python ML' : 'Python');
  }
  if (fs.readdirSync(dir).some((f) => f.endsWith('.tf'))) out.push('Terraform');
  return [...new Set(out)].slice(0, 2);
}

/** First real sentence of the README: no title, badges, images, HTML or link lists. */
function readmeLine(dir) {
  const f = ['README.md', 'readme.md', 'README.MD', 'Readme.md', 'README'].find((x) => exists(dir, x));
  const text = f && read(dir, f, 512 * 1024);
  if (!text) return { title: '', line: '' };
  let title = '';
  let inCode = false;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (l.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !l) continue;
    const h = l.match(/^#\s+(.+)/);
    if (h) {
      if (!title) title = h[1].replace(/[*_`]/g, '').replace(/<[^>]+>/g, '').trim();
      continue;
    }
    if (/^(#{2,}|<|!\[|\[!\[|\||-{3,}|={3,}|>\s*\[!)/.test(l)) continue;
    if (/^[-*]\s*\[/.test(l)) continue;
    const clean = l
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_`>]/g, '')
      .trim();
    if (clean.length < 6) continue;
    return { title, line: clean.split(/(?<=[.!?。])\s/)[0] };
  }
  return { title, line: '' };
}

/** The project's own logo/icon, as a path inside the repo. */
function logoOf(dir, pkg) {
  const cands = [];
  // Expo / React Native: app.json says where the icon is.
  const app = json(dir, 'app.json');
  const expoIcon = app?.expo?.icon || app?.icon;
  if (typeof expoIcon === 'string') cands.push(expoIcon.replace(/^\.\//, ''));
  if (typeof pkg?.icon === 'string') cands.push(pkg.icon.replace(/^\.\//, ''));
  for (const base of ['', 'public/', 'static/', 'assets/', 'src/assets/', 'docs/', '.github/', 'resources/', 'build/', 'app/', 'src/app/', 'web/', 'images/', 'img/']) {
    for (const n of ['logo', 'icon', 'app-icon', 'apple-touch-icon', 'favicon', 'android-chrome-512x512', 'android-chrome-192x192', 'icon-512', 'icon-192', 'logo512', 'logo192']) {
      for (const e of ['.svg', '.png', '.webp', '.jpg', '.ico']) cands.push(base + n + e);
    }
  }
  cands.push('src-tauri/icons/icon.png', 'src-tauri/icons/128x128@2x.png', 'assets/images/icon.png', 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png');
  // iOS app icon: the largest image in AppIcon.appiconset.
  try {
    for (const top of fs.readdirSync(path.join(dir, 'ios'), { withFileTypes: true })) {
      if (!top.isDirectory()) continue;
      const set = path.join('ios', top.name, 'Images.xcassets', 'AppIcon.appiconset');
      if (!exists(dir, set)) continue;
      const pngs = fs.readdirSync(path.join(dir, set)).filter((f) => f.endsWith('.png'));
      pngs.sort((a, b) => fs.statSync(path.join(dir, set, b)).size - fs.statSync(path.join(dir, set, a)).size);
      if (pngs[0]) cands.push(path.join(set, pngs[0]));
    }
  } catch {}
  for (const c of cands) if (safeLogo(dir, c)) return c;
  return '';
}

/** A logo path is only used if it stays inside the repo, is a real image file, and is small. */
export function safeLogo(dir, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return null;
  if (!LOGO_EXT.has(path.extname(rel).toLowerCase())) return null;
  try {
    const root = fs.realpathSync(dir);
    const abs = fs.realpathSync(path.join(root, rel));
    if (!abs.startsWith(root + path.sep)) return null;
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size === 0 || st.size > LOGO_MAX) return null;
    return abs;
  } catch {
    return null;
  }
}

const ICON_BY_STACK = { Expo: 'device-mobile', 'React Native': 'device-mobile', Flutter: 'device-mobile', Swift: 'device-mobile', Kotlin: 'device-mobile', 'Next.js': 'world', Nuxt: 'world', Svelte: 'world', Astro: 'world', Vue: 'world', React: 'world', Electron: 'device-desktop', Tauri: 'device-desktop', NestJS: 'server', 'Node 서버': 'server', Go: 'server', Rust: 'cpu', Terraform: 'cloud', 'Python ML': 'brain', Django: 'server', FastAPI: 'server', Rails: 'server' };

/**
 * { desc, logo, stack, icon, title } for a project folder. Everything optional.
 */
export function describe(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return {};
  } catch {
    return {};
  }
  const pkg = json(dir, 'package.json');
  const stack = stackOf(dir, pkg);
  const own =
    pkg?.description ||
    tomlField(read(dir, 'Cargo.toml'), 'package', 'description') ||
    tomlField(read(dir, 'pyproject.toml'), 'project', 'description') ||
    tomlField(read(dir, 'pyproject.toml'), 'tool.poetry', 'description') ||
    json(dir, 'composer.json')?.description ||
    '';
  const rm = readmeLine(dir);
  const what = clip(own || rm.line, 90);
  const desc = clip([stack.join(' · '), what].filter(Boolean).join(' · '), 120);
  return { desc, logo: logoOf(dir, pkg), stack, icon: ICON_BY_STACK[stack[0]] || '', title: clip(rm.title, 40) };
}
