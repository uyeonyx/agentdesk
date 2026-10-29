// Diff hunks → display rows with old/new line numbers, plus word-level marks for one-line edits.

const CAP = 400; // longer lines: whole-line highlight only, the LCS table would grow quadratically
const TOK = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

const num = (n) => (Number.isInteger(n) ? n : null);
const next = (n) => (n == null ? null : n + 1);

/** [{ a, b, lines:[' ctx','-old','+new'] }] → [{ kind:'add'|'del'|'ctx'|'gap', aLine, bLine, text, parts? }] */
export function diffRows(hunks) {
  const rows = [];
  for (const h of hunks || []) {
    if (rows.length) rows.push({ kind: 'gap', aLine: null, bLine: null, text: '' });
    let a = num(h.a);
    let b = num(h.b);
    for (const raw of h.lines || []) {
      const sig = raw[0];
      if (sig === '\\') continue; // "\ No newline at end of file"
      if (sig === '+') {
        rows.push({ kind: 'add', aLine: null, bLine: b, text: raw.slice(1) });
        b = next(b);
      } else if (sig === '-') {
        rows.push({ kind: 'del', aLine: a, bLine: null, text: raw.slice(1) });
        a = next(a);
      } else {
        rows.push({ kind: 'ctx', aLine: a, bLine: b, text: sig === ' ' ? raw.slice(1) : raw });
        a = next(a);
        b = next(b);
      }
    }
  }
  markPairs(rows);
  return rows;
}

// A lone del followed by a lone add is an in-place edit: attach word parts to both rows.
function markPairs(rows) {
  for (let i = 0; i + 1 < rows.length; i++) {
    if (rows[i].kind !== 'del' || rows[i + 1].kind !== 'add') continue;
    if (rows[i - 1]?.kind === 'del' || rows[i + 2]?.kind === 'add') continue;
    const w = wordDiff(rows[i].text, rows[i + 1].text);
    // Marks only help when the lines share real words; otherwise the whole line is the change.
    const shared = w.old.some((p) => !p.changed && p.text.trim());
    const changed = w.old.some((p) => p.changed) || w.new.some((p) => p.changed);
    if (shared && changed) {
      rows[i].parts = w.old;
      rows[i + 1].parts = w.new;
    }
  }
}

function add(parts, text, changed) {
  const last = parts[parts.length - 1];
  if (last && last.changed === changed) last.text += text;
  else parts.push({ text, changed });
}

/** Token-level LCS between two lines → { old:[{text, changed}], new:[{text, changed}] }. */
export function wordDiff(oldLine, newLine) {
  const a = String(oldLine ?? '');
  const b = String(newLine ?? '');
  if (a.length > CAP || b.length > CAP) {
    return { old: a ? [{ text: a, changed: true }] : [], new: b ? [{ text: b, changed: true }] : [] };
  }
  const x = a.match(TOK) || [];
  const y = b.match(TOK) || [];
  const n = x.length;
  const m = y.length;
  // L[i][j] = LCS length of x[i..] and y[j..]
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const old = [];
  const nu = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      add(old, x[i++], false);
      add(nu, y[j++], false);
    } else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) add(nu, y[j++], true);
    else add(old, x[i++], true);
  }
  return { old, new: nu };
}
