import { useEffect, useState } from 'preact/hooks';
import { api, apiBlobUrl } from './api.js';
import { get } from './store.js';
import { hexToRgb } from './util.js';

/** projectId|logo -> Promise<url|null>; one fetch per logo for the life of the page. */
const cache = new Map();

/** Which logo a project shows: one the person picked, else the repo's own (unless turned off). */
function logoKey(project) {
  if (!project) return null;
  if (project.customLogo) return `${project.id}|${project.customLogo}`;
  return project.logo && project.showLogo !== false && project.kind !== 'group' ? `${project.id}|${project.logo}` : null;
}

export function useLogo(project) {
  const key = logoKey(project);
  const [url, setUrl] = useState(() => (key && cache.get(key)?.url) || null);
  useEffect(() => {
    if (!key) return setUrl(null);
    let entry = cache.get(key);
    if (!entry) {
      entry = { url: null, p: apiBlobUrl(`/api/projects/${project.id}/logo`).catch(() => null) };
      entry.p.then((u) => {
        entry.url = u;
        if (u) colorFromLogo(project.id, u);
      });
      cache.set(key, entry);
    }
    let alive = true;
    entry.p.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}

const SIDE = 256;

/**
 * Use an image file as the project's logo. Pictures are scaled down to fit 256px (a logo never
 * shows bigger), SVG goes as it is.
 */
export async function uploadLogo(projectId, file) {
  if (!file) return;
  let type = file.type;
  let data;
  if (type === 'image/svg+xml') {
    if (file.size > 600 * 1024) throw new Error('SVG 로고는 600KB까지 쓸 수 있어요');
    data = await base64(file);
  } else if (/^image\/(png|jpeg|webp|gif)$/.test(type)) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    type = 'image/png';
    data = await base64(blob);
  } else throw new Error('PNG·JPG·WebP·GIF·SVG 이미지만 쓸 수 있어요');
  return api('POST', `/api/projects/${projectId}/logo`, { type, data });
}

/** Ask for an image file, then use it as the project's logo. */
export function pickLogo(projectId, { onDone, onError } = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) uploadLogo(projectId, f).then(onDone, onError);
  };
  input.click();
}

export const clearLogo = (projectId) => api('DELETE', `/api/projects/${projectId}/logo`);

function base64(blob) {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * While a project's color is still automatic, take the palette color closest to its logo's
 * main hue (preferring one no other project uses). Done once per project, on the server's word.
 */
function colorFromLogo(projectId, url) {
  const p = get().projects.find((x) => x.id === projectId);
  if (!p || p.logoColorDone || p.auto?.color === false) return;
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      const buckets = new Array(24).fill(0);
      let total = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = hsl(d[i], d[i + 1], d[i + 2]);
        const w = (d[i + 3] / 255) * s;
        if (s < 0.25 || l < 0.12 || l > 0.9 || w <= 0) continue;
        buckets[Math.floor(h / 15) % 24] += w;
        total += w;
      }
      if (total < 8) return; // a gray or monochrome logo says nothing about color
      const best = buckets.indexOf(Math.max(...buckets)) * 15 + 7.5;
      const st = get();
      const used = new Set(st.projects.filter((q) => q.id !== projectId).map((q) => q.color.toUpperCase()));
      const ranked = st.palette
        .map((hex) => {
          const [r, g, b] = hexToRgb(hex);
          const [h] = hsl(r, g, b);
          const dh = Math.min(Math.abs(h - best), 360 - Math.abs(h - best));
          return { hex, dh: dh + (used.has(hex.toUpperCase()) ? 40 : 0) };
        })
        .sort((a, b) => a.dh - b.dh);
      if (ranked[0]) api('PATCH', `/api/projects/${projectId}`, { color: ranked[0].hex, logoColor: true }).catch(() => {});
    } catch {}
  };
  img.src = url;
}

function hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const dd = max - min;
  const s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
  const h = max === r ? (g - b) / dd + (g < b ? 6 : 0) : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return [h * 60, s, l];
}
