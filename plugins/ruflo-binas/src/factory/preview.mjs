// A preview for every web project: the host (never the session) runs `vercel deploy --prod` from the work
// directory with VERCEL_TOKEN, so the project's public URL always shows its latest turn. Honest when it cannot.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd, args, cwd, env) { const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 600000 }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status }; }

/** Returns { url, notes[] }. `url` is null when nothing was deployed. Never throws. */
export function previewDeploy(job, { exec = run, env = process.env } = {}) {
  const notes = [];
  if ((job.kind || 'web') !== 'web') return { url: null, notes: ['no screen, no preview'] };
  if (!env.VERCEL_TOKEN) return { url: null, notes: ['no VERCEL_TOKEN on the workshop: no preview deployed'] };
  const cwd = job.workdir;
  if (!['index.html', 'package.json', 'vercel.json'].some((f) => existsSync(join(cwd, f)))) return { url: null, notes: ['nothing deployable yet (no index.html, package.json or vercel.json)'] };
  const args = ['--yes', 'vercel', 'deploy', '--prod', '--yes', '--token', env.VERCEL_TOKEN];
  if (env.VERCEL_SCOPE) args.push('--scope', env.VERCEL_SCOPE);
  const r = exec('npx', args, cwd, { ...env, VERCEL_PROJECT_NAME: job.project ? job.project.slug : undefined });
  const url = ((r.out + '\n' + r.err).match(/https:\/\/[a-z0-9.-]+\.vercel\.app\S*/gi) || []).pop() || null;
  if (!r.ok && !url) { notes.push('preview deploy failed: ' + (r.err || r.out).slice(-200)); return { url: null, notes }; }
  notes.push(url ? 'preview deployed: ' + url : 'vercel ran but printed no URL');
  return { url, notes };
}
