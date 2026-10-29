// Themes the person imported (VS Code, Ghostty, iTerm2…), kept as normalized JSON in
// ~/.agentdesk/themes. The window parses and validates the colors; here we only check the shape
// and size, and never serve anything but these files.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, writeJsonAtomic } from './util.js';
import { httpError } from './projects.js';

const ID = /^user-[a-z0-9][a-z0-9-]{0,62}$/;
const MAX = 200 * 1024;
const dir = () => path.join(dataDir(), 'themes');

function valid(t) {
  return t && typeof t === 'object' && typeof t.name === 'string' && t.name.length <= 120 && t.base && typeof t.base.bg === 'string' && typeof t.base.fg === 'string' && Array.isArray(t.ansi) && t.ansi.length === 16 && t.ansi.every((c) => typeof c === 'string' && c.length <= 40);
}

export function listThemes() {
  let names = [];
  try {
    names = fs.readdirSync(dir()).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const id = n.slice(0, -5);
    if (!ID.test(id)) continue;
    try {
      const st = fs.lstatSync(path.join(dir(), n));
      if (!st.isFile() || st.size > MAX) continue;
      const t = JSON.parse(fs.readFileSync(path.join(dir(), n), 'utf8'));
      if (valid(t)) out.push({ ...t, id });
    } catch {}
  }
  return out;
}

export function saveTheme(id, t) {
  if (!ID.test(id)) throw httpError(400, '테마 이름이 올바르지 않아요');
  if (!valid(t) || JSON.stringify(t).length > MAX) throw httpError(400, '테마 파일을 읽을 수 없어요');
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  writeJsonAtomic(path.join(dir(), `${id}.json`), { ...t, id });
  return { ok: true };
}

export function removeTheme(id) {
  if (!ID.test(id)) throw httpError(400, '테마 이름이 올바르지 않아요');
  try {
    fs.unlinkSync(path.join(dir(), `${id}.json`));
  } catch {}
  return { ok: true };
}
