// Turns a job into the prompt a headless Claude Code session runs: the Ruflo pipeline (named subagents
// through the Agent tool), the floor's rules, the design stage for anything with a screen, and two fenced
// blocks the runner understands: `binas-ask` parks the job on a question; `binas-done` is the shift report.
export const ASK_FENCE = 'binas-ask';
export const DONE_FENCE = 'binas-done';
export const BLOCKED_FENCE = 'binas-blocked';

/** The no-slop rules. They go into DESIGN.md of every project with a screen and into the design review. */
export const DESIGN_RULES = [
  'One accent colour, chosen for this product and named in DESIGN.md. Everything else is paper, ink and two greys.',
  'A type pair chosen on purpose (display + text or mono) with a written scale: 12/14/16/20/28/40. No default system stack by accident.',
  'A spacing scale (4/8/12/16/24/32/48) and a grid. Nothing eyeballed.',
  'Real copy for this product, in its own voice. No lorem ipsum, no "Welcome to X", no "Get started today".',
  'Banned: purple-to-blue gradients, glassmorphism, blurred blobs, emoji as icons, drop shadows on everything, a hero with three feature cards, rounded-everything, stock illustration people, confetti, sparkles.',
  'Every list has a designed empty state, a loading state and an error state with a sentence that says what to do.',
  'Numbers are tabular. Dates are written out. Buttons say the verb. Forms validate at the edge and say exactly what is wrong.',
  'Contrast at least 4.5:1, focus visible, works with the keyboard, reads at 375px wide and at 1440px.',
  'Motion only when it carries meaning, under 200ms, never a spring or a bounce.',
];

const pipeline = (web) => [
  `Use the Agent tool to spawn named teammates, in this order, and wait for each before the next. Give each a precise task and tell it what to hand back. You integrate their results.`,
  `1. "researcher": understand the request and the code; list unknowns and the smallest thing that satisfies the brief.`,
  web ? `2. "designer": write DESIGN.md: the product's one accent colour, the type pair and scale, spacing, the component list, copy voice, the three states for every list, and this banned list verbatim: ${DESIGN_RULES.join(' ')} No code yet.` : `2. "designer" is skipped: nothing here has a screen. Write a short INTERFACE.md instead (commands, inputs, outputs, errors).`,
  `3. "architect": the file plan and the data shape; keep files under 500 lines; pick the smallest stack that does the job (static HTML/CSS/JS for sites, Node for services). ${web ? 'A site must open from index.html at the repository root with no build step; if a build is unavoidable, package.json needs a build script that writes to dist/. The owner\'s machine deploys it to Vercel the moment you finish, so done means it runs.' : 'It must run with one documented command.'}`,
  `4. "coder": implement exactly the plan${web ? ', following DESIGN.md to the letter' : ''}; tests first for anything with logic.`,
  `5. "tester": write and run tests; everything must pass before the next step.`,
  web ? `6. "design-review": run the app, take screenshots at 375px and 1440px (Playwright if it is installed, otherwise open the HTML and describe what is on screen honestly), check every rule in DESIGN.md and the banned list, and fix what fails. Repeat until it passes. Save screenshots under docs/screens/.` : `6. (no screen to review)`,
  `7. "reviewer": review for bugs, security and leftovers; fix what it finds.`,
].join('\n');

const rules = (job) => [
  `Work only inside the current directory. You are on git branch \`${job.branch}\`. Commit as you go with clear messages. Never push, deploy, publish, or spend money: the owner's machine does that after you finish.`,
  `Keep files under 500 lines. No secrets in the repo; configuration comes from the environment. Validate input at the edges.`,
  `Do not ask about things you can decide yourself. Make routine calls and note them in the report.`,
].join('\n');

const asks = () => [
  `## When you need the person who asked for this`,
  `Only for product decisions: scope, look and feel, a tradeoff that changes what people get. They have never coded. Write one short sentence in plain words: no file names, no tool names, no jargon, no money. Give 2 to 4 options, your recommendation first. Then stop and end your reply with exactly one block like this and nothing after it:`,
  '```' + ASK_FENCE, JSON.stringify({ question: 'Should people play against the computer, or two on one keyboard?', options: ['Against the computer', 'Two on one keyboard', 'Both'], context: 'one line of why, still in plain words' }), '```',
  `Never ask about the machine. If the machine itself stops you (a refused write, a missing tool, a permission you do not have, a command that cannot run), do not ask and do not pretend it worked. End with exactly one block like this and nothing after it:`,
  '```' + BLOCKED_FENCE, JSON.stringify({ reason: 'one plain sentence for the person waiting', detail: 'the exact technical detail for the owner' }), '```',
].join('\n');

const done = (job) => [
  `## When you are finished`,
  `Make sure everything is committed and the tests pass, then end your reply with exactly one block like this and nothing after it. This is the shift report the owner reads; write it for a person, not a log:`,
  '```' + DONE_FENCE, JSON.stringify({ summary: 'what exists now, in three plain lines', whatChanged: ['one line per real change'], howToOpen: 'the command to run it, or the file to open', next: ['what you would do next, if asked'], notes: 'risks, leftovers, what you decided alone', branch: job.branch, screenshots: ['docs/screens/…'] }), '```',
].join('\n');

export function coordinatorPrompt(job, { resumeAnswer = null, followUp = null } = {}) {
  const web = (job.kind || 'web') === 'web';
  if (resumeAnswer) {
    return [`The owner answered your question.`, ``, `Question: ${resumeAnswer.question || '(see above)'}`, `Answer: ${resumeAnswer.answer}`, ``,
      `Continue the job from where you stopped. Same rules: work only inside this directory, commit on the branch you are on, and end with a ${DONE_FENCE} block when finished or a ${ASK_FENCE} block if you need another decision.`].join('\n');
  }
  if (followUp) {
    return [`The owner sent a new message on this project:`, ``, followUp, ``, `## How to take it`,
      `You are resuming the same project and session. Read the current state first (git log, README, ${web ? 'DESIGN.md' : 'INTERFACE.md'}). Size the work: a small change, you make with a "coder" and a "tester"; anything bigger goes through the full pipeline below. ${web ? 'Anything that touches a screen gets the design review again before you report.' : ''}`,
      ``, pipeline(web), ``, `## Rules`, rules(job), ``, asks(), ``, done(job)].join('\n');
  }
  const where = job.project.kind === 'new' ? `This is a brand new project in an empty repository. Create the structure you need.` : `This is an existing project. Read it before changing it. Follow its conventions.`;
  return [
    `You are the coordinator of a small engineering team on the Binas floor. Job: ${job.title}`,
    ``, `## The brief`, job.brief, ``, `## Where you are`, where, ``, `## Rules`, rules(job),
    ``, `## How the team works (Ruflo pipeline)`, pipeline(web),
    ``, `## The bar`, `The owner will open this expecting to be impressed. Generic is a failure. If what you are about to build could be any product, it is not this one yet.`,
    ``, asks(), ``, done(job),
  ].join('\n');
}

/** CLAUDE.md for a brand new project: short, Ruflo-shaped, no copied counts or claims. */
export function newProjectClaudeMd(job) {
  const web = (job.kind || 'web') === 'web';
  return [`# ${job.title}`, ``, `Built on the Binas floor. Source of truth for how to work here.`, ``, `## Rules`, `- Keep files under 500 lines. One idea per file.`, `- Tests next to the code they test. Run them before you say something works.`, `- Commit small, with messages that say why.`, `- Never commit secrets. Configuration comes from the environment.`, `- Input validation at the edges. Clear errors over clever code.`, web ? `- DESIGN.md is law for anything on screen. Its banned list is not negotiable.` : `- INTERFACE.md is law for commands, inputs, outputs and errors.`, ``, `## Layout`, `- \`src/\` code · \`tests/\` tests · \`docs/\` notes · \`scripts/\` tooling`, ``, `## Brief`, job.brief, ``].join('\n');
}

/** Pull the last fenced block of a given name out of the session's final text. */
export function parseFence(text, name) {
  const re = new RegExp('```' + name + '\\s*([\\s\\S]*?)```', 'g');
  let m, last = null; while ((m = re.exec(String(text || ''))) !== null) last = m[1];
  if (!last) return null;
  try { return JSON.parse(last.trim()); } catch { return { raw: last.trim().slice(0, 2000) }; }
}
