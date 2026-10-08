import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeJob, saveJob, loadJob, listJobs, answerJob, summarize, jobAgentId } from '../src/factory/jobs.mjs';
import { coordinatorPrompt, parseFence, ASK_FENCE, DONE_FENCE } from '../src/factory/prompt.mjs';
import { createRunner, composeCommand, childEnv, DEFAULT_ALLOWED } from '../src/factory/runner.mjs';
import { shipJob } from '../src/factory/ship.mjs';
import { readEvents } from '../src/log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-claude.mjs');
const tmp = () => mkdtempSync(join(tmpdir(), 'binas-factory-'));

test('makeJob validates and fills defaults; a new project gets a slugged folder', () => {
  const root = tmp();
  try {
    const job = makeJob({ title: 'Barber booking', brief: 'A booking page for a barber shop with time slots.' }, root);
    assert.equal(job.state, 'queued'); assert.equal(job.ship, 'pr'); assert.equal(job.autonomy, 'ask'); assert.equal(job.budgetUsd, 5);
    assert.equal(job.project.kind, 'new'); assert.equal(job.project.slug, 'barber-booking'); assert.ok(job.branch.startsWith('binas/job_'));
    assert.throws(() => makeJob({ title: '', brief: 'x' }, root), /title/);
    assert.throws(() => makeJob({ title: 'x', brief: '' }, root), /brief/);
    assert.throws(() => makeJob({ title: 'x', brief: 'y', project: 'nope/nowhere' }, root), /does not exist/);
    saveJob(root, job); assert.equal(listJobs(root).length, 1); assert.equal(loadJob(root, job.id).title, 'Barber booking'); assert.equal(loadJob(root, '../etc/passwd'), null);
    assert.equal(summarize(job).agent, jobAgentId(job));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the prompt carries the brief, the pipeline, and both fences; parseFence reads the last block', () => {
  const job = makeJob({ title: 'T', brief: 'Build the thing.' }, tmp());
  const p = coordinatorPrompt(job);
  for (const s of ['Build the thing.', 'researcher', 'architect', 'coder', 'tester', 'reviewer', 'Never push', '```' + ASK_FENCE, '```' + DONE_FENCE, job.branch]) assert.ok(p.includes(s), s);
  assert.ok(coordinatorPrompt(job, { resumeAnswer: { question: 'q', answer: 'yes' } }).includes('Answer: yes'));
  assert.deepEqual(parseFence('x ```binas-ask\n{"question":"a"}\n``` y ```binas-ask\n{"question":"b"}\n```', ASK_FENCE), { question: 'b' });
  assert.equal(parseFence('nothing here', ASK_FENCE), null);
  assert.equal(parseFence('```binas-done\nnot json\n```', DONE_FENCE).raw, 'not json');
});

test('composeCommand: plain shape strips nothing, docker shape mounts only work, ~/.claude and the plugin', () => {
  const job = { ...makeJob({ title: 'T', brief: 'b', budgetUsd: 3, model: 'sonnet' }, tmp()), workdir: '/tmp/w', sessionId: 'sess_1' };
  const plain = composeCommand(job, 'PROMPT', { claude: { bin: 'claude', prefixArgs: [] }, resume: true });
  assert.equal(plain.cmd, 'claude'); assert.ok(plain.args.includes('--resume') && plain.args.includes('sess_1') && plain.args.includes('--max-budget-usd') && plain.args.includes('3') && plain.args.includes('--model'));
  assert.ok(plain.args.includes('acceptEdits') && plain.args.join(' ').includes(DEFAULT_ALLOWED[0]) && !plain.args.join(' ').includes('git push'));
  const full = composeCommand({ ...job, autonomy: 'full' }, 'P', {}); assert.ok(full.args.includes('--dangerously-skip-permissions'));
  const d = composeCommand(job, 'P', { sandbox: 'docker' }); assert.equal(d.cmd, 'docker'); assert.ok(d.args.includes('/tmp/w:/work') && d.args.includes('--plugin-dir') && d.args.includes('/binas'));
  const env = childEnv(job, { ANTHROPIC_API_KEY: 'sk-x', PATH: '/bin', CLAUDE_PROJECT_DIR: '/x' }, { root: '/r', floor: 'f1' });
  assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.CLAUDE_PROJECT_DIR, undefined); assert.equal(env.BINAS_JOB, job.id); assert.equal(env.BINAS_FLOOR, 'f1'); assert.equal(env.PATH, '/bin');
  assert.equal(childEnv({ ...job, billing: 'api' }, { ANTHROPIC_API_KEY: 'sk-x' }, { root: '/r' }).ANTHROPIC_API_KEY, 'sk-x');
});

test('a job runs end to end on the fake claude: asks, waits, resumes, ships as a branch, and the floor sees it', async () => {
  const root = tmp(); const seen = [];
  try {
    const job = saveJob(root, makeJob({ title: 'Tiny app', brief: 'A tiny app.', ship: 'pr', budgetUsd: 2 }, root));
    const runner = createRunner({ root, claude: { bin: process.execPath, prefixArgs: [FAKE] }, floor: 'main', log: (l) => seen.push(l), env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'sk-should-not-leak' } });
    const first = await runner.tick();
    assert.equal(first.id, job.id); assert.equal(first.state, 'blocked'); assert.equal(first.sessionId, 'sess_fake_1'); assert.equal(first.question.text, 'Dark mode by default?'); assert.deepEqual(first.question.options, ['yes', 'no']);
    assert.ok(existsSync(join(job.project.path, 'CLAUDE.md')) && existsSync(join(job.project.path, '.git')));
    assert.equal(spawnSync('git', ['branch', '--show-current'], { cwd: job.project.path, encoding: 'utf8' }).stdout.trim(), job.branch);
    assert.equal(await runner.tick(), null, 'blocked jobs are not picked up');
    assert.throws(() => answerJob(root, job.id, ''), /text/);
    answerJob(root, job.id, 'yes');
    const second = await runner.tick();
    assert.equal(second.state, 'shipped'); assert.equal(second.shipMode, 'branch'); assert.equal(second.summary.summary, 'A tiny app with dark mode by default.'); assert.equal(second.costUsd, 0.03); assert.equal(second.turns, 8);
    assert.ok(readFileSync(join(job.project.path, 'built.txt'), 'utf8').includes('budget 2'));
    const log = spawnSync('git', ['log', '--oneline'], { cwd: job.project.path, encoding: 'utf8' }).stdout; assert.ok(log.includes('binas: Tiny app') && log.includes('open the project'));
    const kinds = readEvents(root).map((e) => e.kind);
    assert.deepEqual(kinds, ['join', 'arrive', 'start', 'block', 'unblock', 'start', 'done', 'ship']);
    assert.ok(readEvents(root).every((e) => e.agent === jobAgentId(job) || e.kind === 'arrive'));
    assert.ok(seen.some((l) => /needs an answer/.test(l)) && seen.some((l) => /no git remote/.test(l)));
    assert.equal(await runner.tick(), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an existing repo gets a worktree and a branch; a failing claude marks the job failed', async () => {
  const root = tmp();
  try {
    const repo = join(root, 'existing'); spawnSync('git', ['init', '-q', repo]); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
    const job = saveJob(root, makeJob({ title: 'Fix header', brief: 'Make it blue.', project: repo }, root));
    const runner = createRunner({ root, claude: { bin: process.execPath, prefixArgs: ['-e', 'process.exit(3)'] }, env: { PATH: process.env.PATH } });
    const r = await runner.tick();
    assert.equal(r.state, 'failed'); assert.ok(r.workdir.includes(join('.claude-flow', 'binas', 'work')));
    assert.ok(spawnSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf8' }).stdout.includes(job.branch));
    assert.equal(readEvents(root).map((e) => e.kind).pop(), 'fail');
    const s = shipJob({ ...job, workdir: r.workdir, ship: 'none' }); assert.equal(s.mode, 'none');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
