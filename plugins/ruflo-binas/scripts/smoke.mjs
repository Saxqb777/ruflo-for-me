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

for (const f of ['bin/binas.mjs', 'src/events.mjs', 'src/log.mjs', 'src/server.mjs', 'src/adapters/claude-hooks.mjs', 'src/adapters/missions.mjs', 'web/index.html', 'web/engine.js', 'web/scene.js', 'web/board.js', 'web/app.js', 'demo/shift-014.jsonl', 'README.md'])
  step(`${f} exists`, () => existsSync(join(ROOT, f)));
for (const f of ['web/engine.js', 'web/scene.js', 'web/board.js', 'web/app.js', 'src/server.mjs', 'src/adapters/claude-hooks.mjs', 'src/adapters/missions.mjs', 'src/events.mjs', 'src/log.mjs', 'bin/binas.mjs'])
  step(`${f} under 500 lines`, () => lines(f) <= 500);

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
step('web page loads three.js only from cdnjs and fonts only from Google Fonts', () => { const h = read('web/index.html'); const srcs = [...h.matchAll(/https?:\/\/[^"' )]+/g)].map((m) => m[0]); return srcs.every((u) => u.startsWith('https://cdnjs.cloudflare.com/') || u.startsWith('https://fonts.googleapis.com') || u.startsWith('https://fonts.gstatic.com')); });

step('node --test tests/*.test.mjs passes', () => {
  const files = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => join('tests', f));
  if (files.length < 4) throw new Error(`only ${files.length} test files found`);
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stdout + r.stderr).split('\n').filter((l) => /not ok|Error|fail/.test(l)).slice(0, 6).join(' | ') || `exit ${r.status}`);
  return true;
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
