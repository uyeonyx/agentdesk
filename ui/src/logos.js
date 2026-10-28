import { useEffect, useState } from 'preact/hooks';
import { api, apiBlobUrl } from './api.js';
import { get } from './store.js';
import { hexToRgb } from './util.js';

/** projectId|logo -> Promise<url|null>; one fetch per logo for the life of the page. */
const cache = new Map();

export function useLogo(project) {
  const key = project && project.logo && project.showLogo !== false && project.kind !== 'group' ? `${project.id}|${project.logo}` : null;
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
