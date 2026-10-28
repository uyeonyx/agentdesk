// Subagent progress from hooks that arrive in any order: each hook runs in its own process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityTracker } from '../server/activity.js';

const EVENTS = {
  parentPre: { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'toolu_parent', tool_input: { description: '테스트 작성', subagent_type: 'general-purpose', prompt: 'write tests' } },
  subPre: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test' }, agent_id: 'sub-1', agent_type: 'general-purpose' },
  start: { hook_event_name: 'SubagentStart', agent_id: 'sub-1', agent_type: 'general-purpose' },
  subPost: { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test' }, tool_response: {}, agent_id: 'sub-1', agent_type: 'general-purpose' },
  stop: { hook_event_name: 'SubagentStop', agent_id: 'sub-1', agent_type: 'general-purpose', last_assistant_message: '테스트 3개를 추가했어요' },
  parentPost: { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'toolu_parent', tool_input: { description: '테스트 작성' }, tool_response: {} },
};

function* orders(items) {
  if (items.length <= 1) return yield items;
  for (let i = 0; i < items.length; i++) for (const rest of orders([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
}

test('a subagent is counted the same whichever order its hooks arrive in', () => {
  let n = 0;
  for (const order of orders(Object.keys(EVENTS))) {
    const task = { cwd: '/tmp/x', agent: 'claude' };
    const tr = new ActivityTracker(task, () => {});
    for (const k of order) tr.claude(structuredClone(EVENTS[k]));
    const subs = task.activity.subagents;
    const why = order.join(' → ');
    assert.equal(subs.length, 1, why);
    assert.equal(subs[0].tools, 1, why);
    assert.equal(subs[0].desc, '테스트 작성', why);
    assert.equal(subs[0].type, 'general-purpose', why);
    assert.equal(subs[0].status, 'done', why);
    assert.equal(subs[0].feed[0].st, 'ok', why);
    assert.deepEqual(task.activity.pending, [], why);
    n++;
  }
  assert.equal(n, 720);
});

test('an Agent call nobody claims is forgotten after a minute', () => {
  const task = { cwd: '/tmp/x', agent: 'claude' };
  const tr = new ActivityTracker(task, () => {});
  tr.claude(structuredClone(EVENTS.parentPre));
  task.activity.pending[0].at -= 61_000;
  tr.claude({ hook_event_name: 'SubagentStart', agent_id: 'sub-2', agent_type: 'general-purpose' });
  assert.equal(task.activity.subagents[0].desc, '');
  assert.deepEqual(task.activity.pending, []);
});
