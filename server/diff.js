// Line diffs for the conversation view: hunks from Claude Code's structuredPatch, from two
// strings (Myers), or from a Codex apply_patch body. A hunk is { a, b, lines } where a/b are the
// 1-based first old/new line numbers (null when unknown) and each line starts with ' ', '-' or '+'.

const BIG = 4000; // lines; past this a diff costs more than it shows
const MAX_D = 1500; // edit distance past which two texts count as rewritten

/** Claude Code's structuredPatch → hunks, at most maxLines lines in all. */
export function hunksFromStructured(structuredPatch, maxLines = Infinity) {
  if (!Array.isArray(structuredPatch)) return [];
  const hunks = [];
  for (const h of structuredPatch) {
    if (!h || !Array.isArray(h.lines)) continue;
    // "\ No newline at end of file" is metadata, not a line of the file.
    const lines = h.lines.filter((l) => typeof l === 'string' && /^[ +-]/.test(l));
    hunks.push({ a: num(h.oldStart), b: num(h.newStart), lines });
  }
  return capHunks(hunks, maxLines).hunks;
}

/** Keep the first maxLines lines across all hunks; clipped says something was dropped. */
export function capHunks(hunks, maxLines = Infinity) {
  const out = [];
  let left = maxLines;
  let clipped = false;
  for (const h of hunks) {
    if (left <= 0) {
      clipped = true;
      break;
    }
    if (h.lines.length > left) {
      out.push({ ...h, lines: h.lines.slice(0, left) });
      clipped = true;
      left = 0;
    } else {
      out.push(h);
      left -= h.lines.length;
    }
  }
  return { hunks: out, clipped };
}

/** Lines added and removed. */
export function stats(hunks) {
  let adds = 0;
  let dels = 0;
  for (const h of hunks || []) {
    for (const l of h.lines || []) {
      if (l[0] === '+') adds++;
      else if (l[0] === '-') dels++;
    }
  }
  return { adds, dels };
}

const splitLines = (s) => {
  const t = String(s ?? '');
  if (!t) return [];
  const lines = t.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/** Unified-diff hunks between two texts, with `context` unchanged lines around each change. */
export function diffLines(a, b, { context = 3, maxLines = Infinity } = {}) {
  const A = splitLines(a);
  const B = splitLines(b);
  if (A.length > BIG || B.length > BIG) return capHunks([replaceAll(A, B)], maxLines).hunks;
  const ops = editScript(A, B);
  if (!ops) return capHunks([replaceAll(A, B)], maxLines).hunks;
  return capHunks(group(ops, context), maxLines).hunks;
}

const replaceAll = (A, B) => ({ a: A.length ? 1 : 0, b: B.length ? 1 : 0, lines: [...A.map((l) => '-' + l), ...B.map((l) => '+' + l)] });

/**
 * Edit script as [{ t: '='|'-'|'+', text }]. Common head and tail are matched first, Myers
 * runs on the rest; null when the middle is too different to be worth aligning.
 */
function editScript(A, B) {
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
  const mid = myers(A.slice(head, A.length - tail), B.slice(head, B.length - tail));
  if (!mid) return null;
  return [...A.slice(0, head).map((text) => ({ t: '=', text })), ...mid, ...A.slice(A.length - tail).map((text) => ({ t: '=', text }))];
}

/** Myers' O(ND) diff. Keeps one V snapshot per step for the walk back, so D is bounded. */
function myers(A, B) {
  const N = A.length;
  const M = B.length;
  if (!N) return B.map((text) => ({ t: '+', text }));
  if (!M) return A.map((text) => ({ t: '-', text }));
  const max = N + M;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let D = -1;
  for (let d = 0; d <= Math.min(max, MAX_D); d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= N && y >= M) {
        D = d;
        break;
      }
    }
    trace.push(v.slice(off - d, off + d + 1));
    if (D >= 0) break;
  }
  if (D < 0) return null;
  // Walk back from (N, M), one step of d at a time.
  const ops = [];
  let x = N;
  let y = M;
  for (let d = D; d > 0; d--) {
    const prev = trace[d - 1];
    const at = (k) => prev[k + d - 1];
    const k = x - y;
    const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    for (; x > px && y > py; y--) ops.push({ t: '=', text: A[--x] });
    if (x === px) ops.push({ t: '+', text: B[--y] });
    else ops.push({ t: '-', text: A[--x] });
  }
  for (; x > 0 && y > 0; y--) ops.push({ t: '=', text: A[--x] });
  return ops.reverse();
}

/** Edit script → hunks with context, numbered like `diff -u`. */
function group(ops, context) {
  const hunks = [];
  let i = 0;
  let oldNo = 0; // old lines before ops[i]
  let newNo = 0;
  const advance = (to) => {
    for (; i < to; i++) {
      if (ops[i].t !== '+') oldNo++;
      if (ops[i].t !== '-') newNo++;
    }
  };
  while (i < ops.length) {
    let first = i;
    while (first < ops.length && ops[first].t === '=') first++;
    if (first >= ops.length) break;
    // The hunk ends where `2 * context` unchanged lines in a row (or the end) follow a change.
    let last = first;
    for (let j = first; j < ops.length; j++) {
      if (ops[j].t !== '=') last = j;
      else if (j - last > 2 * context) break;
    }
    const start = Math.max(i, first - context);
    const end = Math.min(ops.length - 1, last + context);
    advance(start);
    const lines = [];
    let olds = 0;
    let news = 0;
    for (let j = start; j <= end; j++) {
      const o = ops[j];
      lines.push((o.t === '=' ? ' ' : o.t) + o.text);
      if (o.t !== '+') olds++;
      if (o.t !== '-') news++;
    }
    // An empty side is numbered by the line before it, as `diff -u` does (`-0,0`).
    hunks.push({ a: olds ? oldNo + 1 : oldNo, b: news ? newNo + 1 : newNo, lines });
    advance(end + 1);
  }
  return hunks;
}

/**
 * Codex apply_patch body → [{ path, op, to?, hunks }]. Accepts the bare patch or a command
 * that wraps it (`apply_patch <<'EOF' … EOF`). Line numbers are not in the format: a/b are null.
 */
export function parseApplyPatch(text) {
  const src = String(text ?? '');
  const begin = src.indexOf('*** Begin Patch');
  const body = (begin >= 0 ? src.slice(begin) : src).split('\n');
  const files = [];
  let file = null;
  let hunk = null;
  const newHunk = () => {
    hunk = { a: null, b: null, lines: [] };
    file.hunks.push(hunk);
  };
  for (const raw of body) {
    const line = raw.replace(/\r$/, '');
    let m;
    if (line.startsWith('*** Begin Patch')) continue;
    if (line.startsWith('*** End Patch')) break;
    if (line.startsWith('*** End of File')) continue;
    if ((m = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/))) {
      file = { path: m[2].trim(), op: m[1] === 'Add' ? 'create' : m[1] === 'Delete' ? 'delete' : 'edit', hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if ((m = line.match(/^\*\*\* Move to: (.+)$/))) {
      file.op = 'move';
      file.to = m[1].trim();
      continue;
    }
    if (line.startsWith('@@')) {
      newHunk();
      continue;
    }
    if (file.op === 'delete') continue;
    if (!hunk) newHunk();
    // Every body line starts with ' ', '+' or '-'; a bare empty line is an empty context line.
    hunk.lines.push(/^[ +-]/.test(line) ? line : ' ' + line);
  }
  for (const f of files) f.hunks = f.hunks.filter((h) => h.lines.length);
  return files;
}

/** A unified diff (`@@ -a,n +b,m @@` sections) → hunks. Lines before any header form one unnumbered hunk. */
export function parseUnifiedDiff(text) {
  const hunks = [];
  let hunk = null;
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) {
      hunk = { a: +m[1], b: +m[2], lines: [] };
      hunks.push(hunk);
      continue;
    }
    if (/^(?:--- |\+\+\+ |diff |index |\\)/.test(line)) continue;
    if (!/^[ +-]/.test(line)) continue;
    if (!hunk) {
      hunk = { a: null, b: null, lines: [] };
      hunks.push(hunk);
    }
    hunk.lines.push(line);
  }
  return hunks.filter((h) => h.lines.length);
}

const num = (n) => (Number.isFinite(n) ? n : null);
