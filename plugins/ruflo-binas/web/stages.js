// The round as eight plain-word stops, for people who have never coded. Derived only from real events:
// who started, who finished, and whether it shipped. Pure: given the engine, a project root and a time.
export const STAGES = [
  { id: 'understand', label: 'Understanding your idea', doing: 'reading your idea' },
  { id: 'design', label: 'Designing the look', doing: 'choosing colours, type and layout' },
  { id: 'plan', label: 'Planning the pieces', doing: 'planning how it fits together' },
  { id: 'build', label: 'Building', doing: 'writing it' },
  { id: 'test', label: 'Testing', doing: 'trying everything out' },
  { id: 'look', label: 'Checking the look', doing: 'checking how it looks on a phone and a laptop' },
  { id: 'review', label: 'Final review', doing: 'looking for problems' },
  { id: 'live', label: 'Going live', doing: 'putting it online' },
];

/** Which stop a role belongs to, or -1. Order matters: a design review is a look check, not design. */
export function stageOf(role) {
  const r = String(role || '').toLowerCase();
  if (/design.?review|visual|look|screenshot/.test(r)) return 5;
  if (/review|secur|audit/.test(r)) return 6;
  if (/research|analy|scout|explor|understand/.test(r)) return 0;
  if (/design|ux|ui\b/.test(r)) return 1;
  if (/architect|plan|spec/.test(r)) return 2;
  if (/test|qa\b|valid/.test(r)) return 4;
  if (/release|deploy|ship|publish/.test(r)) return 7;
  if (/cod|build|implement|develop|engineer|frontend|backend|program/.test(r)) return 3;
  return -1;
}

/** { stages: [{ ...STAGES[i], state }], current, roundStart } — state is todo | active | done | skipped | retry. */
export function stagesFor(engine, root, now) {
  const st = STAGES.map((s) => ({ ...s, state: 'todo' }));
  if (!root) return { stages: st, current: -1, roundStart: null };
  let t0 = -Infinity;
  for (const x of engine.trail) if (x.t <= now && x.k === 'arrive' && x.a === root && x.t > t0) t0 = x.t;
  const working = new Set();
  for (const x of [...engine.trail].filter((y) => y.t <= now && y.t >= t0).sort((a, b) => a.t - b.t)) {
    if (x.a === root) {
      if (x.k === 'ship') st[7].state = 'done';
      else if (x.k === 'done' && st[7].state !== 'done') st[7].state = 'active';
      continue;
    }
    if (engine.rootOf(x.a) !== root) continue;
    if (x.k === 'ship') { st[7].state = 'done'; continue; }
    const i = stageOf(x.role); if (i < 0) continue;
    if (x.k === 'start') { working.add(x.a); if (st[i].state !== 'done') st[i].state = 'active'; }
    if (x.k === 'done') { working.delete(x.a); st[i].state = 'done'; }
    if (x.k === 'fail') { working.delete(x.a); st[i].state = 'retry'; }
  }
  let last = -1; st.forEach((s, i) => { if (s.state !== 'todo') last = i; });
  st.forEach((s, i) => { if (s.state === 'todo' && i < last) s.state = 'skipped'; });
  let current = -1; st.forEach((s, i) => { if (s.state === 'active' || s.state === 'retry') current = i; });
  return { stages: st, current, roundStart: Number.isFinite(t0) ? t0 : null };
}

/** A plain phrase for what a worker is doing, never a shell command or a path. */
export function plainDoing(role, text) {
  const t = String(text || '');
  const w = /^(write|edit|multiedit|built) (\S+)/i.exec(t); if (w) return `writing ${w[2].split('/').pop()}`;
  const r = /^reading (\S+)/i.exec(t); if (r) return `reading ${r[1].split('/').pop()}`;
  if (/\b(npm|npx|pnpm|node) (run )?test|vitest|jest|playwright/i.test(t)) return 'running the tests';
  if (/git commit/i.test(t)) return 'saving the work';
  const i = stageOf(role); if (i >= 0) return STAGES[i].doing;
  if (/coordinat/i.test(String(role))) return 'coordinating the team';
  return /[/|&;$]|^\w+ -/.test(t) || !t || t === '—' ? 'working' : t.slice(0, 70);
}
