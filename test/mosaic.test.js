// The overview's mosaic: which tile gets how much room, in what order, at what height.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeOf, arrange, colsFor, rowHeight } from '../ui/src/core/mosaic.js';
import { ctxPct, modelName, nextMode } from '../ui/src/core/session.js';

const T = (id, state, extra = {}) => ({ id, state, updatedAt: 1, ...extra });

test('sizes: blocked or pinned big, my turn and stopped medium, quiet work small', () => {
  assert.equal(sizeOf(T('a', 'needs_input', { ask: 'permission' })), 'l');
  assert.equal(sizeOf(T('b', 'needs_input')), 'm');
  assert.equal(sizeOf(T('c', 'review')), 'm');
  assert.equal(sizeOf(T('d', 'exited')), 'm');
  assert.equal(sizeOf(T('e', 'working')), 's');
  assert.equal(sizeOf(T('e', 'working'), true), 'l');
  assert.equal(sizeOf(T('f', 'merged')), 's');
});

test('order: big first, then by urgency within a size', () => {
  const list = [T('w', 'working'), T('r', 'review'), T('p', 'needs_input', { ask: 'permission' }), T('q', 'needs_input'), T('x', 'exited')];
  assert.deepEqual(arrange(list).map((x) => x.t.id), ['p', 'q', 'r', 'x', 'w']);
  // A pinned working session moves up with the big ones.
  assert.equal(arrange(list, new Set(['w']))[1].t.id, 'w');
});

test('grid: columns by width, rows that fill the height within bounds', () => {
  assert.deepEqual([1400, 1000, 600, 400].map(colsFor), [6, 4, 2, 1]);
  const items = [{ z: 'l' }, { z: 'l' }, { z: 'm' }, { z: 'm' }, { z: 's' }, { z: 's' }];
  // 4+4+2+2+1+1 = 14 cells on 6 columns: 3 rows.
  assert.equal(rowHeight(items, 6, 720), Math.min(260, Math.floor((720 - 20) / 3)));
  assert.equal(rowHeight(items, 6, 2000), 260);
  assert.equal(rowHeight(items, 1, 300), 170);
});

test('session words: context percent, model names, the Shift+Tab cycle', () => {
  assert.equal(ctxPct({ used: 150000, limit: 200000 }), 75);
  assert.equal(ctxPct({ used: 0, limit: 200000, stale: true }), null);
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('claude-fable-5-1'), 'Fable 5.1');
  assert.deepEqual(['default', 'acceptEdits', 'plan', 'auto'].map(nextMode), ['acceptEdits', 'plan', 'auto', 'default']);
});
