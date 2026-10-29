// What Enter does in every text box that sends something to an agent. Careful projects only send
// with ⌘/Ctrl+Enter, so a stray Enter can't start work there.

/** @returns {'send'|'newline'|'blocked'|null} null: not ours (let the key through). */
export function enterAction(e, { careful = false } = {}) {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return null;
  if (e.shiftKey || e.altKey) return 'newline';
  const mod = e.metaKey || e.ctrlKey;
  if (careful && !mod) return 'blocked';
  return 'send';
}
