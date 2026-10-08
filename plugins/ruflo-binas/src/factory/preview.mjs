// A live link for every web project: the host (never the session) deploys the work directory to Vercel with
// VERCEL_TOKEN. The Vercel project is named after the floor and the slug, so two floors building the same
// idea never overwrite each other. Honest when it cannot deploy.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd, args, cwd, env) { const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 600000 }); return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status }; }

/** The Vercel project name: binas-<floor>-<slug>, lower-case, at most 52 characters. */
export function previewName(job) {
  const raw = 'binas-' + (job.cloud && job.cloud.floor ? job.cloud.floor + '-' : '') + ((job.project && job.project.slug) || 'project');
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 52).replace(/-$/, '');
}

/** Find or create the Vercel project; returns { projectId, orgId } or throws with the API's reason. */
export async function ensureVercelProject(name, { token, teamId = '', fetchImpl = globalThis.fetch } = {}) {
  const q = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  let r = await fetchImpl(`https://api.vercel.com/v9/projects/${encodeURIComponent(name)}${q}`, { headers });
  if (r.status === 404) r = await fetchImpl(`https://api.vercel.com/v10/projects${q}`, { method: 'POST', headers, body: JSON.stringify({ name }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`vercel ${r.status}: ${(j.error && j.error.message) || 'project lookup failed'}`);
  return { projectId: j.id, orgId: teamId || j.accountId };
}

/** Returns { url, notes[] }. `url` is null when nothing was deployed. Never throws. */
export async function previewDeploy(job, { exec = run, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const notes = [];
  if ((job.kind || 'web') !== 'web') return { url: null, notes: ['no screen, no preview'] };
  if (!env.VERCEL_TOKEN) return { url: null, notes: ['no VERCEL_TOKEN on the workshop: no live link this turn'] };
  const cwd = job.workdir;
  if (!['index.html', 'package.json', 'vercel.json'].some((f) => existsSync(join(cwd, f)))) return { url: null, notes: ['nothing deployable yet (no index.html, package.json or vercel.json)'] };
  const name = previewName(job);
  try {
    const { projectId, orgId } = await ensureVercelProject(name, { token: env.VERCEL_TOKEN, teamId: env.VERCEL_TEAM_ID || '', fetchImpl });
    mkdirSync(join(cwd, '.vercel'), { recursive: true }); writeFileSync(join(cwd, '.vercel', 'project.json'), JSON.stringify({ projectId, orgId }));
    notes.push('vercel project ' + name);
  } catch (e) { notes.push('could not pin the Vercel project name (' + e.message.slice(0, 120) + '); deploying under the folder name'); }
  const args = ['--yes', 'vercel', 'deploy', '--prod', '--yes', '--token', env.VERCEL_TOKEN];
  if (env.VERCEL_TEAM_ID) args.push('--scope', env.VERCEL_TEAM_ID);
  const r = exec('npx', args, cwd, env);
  const url = ((r.out + '\n' + r.err).match(/https:\/\/[a-z0-9.-]+\.vercel\.app\S*/gi) || []).pop() || null;
  if (!r.ok && !url) { notes.push('preview deploy failed: ' + (r.err || r.out).slice(-200)); return { url: null, notes }; }
  notes.push(url ? 'live at ' + url : 'vercel ran but printed no URL');
  return { url, notes };
}
