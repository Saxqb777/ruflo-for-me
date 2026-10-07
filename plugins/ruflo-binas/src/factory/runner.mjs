// The workshop. Picks queued jobs, prepares a repo or worktree, runs one headless Claude Code session per
// turn with the Ruflo pipeline prompt, the Binas hooks and a spend cap, parks on a binas-ask block, resumes
// with the owner's answer, ships when a binas-done block lands. Fuel is the machine's Claude login: any
// API key is stripped from the child environment unless the job says billing: "api".
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { listJobs, loadJob, saveJob, note, jobAgentId, jobAgentName } from './jobs.mjs';
import { coordinatorPrompt, newProjectClaudeMd, parseFence, ASK_FENCE, DONE_FENCE } from './prompt.mjs';
import { shipJob } from './ship.mjs';
import { appendEvent } from '../log.mjs';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_ALLOWED = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'Agent', 'Task', 'TodoWrite', 'WebFetch', 'WebSearch',
  'Bash(npm *)', 'Bash(npx *)', 'Bash(pnpm *)', 'Bash(node *)', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git branch*)', 'Bash(ls *)', 'Bash(cat *)', 'Bash(mkdir *)', 'Bash(cp *)', 'Bash(mv *)'];
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const git = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; };

/** The command line for one turn. Pure, so the docker and plain shapes can be asserted in tests. */
export function composeCommand(job, prompt, { claude = { bin: 'claude', prefixArgs: [] }, sandbox = 'none', image = 'ghcr.io/anthropics/claude-code:latest', resume = false } = {}) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--max-budget-usd', String(job.budgetUsd)];
  if (job.model) args.push('--model', job.model);
  if (resume && job.sessionId) args.push('--resume', job.sessionId);
  if (job.autonomy === 'full') args.push('--dangerously-skip-permissions'); else args.push('--permission-mode', 'acceptEdits', '--allowedTools', DEFAULT_ALLOWED.join(','));
  if (sandbox === 'docker') {
    const envFlags = ['BINAS_LOG_ROOT', 'BINAS_JOB', 'BINAS_JOB_NAME', 'BINAS_FLOOR', 'BINAS_INGEST_URL', 'BINAS_KEY'].flatMap((k) => ['-e', k]);
    return { cmd: 'docker', args: ['run', '--rm', '-i', '-v', `${job.workdir}:/work`, '-v', `${join(homedir(), '.claude')}:/root/.claude`, '-v', `${PLUGIN_ROOT}:/binas:ro`, '-w', '/work', ...envFlags, image, 'claude', ...args, '--plugin-dir', '/binas'] };
  }
  return { cmd: claude.bin, args: [...(claude.prefixArgs || []), ...args, '--plugin-dir', PLUGIN_ROOT] };
}

export function childEnv(job, base, { root, floor }) {
  const env = { ...base };
  if (job.billing !== 'api') delete env.ANTHROPIC_API_KEY;
  env.BINAS_LOG_ROOT = root; env.BINAS_JOB = job.id; env.BINAS_JOB_NAME = jobAgentName(job); if (floor) env.BINAS_FLOOR = floor;
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

/** Make the place the session works in: a fresh repo for a new project, a worktree + branch for an existing one. */
export function prepareWorkdir(job, root) {
  if (job.project.kind === 'new') {
    const p = job.project.path; mkdirSync(p, { recursive: true });
    if (!existsSync(join(p, '.git'))) {
      if (!git(['init', '-q'], p).ok) throw new Error('git init failed');
      git(['symbolic-ref', 'HEAD', 'refs/heads/main'], p);
      writeFileSync(join(p, 'CLAUDE.md'), newProjectClaudeMd(job)); writeFileSync(join(p, 'README.md'), `# ${job.title}\n\n${job.brief}\n`); writeFileSync(join(p, '.gitignore'), 'node_modules/\n.env\n.env.*\ndist/\n.claude-flow/\n');
      git(['add', '-A'], p); git(['-c', 'user.name=Binas', '-c', 'user.email=binas@local', 'commit', '-q', '-m', 'binas: open the project'], p);
    }
    const b = git(['rev-parse', '--verify', '--quiet', job.branch], p).ok ? git(['checkout', '-q', job.branch], p) : git(['checkout', '-q', '-b', job.branch], p);
    if (!b.ok) throw new Error('could not switch to ' + job.branch + ': ' + b.err);
    return p;
  }
  const src = job.project.path;
  if (!git(['rev-parse', '--is-inside-work-tree'], src).ok) throw new Error('existing project must be a git repository: ' + src);
  const dir = join(root, '.claude-flow', 'binas', 'work', job.id);
  if (existsSync(dir)) return dir;
  mkdirSync(dirname(dir), { recursive: true });
  const exists = git(['rev-parse', '--verify', '--quiet', job.branch], src).ok;
  const w = exists ? git(['worktree', 'add', '-q', dir, job.branch], src) : git(['worktree', 'add', '-q', '-b', job.branch, dir], src);
  if (!w.ok) throw new Error('worktree failed: ' + w.err);
  return dir;
}

/** Run one headless session; resolves with { sessionId, result, cost, turns, isError, stderr }. */
export function runSession({ cmd, args, cwd, env, onLine = () => {}, timeoutMs = 2 * 3600 * 1000 }) {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', stderr = '', sessionId = null, final = null;
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) { const s = line.trim(); if (!s) continue; let m; try { m = JSON.parse(s); } catch { continue; }
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) sessionId = m.session_id;
        if (m.type === 'result') { final = m; if (m.session_id) sessionId = m.session_id; }
        onLine(m); } });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    child.on('error', (e) => { stderr += '\n' + e.message; });
    child.on('close', (code) => { clearTimeout(timer);
      resolveP({ sessionId, result: final ? String(final.result || '') : '', cost: final ? Number(final.total_cost_usd || final.cost_usd || 0) : 0, turns: final ? Number(final.num_turns || 0) : 0, isError: final ? !!final.is_error : true, exitCode: code, stderr: stderr.trim() }); });
  });
}

export function createRunner({ root, claude, sandbox = 'none', image, floor = null, env = process.env, log = () => {}, ship = shipJob, run = runSession } = {}) {
  root = resolve(root || process.cwd());
  const ev = (job, kind, extra = {}) => appendEvent(root, { t: Date.now(), kind, agent: jobAgentId(job), role: 'coordinator', name: jobAgentName(job), source: 'factory', ...extra });
  const say = (job, text) => { note(job, text); log(`[${job.id}] ${text}`); };

  async function turn(job, { resume = false, answer = null } = {}) {
    const prompt = coordinatorPrompt(job, { resumeAnswer: answer });
    const { cmd, args } = composeCommand(job, prompt, { claude, sandbox, image, resume });
    job.state = 'running'; job.startedAt = job.startedAt || Date.now(); saveJob(root, job);
    const out = await run({ cmd, args, cwd: job.workdir, env: childEnv(job, env, { root, floor }), onLine: (m) => { if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) { const t = m.message.content.find((c) => c.type === 'text'); if (t) say(job, short(t.text, 160)); } } });
    job.sessionId = out.sessionId || job.sessionId; job.costUsd = Number((job.costUsd + out.cost).toFixed(4)); job.turns += out.turns; job.lastResult = short(out.result, 4000);
    if (out.isError) { job.state = 'failed'; job.error = short(out.stderr || out.result || `exit ${out.exitCode}`, 400); job.finishedAt = Date.now(); saveJob(root, job); ev(job, 'fail', { paper: job.id, text: job.error }); say(job, 'failed: ' + job.error); return job; }
    const ask = parseFence(out.result, ASK_FENCE);
    if (ask) { job.state = 'blocked'; job.question = { text: short(ask.question || ask.raw || 'needs a decision', 400), options: Array.isArray(ask.options) ? ask.options.slice(0, 6).map((o) => short(o, 80)) : [], context: short(ask.context, 300), askedAt: Date.now() }; saveJob(root, job); ev(job, 'block', { text: job.question.text, needs: job.question.options.join(' / ') }); say(job, 'needs you: ' + job.question.text); return job; }
    const done = parseFence(out.result, DONE_FENCE) || { summary: short(out.result, 300), notes: 'the session ended without a binas-done block' };
    job.summary = done; job.state = 'done'; job.finishedAt = Date.now(); saveJob(root, job); ev(job, 'done', { paper: job.id, text: short(done.summary, 90) });
    const shipped = ship(job); job.links = { ...job.links, ...shipped.links }; job.shipMode = shipped.mode; shipped.notes.forEach((n) => say(job, n)); job.state = 'shipped'; saveJob(root, job);
    ev(job, 'ship', { paper: job.id, text: shipped.links.pr || shipped.links.remote ? `${shipped.links.pr || shipped.links.remote}` : `branch ${job.branch}` });
    return job;
  }

  async function runJob(job) {
    try { job.workdir = prepareWorkdir(job, root); saveJob(root, job); }
    catch (e) { job.state = 'failed'; job.error = short(e.message, 300); saveJob(root, job); ev(job, 'fail', { paper: job.id, text: job.error }); say(job, 'failed: ' + job.error); return job; }
    ev(job, 'join'); ev(job, 'arrive', { paper: job.id, to: jobAgentId(job), text: job.title }); ev(job, 'start', { paper: job.id, text: 'reading the brief' });
    say(job, `started in ${job.workdir} on ${job.branch}`);
    return turn(job);
  }
  async function resumeJob(job) {
    const last = job.answers[job.answers.length - 1];
    ev(job, 'unblock', { text: short(last ? last.answer : 'yes', 120) }); ev(job, 'start', { paper: job.id, text: 'continuing with your answer' });
    return turn(job, { resume: true, answer: last });
  }

  /** One pass: resume an answered job, else start the oldest queued one. Returns the job it worked on, or null. */
  async function tick() {
    const jobs = listJobs(root);
    const answered = jobs.find((j) => j.state === 'answered'); if (answered) return resumeJob(loadJob(root, answered.id));
    const queued = jobs.find((j) => j.state === 'queued'); if (queued) return runJob(loadJob(root, queued.id));
    return null;
  }
  let timer = null, busy = false;
  function start(pollMs = 3000) { const loop = async () => { if (busy) return; busy = true; try { await tick(); } catch (e) { log('runner error: ' + e.message); } finally { busy = false; } }; loop(); timer = setInterval(loop, pollMs); return () => clearInterval(timer); }
  return { tick, runJob, resumeJob, start, root };
}
