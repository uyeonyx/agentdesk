// Every shortcut in one table: the dispatcher, the '?' sheet, tooltips and settings all read it.
// Keys match on `e.code`, so they work the same with the Korean input source on.
import { isMac } from '../util.js';

/**
 * scope 'global': works even while typing (needs a modifier, or Esc).
 * scope 'nav': only when no text box, terminal or editor has focus.
 */
export const KEYS = [];
const handlers = new Map();

export function key(id, { code, mod = false, shift = false, alt = false, ctrl = false, scope = 'nav', label, group = '일반', hint }, run) {
  KEYS.push({ id, code: [].concat(code), mod, shift, alt, ctrl, scope, label, group, hint });
  handlers.set(id, run);
}

/** "⌘K", "Ctrl+K", "J", "Space": how a shortcut is written for this platform. */
export function keyLabel(id) {
  const k = KEYS.find((x) => x.id === id);
  if (!k) return '';
  if (k.hint) return k.hint;
  const name = codeName(k.code[0]);
  const parts = [];
  if (k.ctrl) parts.push(isMac ? '⌃' : 'Ctrl');
  if (k.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (k.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (k.mod) parts.push(isMac ? '⌘' : 'Ctrl');
  return isMac ? parts.join('') + name : [...parts, name].join('+');
}

function codeName(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return { Space: 'Space', Enter: '↵', Escape: 'Esc', Slash: '/', Backslash: '\\', Period: '.', Comma: ',', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫' }[code] || code;
}

export function isTypingTarget(el = document.activeElement) {
  if (!el || el === document.body) return false;
  if (el.closest?.('.xterm, .monaco-editor')) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Find and run the shortcut for a keydown. Returns true when one ran. */
export function dispatch(e, ctx) {
  if (e.isComposing || e.keyCode === 229) return false;
  const typing = isTypingTarget();
  for (const k of KEYS) {
    if (!k.code.includes(e.code)) continue;
    // ⌘ on Mac is Ctrl elsewhere; a Ctrl shortcut on Mac stays Ctrl.
    const meta = isMac ? k.mod : false;
    const ctrl = isMac ? k.ctrl : k.mod || k.ctrl;
    if (e.metaKey !== meta || e.ctrlKey !== ctrl || e.altKey !== k.alt || e.shiftKey !== k.shift) continue;
    if (k.scope === 'nav' && typing) continue;
    const run = handlers.get(k.id);
    if (run && run(e, ctx) !== false) {
      e.preventDefault();
      return true;
    }
  }
  return false;
}
