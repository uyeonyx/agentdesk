/** Tiny LRU on Map insertion order: a hit moves the key to the end, overflow drops the oldest. */
export function lru(max = 200) {
  const m = new Map();
  return {
    get(k) {
      if (!m.has(k)) return undefined;
      const v = m.get(k);
      m.delete(k);
      m.set(k, v);
      return v;
    },
    set(k, v) {
      m.delete(k);
      m.set(k, v);
      if (m.size > max) m.delete(m.keys().next().value);
      return v;
    },
  };
}
