import test from 'node:test';
import assert from 'node:assert/strict';
import { mapHook, emptyState, describeTool, roleOf } from '../src/adapters/claude-hooks.mjs';

const SID = 'abcd1234-session';
// 2.5 s between payloads: the coordinator's task line is rate limited to one start per 2 s.
const run = (payloads) => { let state = emptyState(SID); const all = []; let now = 1_000_000; for (const p of payloads) { const r = mapHook({ session_id: SID, ...p }, state, now); state = r.state; all.push(...r.events); now += 2500; } return { events: all, state }; };
const kinds = (evs) => evs.map((e) => e.kind);

test('a prompt arrives as paper and the coordinator starts reading', () => {
  const { events, state } = run([{ hook_event_name: 'SessionStart' }, { hook_event_name: 'UserPromptSubmit', prompt: 'build the thing' }]);
  assert.deepEqual(kinds(events), ['join', 'arrive', 'start']);
  assert.equal(events[0].agent, 'me-abcd');
  assert.equal(events[1].paper, 'pabcd-1');
  assert.equal(events[1].text, 'build the thing');
  assert.equal(state.paper, 'pabcd-1');
});

test('an Agent tool call is a subagent at a desk; its result comes back and it leaves', () => {
  const { events, state } = run([
    { hook_event_name: 'UserPromptSubmit', prompt: 'x' },
    { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { subagent_type: 'researcher', description: 'survey the repo' } },
    { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu1', tool_input: { subagent_type: 'researcher' }, tool_response: 'done' },
  ]);
  const k = kinds(events).slice(3);
  assert.deepEqual(k, ['join', 'handoff', 'start', 'done', 'handoff', 'leave']);
  const sub = events[3];
  assert.equal(sub.agent, 'researcher.abcd.1');
  assert.equal(sub.role, 'researcher');
  assert.equal(events[4].to, 'researcher.abcd.1');
  assert.equal(events[4].paper, 'pabcd-1.1');
  assert.equal(events[7].to, 'me-abcd');
  assert.deepEqual(state.subs, {});
});

test('a failed Agent result is a fail stamp', () => {
  const { events } = run([
    { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu2', tool_input: { subagent_type: 'coder', name: 'dev' } },
    { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu2', tool_input: {}, tool_response: { is_error: true } },
  ]);
  assert.ok(kinds(events).includes('fail'));
  assert.equal(events.find((e) => e.kind === 'join' && e.role === 'coder').name, 'dev');
});

test('ordinary tools light the coordinator lamp, rate limited; git push ships', () => {
  const { events } = run([
    { hook_event_name: 'UserPromptSubmit', prompt: 'x' },
    { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/a/b/c.ts' } },
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b/d.ts' } },
    { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git push -u origin main' }, tool_response: { stdout: 'ok' } },
    { hook_event_name: 'Stop' },
  ]);
  const k = kinds(events);
  assert.deepEqual(k, ['join', 'arrive', 'start', 'start', 'start', 'ship', 'done']);
  assert.equal(events[3].text, 'edit c.ts');
  assert.equal(events[5].kind, 'ship');
  assert.equal(describeTool('Bash', { command: 'npm test' }), 'npm test');
  assert.equal(describeTool('Grep', { pattern: 'foo' }), 'searching foo');
});

test('a permission notification raises the flag until the next tool runs', () => {
  const { events, state } = run([
    { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' },
    { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'again' },
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
  ]);
  assert.deepEqual(kinds(events), ['block', 'join', 'unblock', 'start']);
  assert.equal(state.blocked, false);
});

test('a factory job binds the session: the coordinator is the job peg and the first paper is the job', () => {
  let state = emptyState(SID, { id: 'job_abc', name: 'TINY APP' }); const all = [];
  for (const p of [{ hook_event_name: 'UserPromptSubmit', prompt: 'build' }, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't1', tool_input: { subagent_type: 'coder' } }]) { const r = mapHook({ session_id: SID, ...p }, state, 5000); state = r.state; all.push(...r.events); }
  assert.equal(all[0].agent, 'job.job_abc'); assert.equal(all[0].name, 'TINY APP');
  assert.equal(all[1].paper, 'job_abc');
  assert.equal(all.find((e) => e.kind === 'handoff').paper, 'job_abc.1');
  assert.equal(emptyState('s', { id: '../x' }).main, 'job.x');
});

test('SessionEnd clears the floor; unknown events do nothing', () => {
  const { events, state } = run([
    { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 't', tool_input: { subagent_type: 'tester' } },
    { hook_event_name: 'Whatever' },
    { hook_event_name: 'SessionEnd' },
  ]);
  const k = kinds(events);
  assert.equal(k.filter((x) => x === 'leave').length, 2);
  assert.equal(state.joined, false);
  assert.deepEqual(mapHook({}, undefined, 1).events, []);
});

test('a general-purpose subagent takes its role from the task line, so it sits in the right room', () => {
  assert.equal(roleOf({ subagent_type: 'general-purpose', description: 'Researcher: scope the brief' }), 'researcher');
  assert.equal(roleOf({ subagent_type: 'general-purpose', description: 'designer: write DESIGN.md' }), 'designer');
  assert.equal(roleOf({ subagent_type: 'general-purpose', description: 'Design review — screenshots at 375' }), 'design-review');
  assert.equal(roleOf({ subagent_type: 'tester', description: 'Coder: x' }), 'tester', 'a real type wins');
  assert.equal(roleOf({ subagent_type: 'general-purpose', description: 'look around the repo' }), 'general-purpose');
  assert.equal(roleOf({}), 'agent');
  const { events } = run([{ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'g1', tool_input: { subagent_type: 'general-purpose', description: 'Coder: implement Rally' } }]);
  const j = events.find((e) => e.kind === 'join' && e.role !== 'coordinator'); assert.equal(j.role, 'coder'); assert.equal(j.name, 'coder'); assert.ok(j.agent.startsWith('coder.'));
});
