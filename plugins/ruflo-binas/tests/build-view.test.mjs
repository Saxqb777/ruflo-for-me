import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine } from '../web/engine.js';
import { stagesFor, stageOf, plainDoing, STAGES } from '../web/stages.js';
import { layoutFiles, districtOf, kindOf, heightFor } from '../web/maquette.js';
import { mapHook, emptyState, relFile } from '../src/adapters/claude-hooks.mjs';
import { parseLines } from '../src/events.mjs';
import { tourSteps } from '../web/guide.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('the engine knows which project a helper works for, what was written, and what is being written now', () => {
  const e = createEngine();
  [{ t: 1000, kind: 'join', agent: 'job.prj_a', role: 'coordinator', name: 'PONG' }, { t: 1001, kind: 'arrive', paper: 'prj_a', to: 'job.prj_a', text: 'pong' },
    { t: 2000, kind: 'join', agent: 'coder.ab.1', role: 'coder' }, { t: 2001, kind: 'handoff', agent: 'job.prj_a', to: 'coder.ab.1', paper: 'prj_a.1', text: 'coder: build it' },
    { t: 3000, kind: 'build', agent: 'coder.ab.1', to: 'job.prj_a', file: 'src/play.js', lines: 80 }, { t: 4000, kind: 'build', agent: 'coder.ab.1', to: 'job.prj_a', file: 'src/play.js', lines: 214 },
    { t: 4500, kind: 'build', agent: 'coder.ab.1', file: 'index.html', lines: 40 }].forEach((x) => e.push(x));
  assert.equal(e.rootOf('coder.ab.1'), 'job.prj_a'); assert.equal(e.rootOf('job.prj_a'), 'job.prj_a');
  const f = e.files('job.prj_a', 5000); assert.deepEqual(f.map((x) => [x.file, x.lines, x.touches]), [['src/play.js', 214, 2], ['index.html', 40, 1]], 'a build without `to` finds its project through the handoff');
  assert.equal(e.files('job.prj_a', 3500)[0].lines, 80, 'replays to any instant');
  assert.equal(e.activeFile('job.prj_a', 4600).file, 'index.html'); assert.equal(e.activeFile('job.prj_a', 20000), null);
  assert.deepEqual(e.roots(), ['job.prj_a']);
});

test('older hooks still raise blocks: "write x" task lines count until real build events arrive', () => {
  const e = createEngine();
  e.push({ t: 1, kind: 'start', agent: 'job.p', role: 'coordinator', text: 'write sound.js' }); e.push({ t: 2, kind: 'start', agent: 'job.p', role: 'coordinator', text: 'edit sound.js' }); e.push({ t: 3, kind: 'start', agent: 'job.p', role: 'coordinator', text: 'npm test' });
  assert.deepEqual(e.files('job.p', 10).map((x) => [x.file, x.lines, x.est]), [['sound.js', 48, true]]);
  e.push({ t: 4, kind: 'build', agent: 'job.p', to: 'job.p', file: 'src/sound.js', lines: 120 });
  assert.deepEqual(e.files('job.p', 10).map((x) => x.file), ['src/sound.js'], 'real builds replace the estimates');
});

test('the round reads as eight plain stops: active, done, skipped, retry, live', () => {
  assert.equal(stageOf('researcher'), 0); assert.equal(stageOf('designer'), 1); assert.equal(stageOf('architect'), 2); assert.equal(stageOf('coder'), 3); assert.equal(stageOf('tester'), 4); assert.equal(stageOf('design-review'), 5); assert.equal(stageOf('reviewer'), 6); assert.equal(stageOf('release'), 7); assert.equal(stageOf('general-purpose'), -1);
  const e = createEngine(); const R = 'job.p';
  const ev = [{ t: 1, kind: 'join', agent: R, role: 'coordinator' }, { t: 2, kind: 'arrive', paper: 'p', to: R, text: 'x' }];
  const sub = (t, id, role) => [{ t, kind: 'join', agent: id, role }, { t: t + 1, kind: 'handoff', agent: R, to: id, paper: 'p.' + id }, { t: t + 2, kind: 'start', agent: id, role, paper: 'p.' + id, text: 'go' }];
  ev.push(...sub(10, 'researcher.1', 'researcher'), { t: 20, kind: 'done', agent: 'researcher.1' }, ...sub(30, 'coder.2', 'coder'));
  ev.forEach((x) => e.push(x));
  let s = stagesFor(e, R, 35).stages.map((x) => x.state);
  assert.deepEqual(s, ['done', 'skipped', 'skipped', 'active', 'todo', 'todo', 'todo', 'todo']); assert.equal(stagesFor(e, R, 35).current, 3);
  [{ t: 40, kind: 'done', agent: 'coder.2' }, ...sub(50, 'tester.3', 'tester'), { t: 55, kind: 'fail', agent: 'tester.3' }].forEach((x) => e.push(x));
  assert.equal(stagesFor(e, R, 56).stages[4].state, 'retry');
  [{ t: 60, kind: 'done', agent: R }].forEach((x) => e.push(x)); assert.equal(stagesFor(e, R, 61).stages[7].state, 'active', 'deploying after the round is done');
  [{ t: 70, kind: 'ship', agent: R, paper: 'p' }].forEach((x) => e.push(x)); assert.equal(stagesFor(e, R, 71).stages[7].state, 'done');
  [{ t: 80, kind: 'arrive', paper: 'p2', to: R, text: 'next' }].forEach((x) => e.push(x)); assert.ok(stagesFor(e, R, 81).stages.every((x) => x.state === 'todo'), 'a new message starts a fresh round');
  assert.equal(stagesFor(e, null, 1).current, -1); assert.equal(STAGES.length, 8);
});

test('narration never shows a shell command or a path', () => {
  assert.equal(plainDoing('coder', 'write src/play.js'), 'writing play.js');
  assert.equal(plainDoing('tester', 'npm test 2>&1 | grep -E "^# (pass|fail)"'), 'running the tests');
  assert.equal(plainDoing('architect', 'ls -la /Users/saaqib/binas/projects'), 'planning how it fits together');
  assert.equal(plainDoing('coordinator', 'mkdir -p /x && cat y'), 'coordinating the team');
  assert.equal(plainDoing('designer', 'reading DESIGN.md'), 'reading DESIGN.md');
  assert.equal(plainDoing('mystery', 'cat /etc/hosts'), 'working');
});

test('the maquette layout is stable: districts in first-seen order, four across, nothing already standing moves', () => {
  assert.equal(districtOf('src/a.js'), 'src'); assert.equal(districtOf('index.html'), 'root'); assert.equal(districtOf('./docs/x.md'), 'docs');
  assert.equal(kindOf('tests/a.test.js'), 'test'); assert.equal(kindOf('src/a.spec.ts'), 'test'); assert.equal(kindOf('DESIGN.md'), 'doc'); assert.equal(kindOf('index.html'), 'markup'); assert.equal(kindOf('a.css'), 'style'); assert.equal(kindOf('package.json'), 'config'); assert.equal(kindOf('src/game.js'), 'code');
  assert.ok(heightFor(0) < heightFor(10) && heightFor(10) < heightFor(1000) && heightFor(1e6) < 25);
  const f = (file, t0) => ({ file, t0, lines: 10 });
  const a = layoutFiles([f('DESIGN.md', 1), f('src/a.js', 2), f('src/b.js', 3)]);
  assert.deepEqual(a.districts.map((d) => d.name), ['root', 'src']);
  const b = layoutFiles([f('DESIGN.md', 1), f('src/a.js', 2), f('src/b.js', 3), f('tests/a.test.js', 4), f('src/c.js', 5)]);
  const pos = (lay, file) => lay.districts.flatMap((d) => d.cells).find((c) => c.file === file);
  for (const file of ['DESIGN.md', 'src/a.js', 'src/b.js']) assert.deepEqual(pos(b, file), pos(a, file), file + ' stayed put');
  const many = layoutFiles(Array.from({ length: 9 }, (_, i) => f(`d${i}/x.js`, i))); assert.ok(many.districts.some((d) => d.z > 0), 'districts wrap into rows'); assert.ok(many.width <= 60);
  assert.deepEqual(layoutFiles([]).districts, []);
  const big = layoutFiles(Array.from({ length: 51 }, (_, i) => f(`x${i}.js`, i))); assert.equal(big.districts[0].w, 8 * 3.4, 'a big folder widens instead of becoming a strip'); assert.ok(big.depth < big.width);
});

test('the hooks emit a build for every written file, relative to the project, attributed to the helper at work', () => {
  assert.equal(relFile('/w/p/src/a.js', '/w/p'), 'src/a.js'); assert.equal(relFile('/elsewhere/a.js', '/w/p'), 'a.js'); assert.equal(relFile('a.js', '/w/p'), 'a.js');
  let state = emptyState('sess', { id: 'prj_a', name: 'PONG' }); const all = []; let now = 1000;
  const step = (p) => { const r = mapHook({ session_id: 'sess', cwd: '/w/p', ...p }, state, now); state = r.state; all.push(...r.events); now += 2500; };
  step({ hook_event_name: 'UserPromptSubmit', prompt: 'x' });
  step({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'a1', tool_input: { subagent_type: 'general-purpose', description: 'coder: build it' } });
  step({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/w/p/src/play.js', content: 'a\nb\nc' } });
  step({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/w/p/src/play.js', content: 'a\nb\nc' }, tool_response: {} });
  step({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/w/p/src/play.js', old_string: 'a', new_string: 'aa' }, tool_response: {}, binas_lines: 57 });
  step({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/w/p/x.js' }, tool_response: { is_error: true } });
  const builds = all.filter((e) => e.kind === 'build');
  assert.deepEqual(builds.map((b) => [b.file, b.lines, b.to]), [['src/play.js', 3, 'job.prj_a'], ['src/play.js', 57, 'job.prj_a']]);
  assert.ok(builds.every((b) => b.agent.startsWith('coder.') && b.role === 'coder'), 'the helper that is out did the writing');
  const starts = all.filter((e) => e.kind === 'start' && e.text === 'write play.js'); assert.equal(starts.length, 1); assert.ok(starts[0].agent.startsWith('coder.'), 'the helper’s lamp lights, not the coordinator’s');
  step({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'a1', tool_input: {}, tool_response: 'ok' });
  step({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: '/w/p/README.md', content: 'x' }, tool_response: {} });
  assert.equal(all.filter((e) => e.kind === 'build').pop().agent, 'job.prj_a', 'with no helper out, the coordinator wrote it');
});

test('the recorded demo builds a model: 17 pieces, a plan, a build, tests, a review and a shipment', () => {
  const ev = parseLines(readFileSync(join(HERE, '..', 'demo', 'shift-014.jsonl'), 'utf8')); const e = createEngine(); ev.forEach((x) => e.push(x));
  const end = ev[ev.length - 1].t + 5000; assert.equal(e.files('QN', end).length, 17);
  const s = stagesFor(e, 'QN', end).stages; assert.equal(s[2].state, 'done'); assert.equal(s[3].state, 'done'); assert.equal(s[4].state, 'done'); assert.equal(s[6].state, 'done'); assert.equal(s[7].state, 'done');
});

test('the walkthrough has a step for every part of the screen, and the money step fits the person', () => {
  const sr = { ideas: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }], fillIdea: () => {} };
  const t = tourSteps({ role: 'tester', display: 'Ali' }, { showroom: sr, setMode: () => {} }); const o = tourSteps({ role: 'owner', display: 'Sax' }, { showroom: sr, setMode: () => {} });
  assert.equal(t.length, 8); assert.ok(t[0].title.includes('Ali'));
  assert.deepEqual(t.map((s) => s.target || null), [null, '#projectForm', '#stage', '#rail', '#yes', '#projects', '#jobStatus', null]);
  assert.equal(o[6].target, '#building'); assert.equal(t[1].chips.length, 3);
  for (const s of t) assert.ok(!/\b(code|repo|commit|deploy|API|git)\b/i.test(s.body.replace('No code, ever', '')), 'plain words: ' + s.title);
});
