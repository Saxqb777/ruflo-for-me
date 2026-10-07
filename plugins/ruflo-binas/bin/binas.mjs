#!/usr/bin/env node
// binas — the office floor, from the command line.
//   binas serve [--port 4777] [--root <dir>] [--open]   start the floor on loopback and follow the live feed
//   binas demo  [--port 4777] [--open]                  same, landing on the recorded demo shift
//   binas tail  [--root <dir>]                          print events as they are appended
//   binas emit  '<json>' [--root <dir>]                 append one event by hand (testing)
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startServer } from '../src/server.mjs';
import { appendEvent, followEvents, readEvents } from '../src/log.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const flag = (name, dflt) => { const i = argv.indexOf(name); return i > 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const has = (name) => argv.includes(name);
const root = resolve(flag('--root', process.env.CLAUDE_PROJECT_DIR || process.cwd()));
const port = Number(flag('--port', process.env.BINAS_PORT || 4777));

function openBrowser(url) {
  const [bin, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { const c = spawn(bin, args, { stdio: 'ignore', detached: true }); c.on('error', () => {}); c.unref(); } catch { /* no browser here */ }
}

async function serve(demo) {
  const s = await startServer({ root, port, demoDefault: demo });
  const n = readEvents(root).length;
  process.stdout.write(`Binas floor  ${s.url}${demo ? '?src=demo' : ''}\n  project  ${root}\n  log      .claude-flow/binas/events.jsonl (${n} event${n === 1 ? '' : 's'} so far)\n  Ctrl-C to stop\n`);
  if (has('--open')) openBrowser(s.url + (demo ? '?src=demo' : ''));
  const stop = () => s.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

switch (cmd) {
  case 'serve': serve(false).catch((e) => { console.error(e.message); process.exit(1); }); break;
  case 'demo': serve(true).catch((e) => { console.error(e.message); process.exit(1); }); break;
  case 'tail': {
    for (const e of readEvents(root).slice(-20)) process.stdout.write(JSON.stringify(e) + '\n');
    followEvents(root, (e) => process.stdout.write(JSON.stringify(e) + '\n'));
    break;
  }
  case 'emit': {
    const raw = argv[1]; if (!raw) { console.error('usage: binas emit \'{"kind":"start","agent":"me","text":"hello"}\''); process.exit(2); }
    let obj; try { obj = JSON.parse(raw); } catch { console.error('emit: not JSON'); process.exit(2); }
    if (obj.t === undefined) obj.t = Date.now();
    process.exit(appendEvent(root, obj) ? 0 : 2);
    break;
  }
  default:
    process.stdout.write(`binas — the office floor as a living model\n\n  binas serve [--port 4777] [--root <dir>] [--open]\n  binas demo  [--port 4777] [--open]\n  binas tail  [--root <dir>]\n  binas emit  '<json>' [--root <dir>]\n`);
    process.exit(cmd === 'help' ? 0 : 2);
}
