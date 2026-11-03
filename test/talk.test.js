// Two sessions changing the same files: finding the overlap, and the one line Desk carries across.
import test from 'node:test';
import assert from 'node:assert/strict';
import { peerLine, Talks } from '../server/talk.js';

test('talk: the last "@상대:" line of a reply is what goes across', () => {
  assert.equal(peerLine('확인했어요.\n\n@상대: 저는 README 끝에만 붙였어요'), '저는 README 끝에만 붙였어요');
  assert.equal(peerLine('@상대: 먼저\n중간\n@상대：끝'), '끝');
  assert.equal(peerLine('  @상대 : 공백도 괜찮아요  '), '공백도 괜찮아요');
  assert.equal(peerLine('상대에게 할 말은 없어요'), null);
  assert.equal(peerLine('`@상대: 끝` 이라고 쓰래요'), null);
  assert.equal(peerLine('@상대: ' + 'x'.repeat(2000)).length, 600);
});

test('talk: running sessions with files in common, per repo, both ways', () => {
  const mk = (id) => ({ id, title: id, repos: [] });
  const store = { tasks: [mk('a'), mk('b'), mk('c'), { ...mk('d'), archived: true }], task: (id) => store.tasks.find((t) => t.id === id) };
  const rt = new Map([['a', {}], ['b', {}], ['c', {}], ['d', {}]]);
  const talks = new Talks({ store, rt });
  const f = (root, rel) => ({ root, rel });
  talks.setPaths(store.tasks[0], [f('/r', 'src/cart.ts'), f('/r', 'README.md')]);
  talks.setPaths(store.tasks[1], [f('/r', 'src/cart.ts')]);
  // Same path in another repo isn't the same file.
  talks.setPaths(store.tasks[2], [f('/other', 'src/cart.ts')]);
  talks.setPaths(store.tasks[3], [f('/r', 'README.md')]);
  const c = talks.clashes();
  assert.deepEqual(c.map((x) => [x.a, x.b, x.files]), [['a', 'b', ['src/cart.ts']]]);
  assert.deepEqual(talks.viewOf(store.tasks[1]).map((x) => [x.with, x.files, x.talk]), [['a', ['src/cart.ts'], null]]);
  // A stopped session drops out.
  rt.delete('b');
  talks.cache = null;
  assert.deepEqual(talks.clashes(), []);
  // Unchanged paths don't count as a change.
  assert.equal(talks.setPaths(store.tasks[0], [f('/r', 'README.md'), f('/r', 'src/cart.ts')]), false);
});
