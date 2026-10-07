#!/usr/bin/env node
// binas — the office floor and the workshop, from the command line.
//   binas serve [--port 4777] [--root <dir>] [--open]   start the floor on loopback and follow the live feed
//   binas demo  [--port 4777] [--open]                  same, landing on the recorded demo shift
//   binas run   [--root <dir>] [--claude <bin>] [--sandbox docker] [--floor <name>] [--once]
//                                                       the workshop: build queued jobs with headless Claude Code
//   binas job add --title "…" --brief "…" [--project <path> | --slug <name>] [--ship pr|branch|none] [--budget 5] [--model <m>] [--autonomy ask|full]
//   binas jobs                                          list jobs
//   binas answer <jobId> "<text>"                       answer a job that is waiting for you
//   binas tail  [--root <dir>]                          print events as they are appended
//   binas emit  '<json>' [--root <dir>]                 append one event by hand (testing)
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startServer } from '../src/server.mjs';
import { appendEvent, followEvents, readEvents } from '../src/log.mjs';
import { makeJob, saveJob, listJobs, answerJob, summarize } from '../src/factory/jobs.mjs';
import { createRunner } from '../src/factory/runner.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flag = (name, dflt) => { const i = argv.indexOf(name); return i > 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const has = (name) => argv.includes(name);
const root = resolve(flag('--root', process.env.CLAUDE_PROJECT_DIR || process.cwd()));
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
  for (const j of jobs) out(`${stateMark[j.state] || '·'} ${j.id}  ${j.state.padEnd(8)}  ${j.title}${j.question ? `\n      needs you: ${j.question.text}${j.question.options.length ? '  [' + j.question.options.join(' / ') + ']' : ''}` : ''}${j.links && (j.links.pr || j.links.remote) ? `\n      ${j.links.pr || j.links.remote}` : ''}${j.error ? `\n      ${j.error}` : ''}`);
}

switch (cmd) {
  case 'serve': serve(false).catch((e) => die(e.message, 1)); break;
  case 'demo': serve(true).catch((e) => die(e.message, 1)); break;
  case 'run': {
    const bin = flag('--claude', process.env.BINAS_CLAUDE_BIN || 'claude');
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) die(`cannot run "${bin}". Install Claude Code and log in (claude login), or pass --claude <path>.`, 1);
    const runner = createRunner({ root, claude: { bin, prefixArgs: [] }, sandbox: flag('--sandbox', 'none'), floor: flag('--floor', process.env.BINAS_FLOOR || null), log: out });
    out(`Binas workshop  root ${root}\n  claude   ${bin} (${probe.stdout.trim()})\n  sandbox  ${flag('--sandbox', 'none')}\n  fuel     the login on this machine (API key stripped from jobs)\n  jobs     ${listJobs(root).length} on file`);
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
  case 'tail': { for (const e of readEvents(root).slice(-20)) out(JSON.stringify(e)); followEvents(root, (e) => out(JSON.stringify(e))); break; }
  case 'emit': {
    const raw = argv[1]; if (!raw) die('usage: binas emit \'{"kind":"start","agent":"me","text":"hello"}\'');
    let obj; try { obj = JSON.parse(raw); } catch { die('emit: not JSON'); }
    if (obj.t === undefined) obj.t = Date.now();
    process.exit(appendEvent(root, obj) ? 0 : 2);
    break;
  }
  default:
    out(`binas — the office floor and the workshop\n\n  binas serve [--port 4777] [--root <dir>] [--open]\n  binas demo  [--port 4777] [--open]\n  binas run   [--root <dir>] [--claude <bin>] [--sandbox docker] [--floor <name>] [--once]\n  binas job add --title "…" --brief "…" [--project <path> | --slug <name>] [--ship pr|branch|none] [--budget 5] [--model <m>] [--autonomy ask|full]\n  binas jobs\n  binas answer <jobId> "<text>"\n  binas tail  [--root <dir>]\n  binas emit  '<json>' [--root <dir>]`);
    process.exit(cmd === 'help' ? 0 : 2);
}
void summarize;
