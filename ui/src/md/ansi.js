// Terminal output → styled segments. Only SGR styling survives; every other escape
// (cursor moves, OSC titles/hyperlinks, DCS…) and stray control characters are dropped.

// Alternatives, in order: CSI (ESC[ or 8-bit 0x9b), OSC/DCS/SOS/PM/APC strings (BEL or ST
// terminated; an unterminated one ends at the line), other ESC sequences, CR, LF, C0/C1 controls.
const ESC_RE =
  /(?:\x1b\[|\x9b)([0-?]*)([ -/]*)([@-~])|(?:\x1b[\]PX^_]|[\x90\x98\x9d\x9e\x9f])[^\x07\x1b\x9c\n]*(?:\x07|\x1b\\|\x9c)?|\x1b[ -/]*[0-~]?|\r|\n|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

const hex2 = (n) => n.toString(16).padStart(2, '0');
const rgb = (r, g, b) => ([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255) ? { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}` } : null);

/** xterm 256-color index: 0–15 stay theme colors, the cube and gray ramp become hex. */
function c256(n) {
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  if (n < 16) return { ansi: n };
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return rgb(v, v, v);
  }
  const lv = [0, 95, 135, 175, 215, 255];
  const i = n - 16;
  return rgb(lv[Math.floor(i / 36)], lv[Math.floor(i / 6) % 6], lv[i % 6]);
}

// Extended color from numbers after 38/48: [5, n] or [2, r, g, b]. Returns [color, used].
function extColor(p) {
  if (p[0] === 5) return [c256(p[1]), 2];
  if (p[0] === 2) return [rgb(p[1], p[2], p[3]), 4];
  return [null, 1];
}

function setColor(s, key, c) {
  if (c) s[key] = c;
}

/** Applies one SGR parameter string to a copy of the style. */
function sgr(prev, params) {
  const s = { ...prev };
  const f = params.split(';');
  for (let i = 0; i < f.length; i++) {
    if (f[i].includes(':')) {
      // ITU form: 38:5:n, 38:2:r:g:b or 38:2:cs:r:g:b, 4:3 (curly underline)…
      const sub = f[i].split(':').map((x) => (x === '' ? NaN : +x));
      if (sub[0] === 38 || sub[0] === 48) {
        const rest = sub[1] === 2 && sub.length >= 6 ? [2, ...sub.slice(3)] : sub.slice(1);
        setColor(s, sub[0] === 38 ? 'fg' : 'bg', extColor(rest)[0]);
      } else if (sub[0] === 4) {
        if (sub[1] === 0) delete s.underline;
        else s.underline = true;
      }
      continue;
    }
    const n = f[i] === '' ? 0 : +f[i];
    if (n === 38 || n === 48) {
      const [c, used] = extColor(f.slice(i + 1, i + 5).map(Number));
      setColor(s, n === 38 ? 'fg' : 'bg', c);
      i += used;
    } else if (n === 0) for (const k in s) delete s[k];
    else if (n >= 30 && n <= 37) s.fg = { ansi: n - 30 };
    else if (n >= 90 && n <= 97) s.fg = { ansi: n - 82 };
    else if (n >= 40 && n <= 47) s.bg = { ansi: n - 40 };
    else if (n >= 100 && n <= 107) s.bg = { ansi: n - 92 };
    else if (ON[n]) s[ON[n]] = true;
    else for (const k of OFF[n] || []) delete s[k];
  }
  return s;
}

const ON = { 1: 'bold', 2: 'dim', 3: 'italic', 4: 'underline' };
const OFF = { 22: ['bold', 'dim'], 23: ['italic'], 24: ['underline'], 39: ['fg'], 49: ['bg'] };

/** Text with ANSI escapes → [{ text, fg?, bg?, bold?, dim?, italic?, underline? }]; colors are { ansi: 0–15 } or { hex }. */
export function ansiSegments(input) {
  const src = String(input ?? '').replace(/\r\n/g, '\n');
  const pieces = []; // { text, st, key } before merging
  let st = {};
  let key = '{}';
  let lineStart = 0; // pieces index where the current line begins
  let cr = false; // carriage return seen: the next text on this line overwrites what's there

  const text = (t) => {
    if (!t) return;
    if (cr) {
      pieces.length = lineStart;
      cr = false;
    }
    pieces.push({ text: t, st, key });
  };

  let at = 0;
  for (const m of src.matchAll(ESC_RE)) {
    text(src.slice(at, m.index));
    at = m.index + m[0].length;
    const tok = m[0];
    if (tok === '\n') {
      cr = false; // a line ending never overwrites its own line
      text('\n');
      lineStart = pieces.length;
    } else if (tok === '\r') cr = true;
    else if (m[3] === 'm' && !m[2] && !/[<=>?]/.test(m[1])) {
      st = sgr(st, m[1]);
      key = JSON.stringify(st);
    } else if (m[3] === 'G' && (+m[1] || 1) === 1) cr = true; // cursor to column 1: same as \r
  }
  text(src.slice(at));

  const out = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.key === p.key) last.text += p.text;
    else out.push({ text: p.text, key: p.key, st: p.st });
  }
  return out.map((p) => ({ text: p.text, ...p.st }));
}
