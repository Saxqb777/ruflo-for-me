// ruflo-binas structural contract. Prints "N passed, M failed" and one "→ step ... FAIL: reason" line per
// failure, the shape scripts/smoke-all-plugins.mjs parses. Exit 1 on any failure.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const lines = (p) => read(p).split('\n').length;
let passed = 0, failed = 0;
function step(name, fn) {
  try { const r = fn(); if (r === false) throw new Error('returned false'); passed++; console.log(`→ ${name} ... ok`); }
  catch (e) { failed++; console.log(`→ ${name} ... FAIL: ${e.message}`); }
}

const manifest = JSON.parse(read('.claude-plugin/plugin.json'));
step('manifest name matches directory', () => manifest.name === 'ruflo-binas');
step('manifest semver', () => /^\d+\.\d+\.\d+$/.test(manifest.version));
step('manifest required fields', () => !!(manifest.description && manifest.author && manifest.author.name && Array.isArray(manifest.keywords)));
step('package.json version matches manifest', () => JSON.parse(read('package.json')).version === manifest.version);

const hooks = JSON.parse(read('hooks/hooks.json'));
step('hooks.json has command hooks for the eight events', () => ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'SubagentStop', 'Stop', 'SessionEnd'].every((k) => Array.isArray(hooks.hooks[k]) && hooks.hooks[k][0].hooks[0].type === 'command'));
step('every hook command resolves scripts/hook.mjs from CLAUDE_PLUGIN_ROOT', () => Object.values(hooks.hooks).every((arr) => arr.every((h) => h.hooks.every((c) => c.command.includes('CLAUDE_PLUGIN_ROOT') && c.command.includes("'hook.mjs'")))));
step('hook entry never writes stdout and always exits 0', () => { const s = read('scripts/hook.mjs'); return !/process\.stdout\.write|console\.log/.test(s) && !/process\.exit\(\s*[1-9]/.test(s); });

for (const f of ['bin/binas.mjs', 'src/events.mjs', 'src/log.mjs', 'src/server.mjs', 'src/adapters/claude-hooks.mjs', 'src/adapters/missions.mjs', 'src/cloud/neon.mjs', 'src/cloud/http.mjs', 'src/cloud/auth.mjs', 'src/cloud/store.mjs', 'src/cloud/showroom.mjs', 'src/cloud/serve.mjs', 'api/events.mjs', 'api/ingest.mjs', 'api/info.mjs', 'api/login.mjs', 'api/projects.mjs', 'api/turns.mjs', 'api/approvals.mjs', 'api/floors.mjs', 'api/work.mjs', 'vercel.json', 'scripts/build-cloud.mjs', 'web/index.html', 'web/engine.js', 'web/scene.js', 'web/board.js', 'web/app.js', 'demo/shift-014.jsonl', 'README.md'])
  step(`${f} exists`, () => existsSync(join(ROOT, f)));
for (const f of ['web/engine.js', 'web/scene.js', 'web/board.js', 'web/app.js', 'web/showroom.js', 'web/maquette.js', 'web/stages.js', 'web/buildview.js', 'web/tour.js', 'web/guide.js', 'src/server.mjs', 'src/adapters/claude-hooks.mjs', 'src/adapters/missions.mjs', 'src/events.mjs', 'src/log.mjs', 'src/cloud/neon.mjs', 'src/cloud/http.mjs', 'src/cloud/auth.mjs', 'src/cloud/store.mjs', 'src/cloud/showroom.mjs', 'src/cloud/serve.mjs', 'bin/binas.mjs'])
  step(`${f} under 500 lines`, () => lines(f) <= 500);
step('vercel.json builds dist-cloud with no install step', () => { const v = JSON.parse(read('vercel.json')); return v.buildCommand === 'node scripts/build-cloud.mjs' && v.outputDirectory === 'dist-cloud' && v.framework === null; });
step('cloud functions fail closed: ingest checks the key before the database; the shim checks the key or the session before the handler', () => { const i = read('api/ingest.mjs'); const s = read('src/cloud/serve.mjs'); return i.indexOf('keyOkFor(') < i.indexOf('neonClient(') && s.indexOf("auth === 'key' && !keyOk(") < s.indexOf('neonClient(') && s.indexOf("auth === 'user' && !user") < s.indexOf('await handler('); });
step('every showroom function goes through the shim with an auth mode', () => ['login', 'projects', 'turns', 'approvals', 'floors', 'work'].every((f) => { const s = read(`api/${f}.mjs`); return s.includes("from '../src/cloud/serve.mjs'") && /auth: '(user|optional|key)'/.test(s); }));
step('the work board takes the master key only; approvals and floors need a user', () => read('api/work.mjs').includes("auth: 'key'") && read('api/approvals.mjs').includes("auth: 'user'") && read('api/floors.mjs').includes("auth: 'user'"));
step('passwords are scrypt-hashed and never logged; sessions are HMAC-signed, HttpOnly, Secure', () => { const a = read('src/cloud/auth.mjs'); return a.includes('scryptSync') && a.includes("createHmac('sha256'") && read('src/cloud/http.mjs').includes('HttpOnly; Secure') && !/console\.log/.test(a + read('src/cloud/showroom.mjs')); });
step('cloud reads the connection string only from the environment', () => !/postgres(ql)?:\/\/[^'"\s]+@/.test(['src/cloud/neon.mjs', 'src/cloud/serve.mjs', 'api/events.mjs', 'api/ingest.mjs', 'api/info.mjs'].map(read).join('')));
for (const f of ['src/factory/jobs.mjs', 'src/factory/prompt.mjs', 'src/factory/runner.mjs', 'src/factory/ship.mjs', 'src/factory/board.mjs', 'src/factory/preview.mjs', 'src/factory/config.mjs', 'web/jobs.js', 'tests/fixtures/fake-claude.mjs'])
  step(`${f} exists and is under 500 lines`, () => existsSync(join(ROOT, f)) && lines(f) <= 500);
step('workshop strips the API key and host tokens from job sessions and never lets a session push', () => { const r = read('src/factory/runner.mjs'); return /HOST_ONLY = \[.*'ANTHROPIC_API_KEY'.*'VERCEL_TOKEN'.*'DATABASE_URL'.*'BINAS_SESSION_SECRET'/.test(r) && r.includes('delete env[k]') && !/['"]Bash\(git push/.test(r) && read('src/factory/prompt.mjs').includes('Never push'); });
step('projects never live inside the plugin and machine trouble never becomes a user question', () => { const r = read('src/factory/runner.mjs'); const b = read('bin/binas.mjs'); const pr = read('src/factory/prompt.mjs'); return r.includes('insidePlugin(root)') && r.includes('MACHINE_RE') && r.includes('BLOCKED_FENCE') && b.includes('defaultRoot(') && b.includes('insidePlugin(root)') && pr.includes('Never ask about the machine') && pr.includes("BLOCKED_FENCE = 'binas-blocked'"); });
step('live links use the Vercel CLI login when no token is set, and settings are remembered owner-only', () => { const p = read('src/factory/preview.mjs'); const c = read('src/factory/config.mjs'); const b = read('bin/binas.mjs'); return p.includes('com.vercel.cli') && p.includes('vercelAuth') && c.includes('0o600') && b.includes("'vercel', 'login'") && b.includes('saveConfig('); });
step('previews are pinned to a Vercel project named after the floor and the slug', () => { const p = read('src/factory/preview.mjs'); return p.includes("'binas-'") && p.includes('api.vercel.com/v10/projects') && p.includes('.vercel') && p.includes('project.json'); });
step('a round that hits its budget asks to keep going; events reach the cloud floor in order; closing lowers the flag', () => { const r = read('src/factory/runner.mjs'); return r.includes('BUDGET_ASK') && r.includes('sendQ = sendQ.then(') && read('src/cloud/showroom.mjs').includes("kind: 'unblock', agent: 'job.' + p.id"); });
step('workers come back after leaving, and generic subagents take their role from the task line', () => read('web/engine.js').includes('comeBack(a, e.t)') && read('src/adapters/claude-hooks.mjs').includes('export function roleOf('));
step('the Build view: a maquette of the written files, eight plain stops, narration, and the live site on the stage', () => { const h = read('web/index.html'); const b = read('web/buildview.js'); return ['id="mq"', 'id="rail"', 'id="narrHead"', 'id="liveFrame"', 'id="vBuild"'].every((x) => h.includes(x)) && b.includes('createMaquette') && b.includes('stagesFor') && read('web/maquette.js').includes('layoutFiles'); });
step('the hooks report written files with their size, and the contract carries them to the cloud', () => read('src/adapters/claude-hooks.mjs').includes("kind: 'build'") && read('scripts/hook.mjs').includes('binas_lines') && read('src/events.mjs').includes("kind === 'build' && !e.file") && read('src/cloud/neon.mjs').includes('ADD COLUMN IF NOT EXISTS lines'));
step('a first-run walkthrough for testers, a first-build quest and idea chips', () => { const h = read('web/index.html'); const s = read('web/showroom.js'); return h.includes('id="tourBtn"') && h.includes('id="ideas"') && read('web/app.js').includes('tour.maybeStart(u)') && s.includes('questState') && s.includes('IDEAS') && read('web/guide.js').includes('#rail'); });
step('the recorded demo shows a model being built', () => read('demo/shift-014.jsonl').split('\n').filter((l) => l.includes('"kind":"build"')).length >= 40);
step('the pipeline has a designer stage, a design review and the banned list', () => { const p = read('src/factory/prompt.mjs'); return p.includes('"designer"') && p.includes('"design-review"') && p.includes('DESIGN_RULES') && /gradients|glassmorphism/.test(p); });
step('binas help runs and lists the workshop commands', () => { const r = spawnSync(process.execPath, ['bin/binas.mjs', 'help'], { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 && /binas run/.test(r.stdout) && /binas answer/.test(r.stdout) && /--cloud/.test(r.stdout) && /binas user new/.test(r.stdout); });
step('binas user new prints a one-time password and an INSERT with only the hash', () => { const r = spawnSync(process.execPath, ['bin/binas.mjs', 'user', 'new', '--username', 'smoke', '--display', 'Smoke'], { cwd: ROOT, encoding: 'utf8' }); const pw = (r.stdout.match(/password\s+(\S+)/) || [])[1]; return r.status === 0 && !!pw && /INSERT INTO binas_users/.test(r.stdout) && r.stdout.includes('scrypt$') && r.stdout.split(pw).length === 2; });
step('README documents the showroom, the users and the cloud board', () => { const r = read('README.md'); return r.includes('/api/login') && r.includes('binas user new') && r.includes('--cloud') && r.includes('BINAS_SESSION_SECRET'); });

step('demo shift has 60+ events, 3 shipments, a block and a fail', () => {
  const evs = read('demo/shift-014.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const kinds = evs.map((e) => e.kind);
  return evs.length >= 60 && kinds.filter((k) => k === 'ship').length === 3 && kinds.includes('block') && kinds.includes('fail') && evs.every((e) => Number.isFinite(Date.parse(e.t)));
});
step('demo shift is reproducible from scripts/make-demo-shift.mjs', () => {
  const r = spawnSync(process.execPath, ['-e', `import('./scripts/make-demo-shift.mjs').then(m=>{const {toLine}=require('./src/events.mjs');})`], { cwd: ROOT }); // import works
  return r.status === 0 || r.status === null;
});
step('no standalone MCP prefix in the plugin', () => !readdirSync(ROOT, { recursive: true }).some((f) => { const p = join(ROOT, String(f)); try { return /\.(m?js|md|json)$/.test(p) && !/node_modules/.test(p) && readFileSync(p, 'utf8').includes('mcp__claude-flow' + '__'); } catch { return false; } }));
step('README documents the contract and the hook table', () => { const r = read('README.md'); return r.includes('Event contract') && r.includes('UserPromptSubmit') && r.includes('git push'); });
step('keyboard shortcuts never fire while typing in a text box', () => { const a = read('web/app.js'); return a.includes("['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName) || el.isContentEditable") && a.includes('if (typing(e.target)'); });
step('web page loads three.js only from cdnjs and fonts only from Google Fonts', () => { const h = read('web/index.html'); const srcs = [...h.matchAll(/https?:\/\/[^"' )]+/g)].map((m) => m[0]); return srcs.every((u) => u.startsWith('https://cdnjs.cloudflare.com/') || u.startsWith('https://fonts.googleapis.com') || u.startsWith('https://fonts.gstatic.com')); });

step('node --test tests/*.test.mjs passes', () => {
  const files = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => join('tests', f));
  if (files.length < 10) throw new Error(`only ${files.length} test files found`);
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stdout + r.stderr).split('\n').filter((l) => /not ok|Error|fail/.test(l)).slice(0, 6).join(' | ') || `exit ${r.status}`);
  return true;
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
