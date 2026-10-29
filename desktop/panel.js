// Where the quick panel appears. Pure, so it can be tested without Electron.

export const PANEL_W = 420;
export const PANEL_MIN_H = 140;
export const PANEL_MAX_H = 640;

/**
 * @param {{ from: 'tray'|'shortcut', tray?: {x,y,width,height}, display: { workArea: {x,y,width,height} }, height: number, platform: string }} o
 */
export function panelBounds({ from, tray, display, height, platform }) {
  const wa = display.workArea;
  const h = Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, Math.round(height || 360), wa.height - 16));
  const w = PANEL_W;
  const clampX = (x) => Math.max(wa.x + 8, Math.min(wa.x + wa.width - w - 8, Math.round(x)));
  if (from === 'tray' && tray) {
    const cx = tray.x + tray.width / 2;
    if (platform === 'darwin') return { x: clampX(cx - w / 2), y: Math.round(tray.y + tray.height + 6), width: w, height: h };
    // Windows: the taskbar can be on any edge; open toward the screen from the tray.
    const below = tray.y < wa.y + wa.height / 2;
    return { x: clampX(cx - w / 2), y: below ? wa.y + 8 : wa.y + wa.height - h - 8, width: w, height: h };
  }
  // From the shortcut: like Spotlight, centred, a fifth of the way down.
  return { x: clampX(wa.x + (wa.width - w) / 2), y: Math.round(wa.y + wa.height * 0.2), width: w, height: h };
}

/** Clicking the tray right after the panel hid on blur (that click caused the blur) shouldn't reopen it. */
export function shouldToggle(lastHiddenAt, now = Date.now()) {
  return now - lastHiddenAt > 250;
}

/** A shortcut as Electron wants it, from what a person typed: "⌥Space" / "Alt+Space" → "Alt+Space". */
export function normalizeAccel(s) {
  const parts = String(s || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const map = { cmd: 'Command', command: 'Command', '⌘': 'Command', ctrl: 'Control', control: 'Control', '⌃': 'Control', alt: 'Alt', option: 'Alt', '⌥': 'Alt', shift: 'Shift', '⇧': 'Shift', super: 'Super', cmdorctrl: 'CommandOrControl', commandorcontrol: 'CommandOrControl' };
  const mods = parts.slice(0, -1).map((p) => map[p.toLowerCase()] || map[p]);
  if (mods.some((m) => !m)) return null;
  const key = parts[parts.length - 1];
  if (!/^([A-Z0-9]|F\d{1,2}|Space|Tab|Up|Down|Left|Right|[`\-=[\];',./\\])$/i.test(key)) return null;
  return [...new Set(mods), key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)].join('+');
}
