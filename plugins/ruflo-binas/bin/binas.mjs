#!/usr/bin/env node
// binas — the office floor and the workshop, from the command line.
//   binas serve [--port 4777] [--root <dir>] [--open]   start the floor on loopback and follow the live feed
//   binas demo  [--port 4777] [--open]                  same, landing on the recorded demo shift
//   binas run   [--root <dir>] [--claude <bin>] [--sandbox docker] [--floor <name>] [--once]
//               [--cloud <url> --key <master key> --team <vercel team id>] [--no-preview]
//                                                       the workshop: build queued jobs, local then the cloud board.
//                                                       Flags given once are saved to ~/.binas/config.json.
//   binas job add --title "…" --brief "…" [--project <path> | --slug <name>] [--ship pr|branch|none] [--budget 5] [--model <m>] [--autonomy ask|full]
//   binas jobs                                          list jobs
//   binas answer <jobId> "<text>"                       answer a job that is waiting for you
//   binas user new --username <u> --display "<name>" [--role owner|tester] [--floor <name>] [--allowance 25]
//                                                       print a one-time password and the SQL that adds the user
//   binas tail  [--root <dir>]                          print events as they are appended
//   binas emit  '<json>' [--root <dir>]                 append one event by hand (testing)
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startServer } from '../src/server.mjs';
import { appendEvent, followEvents, readEvents } from '../src/log.mjs';
import { makeJob, saveJob, listJobs, answerJob } from '../src/factory/jobs.mjs';
import { createRunner, defaultRoot, insidePlugin, PLUGIN_ROOT_ERROR } from '../src/factory/runner.mjs';
import { createBoard } from '../src/factory/board.mjs';
import { loadConfig, saveConfig, configPath } from '../src/factory/config.mjs';
import { vercelAuth } from '../src/factory/preview.mjs';
import { hashPassword, newPassword, usernameOk } from '../src/cloud/auth.mjs';
import { userInsertSql } from '../src/cloud/store.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flag = (name, dflt) => { const i = argv.indexOf(name); return i > 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const has = (name) => argv.includes(name);
const root = flag('--root') ? resolve(flag('--root')) : defaultRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const port = Number(flag('--port', process.env.BINAS_PORT || 4777));
const out = (s) => process.stdout.write(s + '\n');
const die = (s, code = 2) => { console.error(s); process.exit(code); };

function openBrowser(url) {
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { const c = spawn(bin, args, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); } catch { /* no browser here */ }
}
async function serve(demo) {
  const s = await startServer({ root, port, demoDefault: demo });
  const n = readEvents(root).length;
  out(`Binas floor  ${s.url}${demo ? '?src=demo' : ''}\n  project  ${root}\n  log      .claude-flow/binas/events.jsonl (${n} event${n === 1 ? '' : 's'} so far)\n  Ctrl-C to stop`);
  if (has('--open')) openBrowser(s.url + (demo ? '?src=demo' : ''));
  const stop = () => s.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
const stateMark = { queued: '·', running: '▸', blocked: '!', answered: '▸', done: '✓', shipped: '✓', failed: '×' };
function printJobs() {
  const jobs = listJobs(root); if (!jobs.length) return out('no jobs yet. binas job add --title "…" --brief "…"');
  for (const j of jobs) out(`${stateMark[j.state] || '·'} ${j.id}  ${j.state.padEnd(8)}  ${j.title}${j.cloud ? `  (cloud · floor ${j.cloud.floor})` : ''}${j.question ? `\n      needs you: ${j.question.text}${j.question.options.length ? '  [' + j.question.options.join(' / ') + ']' : ''}` : ''}${j.links && (j.links.preview || j.links.pr || j.links.remote) ? `\n      ${j.links.preview || j.links.pr || j.links.remote}` : ''}${j.error ? `\n      ${j.error}` : ''}`);
}

switch (cmd) {
  case 'serve': serve(false).catch((e) => die(e.message, 1)); break;
  case 'demo': serve(true).catch((e) => die(e.message, 1)); break;
  case 'run': {
    const bin = flag('--claude', process.env.BINAS_CLAUDE_BIN || 'claude');
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) die(`cannot run "${bin}". Install Claude Code and log in (claude login), or pass --claude <path>.`, 1);
    if (insidePlugin(root)) die(PLUGIN_ROOT_ERROR, 1);
    const cfg = loadConfig();
    const cloudUrl = flag('--cloud', process.env.BINAS_CLOUD_URL || cfg.cloud || ''); const key = flag('--key', process.env.BINAS_KEY || cfg.key || '');
    if (cloudUrl && !key) die('--cloud needs --key (or BINAS_KEY): the master key of the showroom', 1);
    const team = flag('--team', process.env.VERCEL_TEAM_ID || cfg.vercelTeamId || ''); if (team) process.env.VERCEL_TEAM_ID = team;
    const ghOwner = flag('--github', process.env.BINAS_GITHUB_OWNER || cfg.githubOwner || ''); if (ghOwner) process.env.BINAS_GITHUB_OWNER = ghOwner;
    const given = { cloud: flag('--cloud'), key: flag('--key'), vercelTeamId: flag('--team'), githubOwner: flag('--github') };
    if (Object.values(given).some(Boolean)) { saveConfig(given); out(`saved your settings to ${configPath()} · next time just run: node bin/binas.mjs run`); }
    if (!has('--no-preview') && !vercelAuth(process.env) && process.stdin.isTTY) {
      out('One-time Vercel login, so finished sites get a live link. Your browser opens; confirm there and come back.');
      const login = spawnSync('npx', ['--yes', 'vercel', 'login'], { stdio: 'inherit' });
      if (login.status !== 0 || !vercelAuth(process.env)) out('Vercel login skipped or failed: builds still run, without live links. Try again any time with: npx vercel login');
    }
    const auth = has('--no-preview') ? null : vercelAuth(process.env);
    if (!auth) process.env.BINAS_NO_PREVIEW = '1';
    const board = cloudUrl ? createBoard({ url: cloudUrl, key, floor: flag('--floor', 'all') }) : null;
    const runner = createRunner({ root, claude: { bin, prefixArgs: [] }, sandbox: flag('--sandbox', 'none'), floor: board ? null : flag('--floor', process.env.BINAS_FLOOR || null), board, log: out });
    out(`Binas workshop  projects and log under ${root}\n  claude   ${bin} (${probe.stdout.trim()})\n  sandbox  ${flag('--sandbox', 'none')}\n  fuel     the login on this machine (API key and host tokens stripped from sessions)\n  board    ${board ? board.url + ' (floor ' + flag('--floor', 'all') + ')' : 'local only (add --cloud <url> --key <key> for the showroom)'}\n  github   ${process.env.BINAS_GITHUB_OWNER ? 'repos under ' + process.env.BINAS_GITHUB_OWNER : 'code stays on this machine (add --github <user> to push private repos)'}\n  preview  ${auth ? `every web turn ends with a live link (via ${auth.source}${team ? ', team ' + team : ''})` : 'NO live links: run npx vercel login, then restart'}\n  jobs     ${listJobs(root).length} on file`);
    if (has('--once')) { runner.tick().then((j) => { out(j ? `worked on ${j.id} → ${j.state}` : 'nothing to do'); process.exit(0); }).catch((e) => die(e.message, 1)); }
    else { const stop = runner.start(Number(flag('--poll', 3000))); out('  watching for jobs · Ctrl-C to stop'); process.on('SIGINT', () => { stop(); process.exit(0); }); }
    break;
  }
  case 'job': {
    if (argv[1] !== 'add') die('usage: binas job add --title "…" --brief "…" [--project <path> | --slug <name>] [--ship pr|branch|none] [--budget 5]');
    try {
      const job = saveJob(root, makeJob({ title: flag('--title'), brief: flag('--brief'), project: flag('--project'), slug: flag('--slug'), ship: flag('--ship'), budgetUsd: flag('--budget'), model: flag('--model'), autonomy: flag('--autonomy') }, root));
      out(`queued ${job.id}  ${job.title}\n  project ${job.project.kind} · ${job.project.path}\n  branch  ${job.branch} · ship ${job.ship} · budget $${job.budgetUsd} · ${job.autonomy}\n  start the workshop with: binas run`);
    } catch (e) { die(e.message); }
    break;
  }
  case 'jobs': printJobs(); break;
  case 'answer': {
    const id = argv[1], text = argv.slice(2).join(' ');
    if (!id || !text) die('usage: binas answer <jobId> "<text>"');
    try { const j = answerJob(root, id, text); out(`answered ${j.id}; the workshop resumes it on its next pass`); } catch (e) { die(e.message); }
    break;
  }
  case 'user': {
    if (argv[1] !== 'new') die('usage: binas user new --username <u> --display "<name>" [--role owner|tester] [--floor <name>] [--allowance 25]');
    const username = flag('--username'); if (!usernameOk(username)) die('--username: 2 to 32 letters, digits, . _ -');
    const role = flag('--role', 'tester') === 'owner' ? 'owner' : 'tester'; const floor = String(flag('--floor', username)).toLowerCase();
    const allowance = role === 'owner' ? null : Number(flag('--allowance', 25));
    const password = newPassword();
    out(`user      ${username} (${role}) · floor ${floor} · allowance ${allowance === null ? 'unlimited' : '$' + allowance + '/month'}\npassword  ${password}   ← give this to them once; it is not stored anywhere\n\nRun this in the Neon SQL editor for the binas database:\n${userInsertSql({ username, display: flag('--display', username), role, floor, allowanceUsd: allowance, passHash: hashPassword(password) })}`);
    break;
  }
  case 'tail': { for (const e of readEvents(root).slice(-20)) out(JSON.stringify(e)); followEvents(root, (e) => out(JSON.stringify(e))); break; }
  case 'emit': {
    const raw = argv[1]; if (!raw) die('usage: binas emit \'{"kind":"start","agent":"me","text":"hello"}\'');
    let obj; try { obj = JSON.parse(raw); } catch { die('emit: not JSON'); }
    if (obj.t === undefined) obj.t = Date.now();
    process.exit(appendEvent(root, obj) ? 0 : 2);
    break;
  }
  default:
    out(`binas — the office floor and the workshop\n\n  binas serve [--port 4777] [--root <dir>] [--open]\n  binas demo  [--port 4777] [--open]\n  binas run   [--root <dir>] [--claude <bin>] [--sandbox docker] [--floor <name>] [--once] [--cloud <url> --key <key> --team <id>] [--no-preview]\n  binas job add --title "…" --brief "…" [--project <path> | --slug <name>] [--ship pr|branch|none] [--budget 5] [--model <m>] [--autonomy ask|full]\n  binas jobs\n  binas answer <jobId> "<text>"\n  binas user new --username <u> --display "<name>" [--role owner|tester] [--floor <name>] [--allowance 25]\n  binas tail  [--root <dir>]\n  binas emit  '<json>' [--root <dir>]`);
    process.exit(cmd === 'help' ? 0 : 2);
}
