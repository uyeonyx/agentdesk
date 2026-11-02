// The overview's mosaic: space follows attention. What waits on me is big, quiet work is small.
// Pure (unit-tested in Node): sizes, the order tiles go in, and how the grid fits the window.
import { isBlocked, compareTasks } from './status.js';

/** Grid spans per size: [columns, rows]. */
export const SPAN = { l: [2, 2], m: [2, 1], s: [1, 1] };
const RANK = { l: 0, m: 1, s: 2 };

/**
 * l: stuck on a question or permission (its card needs the room), or pinned by the person.
 * m: my reply, a new result to look at, a stopped session to bring back.
 * s: working quietly, or finished.
 */
export function sizeOf(t, pinned = false) {
  if (pinned || isBlocked(t)) return 'l';
  if (['needs_input', 'review', 'exited'].includes(t.state)) return 'm';
  return 's';
}

/** Big ones first so the dense grid packs around them; within a size, most urgent first. */
export function arrange(tasks, pins = new Set()) {
  return tasks
    .map((t) => ({ t, z: sizeOf(t, pins.has(t.id)) }))
    .sort((a, b) => RANK[a.z] - RANK[b.z] || compareTasks(a.t, b.t));
}

/** Columns for a width: 6 wide, then 4, 2 and 1. */
export const colsFor = (w) => (w >= 1240 ? 6 : w >= 860 ? 4 : w >= 520 ? 2 : 1);

/**
 * Row height that fills the height when everything fits, between a floor (so a small tile still
 * holds its lines) and a ceiling (so two tiles don't become one tall empty card).
 */
export function rowHeight(items, cols, height, gap = 10) {
  let cells = 0;
  for (const it of items) {
    const [c, r] = SPAN[it.z];
    cells += Math.min(c, cols) * r;
  }
  const rows = Math.max(1, Math.ceil(cells / cols));
  const fit = Math.floor((height - gap * (rows - 1)) / rows);
  return Math.min(260, Math.max(cols === 1 ? 170 : 160, fit));
}
