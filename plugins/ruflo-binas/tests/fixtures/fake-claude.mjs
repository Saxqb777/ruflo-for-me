// A stand-in for the `claude` command in tests. Speaks the stream-json shape the runner parses:
// first run asks the owner a question; a --resume run writes a file and declares done.
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const resume = args.includes('--resume');
const budget = args[args.indexOf('--max-budget-usd') + 1];
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', session_id: resume ? args[args.indexOf('--resume') + 1] : 'sess_fake_1', cwd: process.cwd(), tools: ['Agent'] });
out({ type: 'assistant', message: { content: [{ type: 'text', text: resume ? 'Continuing with the answer.' : 'Reading the brief.' }] } });
if (!resume) {
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, total_cost_usd: 0.01, session_id: 'sess_fake_1', result: 'I need one decision.\n\n```binas-ask\n{"question":"Dark mode by default?","options":["yes","no"],"context":"affects the palette"}\n```' });
} else {
  writeFileSync('built.txt', `built with budget ${budget}\n`);
  out({ type: 'result', subtype: 'success', is_error: false, num_turns: 5, total_cost_usd: 0.02, session_id: 'sess_fake_1', result: 'Done.\n\n```binas-done\n{"summary":"A tiny app with dark mode by default.","branch":"whatever","howToRun":"node app.js","notes":"none"}\n```' });
}
