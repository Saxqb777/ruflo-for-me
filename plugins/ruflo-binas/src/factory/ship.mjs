// Shipping a finished job: make sure the work is committed, create the project's private repository when the
// owner's GitHub is configured and it has none yet, push the branch, and open a pull request when asked and
// `gh` is available. Runs on the host, never inside a session. Honest about what it could not do.
import { spawnSync } from 'node:child_process';

function run(cmd, args, cwd) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 120000 }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status }; }

/** Returns { mode, links, notes[] }. Never throws; every step that cannot happen is a note. */
export function shipJob(job, { exec = run, env = process.env } = {}) {
  const cwd = job.workdir; const notes = []; const links = {};
  const status = exec('git', ['status', '--porcelain'], cwd);
  if (status.ok && status.out) { exec('git', ['add', '-A'], cwd); const c = exec('git', ['-c', 'user.name=Binas', '-c', 'user.email=binas@local', 'commit', '-q', '-m', `binas: ${job.title}`], cwd); notes.push(c.ok ? 'committed leftover changes' : 'leftover changes could not be committed: ' + c.err.slice(0, 120)); }
  const head = exec('git', ['rev-parse', '--short', 'HEAD'], cwd); if (head.ok) links.commit = head.out;
  links.branch = job.branch;
  if (job.ship === 'none') { notes.push('ship mode none: left on the branch'); return { mode: 'none', links, notes }; }
  let remote = exec('git', ['remote', 'get-url', 'origin'], cwd);
  if (!remote.ok && env.BINAS_GITHUB_OWNER && job.project && job.project.slug) {
    const name = `${env.BINAS_GITHUB_OWNER}/${job.cloud ? job.cloud.floor + '-' : ''}${job.project.slug}`.replace(/[^a-z0-9/_.-]/gi, '-');
    const made = exec('gh', ['repo', 'create', name, '--private', '--source', '.', '--remote', 'origin'], cwd);
    if (made.ok) { notes.push('created private repository ' + name); remote = exec('git', ['remote', 'get-url', 'origin'], cwd); }
    else notes.push('could not create a repository (gh missing or refused): ' + (made.err || made.out).slice(0, 160));
  }
  if (!remote.ok) { notes.push('no git remote: branch only, nothing pushed'); return { mode: 'branch', links, notes }; }
  const push = exec('git', ['push', '-u', 'origin', job.branch], cwd);
  if (!push.ok) { notes.push('push failed: ' + (push.err || push.out).slice(0, 160)); return { mode: 'branch', links, notes }; }
  links.remote = remote.out.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/'); notes.push('pushed ' + job.branch);
  if (job.ship !== 'pr') return { mode: 'branch', links, notes };
  const gh = exec('gh', ['pr', 'create', '--fill', '--head', job.branch, '--title', `binas: ${job.title}`, '--body', `${job.summary ? job.summary.summary || '' : ''}\n\nBuilt on the Binas floor. Job ${job.id}.`], cwd);
  if (gh.ok) { const url = (gh.out.match(/https?:\/\/\S+/) || [])[0]; if (url) links.pr = url; notes.push('pull request opened'); return { mode: 'pr', links, notes }; }
  notes.push('pull request not opened (gh missing or refused): ' + (gh.err || gh.out).slice(0, 160));
  return { mode: 'branch', links, notes };
}
