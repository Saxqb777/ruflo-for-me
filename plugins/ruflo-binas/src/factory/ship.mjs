// Shipping a finished job: make sure the work is committed, then push the branch and open a pull request
// when the project has a remote and `gh` is available. Honest about what it could not do.
import { spawnSync } from 'node:child_process';

function run(cmd, args, cwd) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120000 }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status }; }

/** Returns { mode, links, notes[] }. Never throws; every step that cannot happen is a note. */
export function shipJob(job, { exec = run } = {}) {
  const cwd = job.workdir; const notes = []; const links = {};
  const status = exec('git', ['status', '--porcelain'], cwd);
  if (status.ok && status.out) { exec('git', ['add', '-A'], cwd); const c = exec('git', ['commit', '-q', '-m', `binas: ${job.title}`], cwd); notes.push(c.ok ? 'committed leftover changes' : 'leftover changes could not be committed: ' + c.err.slice(0, 120)); }
  const head = exec('git', ['rev-parse', '--short', 'HEAD'], cwd); if (head.ok) links.commit = head.out;
  links.branch = job.branch;
  if (job.ship === 'none') { notes.push('ship mode none: left on the branch'); return { mode: 'none', links, notes }; }
  const remote = exec('git', ['remote', 'get-url', 'origin'], cwd);
  if (!remote.ok) { notes.push('no git remote: branch only, nothing pushed'); return { mode: 'branch', links, notes }; }
  const push = exec('git', ['push', '-u', 'origin', job.branch], cwd);
  if (!push.ok) { notes.push('push failed: ' + (push.err || push.out).slice(0, 160)); return { mode: 'branch', links, notes }; }
  links.remote = remote.out.replace(/\.git$/, ''); notes.push('pushed ' + job.branch);
  if (job.ship !== 'pr') return { mode: 'branch', links, notes };
  const gh = exec('gh', ['pr', 'create', '--fill', '--head', job.branch, '--title', `binas: ${job.title}`, '--body', `${job.summary ? job.summary.summary || '' : ''}\n\nBuilt on the Binas floor. Job ${job.id}.`], cwd);
  if (gh.ok) { const url = (gh.out.match(/https?:\/\/\S+/) || [])[0]; if (url) links.pr = url; notes.push('pull request opened'); return { mode: 'pr', links, notes }; }
  notes.push('pull request not opened (gh missing or refused): ' + (gh.err || gh.out).slice(0, 160));
  return { mode: 'branch', links, notes };
}
