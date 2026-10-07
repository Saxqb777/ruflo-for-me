// Turns a job into the prompt a headless Claude Code session runs: the Ruflo pipeline (named subagents
// through the Agent tool), the floor's rules, and two fenced blocks the runner understands:
// a `binas-ask` block parks the job on a question for the owner; a `binas-done` block finishes it.
export const ASK_FENCE = 'binas-ask';
export const DONE_FENCE = 'binas-done';

export function coordinatorPrompt(job, { resumeAnswer = null } = {}) {
  if (resumeAnswer) {
    return [`The owner answered your question.`, ``, `Question: ${resumeAnswer.question || '(see above)'}`, `Answer: ${resumeAnswer.answer}`, ``,
      `Continue the job from where you stopped. Keep the same rules: work only inside this directory, commit on the branch you are on, and end with a ${DONE_FENCE} block when finished or a ${ASK_FENCE} block if you need another decision.`].join('\n');
  }
  const where = job.project.kind === 'new' ? `This is a brand new project in an empty repository. Create the structure you need.` : `This is an existing project. Read it before changing it. Follow its conventions.`;
  return [
    `You are the coordinator of a small engineering team on the Binas floor. Job: ${job.title}`,
    ``, `## The brief`, job.brief, ``, `## Where you are`, where, `Work only inside the current directory. You are on git branch \`${job.branch}\`. Commit as you go with clear messages. Never push, deploy, publish, or spend money: the owner does that after you finish.`,
    ``, `## How the team works (Ruflo pipeline)`,
    `Use the Agent tool to spawn named teammates, in this order, and wait for each before the next: "researcher" (understand the request and the code), "architect" (design and file plan), "coder" (implement), "tester" (write and run tests), "reviewer" (review for bugs and security). Give each a precise task and tell it what to hand back. You integrate their results. Keep files under 500 lines. Prefer tests first for new code.`,
    ``, `## When you need the owner`,
    `If a decision is genuinely the owner's (scope, money, a tradeoff that changes the product, anything outward-facing), stop and end your reply with exactly one block like this and nothing after it:`,
    '```' + ASK_FENCE, JSON.stringify({ question: 'one clear question', options: ['option A', 'option B'], context: 'one line of why' }), '```',
    `Do not ask about things you can decide yourself. Make routine calls and note them.`,
    ``, `## When you are finished`,
    `Make sure everything is committed, then end your reply with exactly one block like this and nothing after it:`,
    '```' + DONE_FENCE, JSON.stringify({ summary: 'what was built, in three lines', branch: job.branch, howToRun: 'the command to run or test it', notes: 'risks, leftovers, what you decided alone' }), '```',
  ].join('\n');
}

/** CLAUDE.md for a brand new project: short, Ruflo-shaped, no copied counts or claims. */
export function newProjectClaudeMd(job) {
  return [`# ${job.title}`, ``, `Built on the Binas floor. Source of truth for how to work here.`, ``, `## Rules`, `- Keep files under 500 lines. One idea per file.`, `- Tests next to the code they test. Run them before you say something works.`, `- Commit small, with messages that say why.`, `- Never commit secrets. Configuration comes from the environment.`, `- Input validation at the edges. Clear errors over clever code.`, ``, `## Layout`, `- \`src/\` code · \`tests/\` tests · \`docs/\` notes · \`scripts/\` tooling`, ``, `## Brief`, job.brief, ``].join('\n');
}

/** Pull the last fenced block of a given name out of the session's final text. */
export function parseFence(text, name) {
  const re = new RegExp('```' + name + '\\s*([\\s\\S]*?)```', 'g');
  let m, last = null; while ((m = re.exec(String(text || ''))) !== null) last = m[1];
  if (!last) return null;
  try { return JSON.parse(last.trim()); } catch { return { raw: last.trim().slice(0, 2000) }; }
}
