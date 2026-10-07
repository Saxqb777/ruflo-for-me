# ruflo-binas

Binas is the office floor as a living architectural model. A 3D cutaway office sits on its own blueprint. Your Claude Code session is the coordinator at the mailroom desk. Every subagent gets a desk by role. Paper moves between desks by pneumatic tube. A lamp lights when someone works, a flag rises when someone needs you, a stamp lands when work is done, shipments leave on a belt through the dock door, and the feed is a split-flap departures board. Everything on the floor is a real event. Anything not measured reads n/a.

Design notes and decisions: [`docs/binas/`](../../docs/binas/).

## Run it

```bash
# inside this plugin directory, or point --root at a project
node bin/binas.mjs demo --open          # the recorded demo shift
node bin/binas.mjs serve --open         # the live floor for the project in the current directory
node bin/binas.mjs tail                 # print events as they are appended
node bin/binas.mjs emit '{"kind":"start","agent":"me","role":"coordinator","text":"hello"}'
```

The server binds `127.0.0.1:4777` (`--port`), serves `web/` and `demo/`, and streams `/events` as server-sent events. The page loads three.js from cdnjs and the two fonts from Google Fonts, so the browser needs network for those; the feed itself never leaves the machine.

## Where the live feed comes from

Load the plugin and every hook appends one line to `.claude-flow/binas/events.jsonl`:

```bash
claude --plugin-dir plugins/ruflo-binas
```

| Claude Code hook | On the floor |
|---|---|
| `SessionStart` | the coordinator (`ME`) sits down in the Mailroom |
| `UserPromptSubmit` | a paper arrives through the IN chute and lands on the coordinator's tray |
| `PreToolUse` for `Agent` | a subagent joins at a desk for its role and the paper shoots to it by tube |
| `PostToolUse` for `Agent` | the subagent's done (or fail) stamp lands and the paper tubes back |
| other tool calls | the coordinator's lamp is on, with the tool as the task line |
| `Notification` asking for permission | the flag goes up until the next tool runs |
| `Bash` with `git push`, `gh pr create`, `npm publish` | a shipment rides the belt out through the dock door and is filed in Records |
| `Stop`, `SessionEnd` | done stamp, lamps off, pegs leave |

The server also reads Ruflo mission logs (`.claude-flow/missions/*/events.jsonl`, ADR-406) and maps `mission.created`, `blocked`, `acceptance.passed`, `failure.verified` and friends onto the same floor. See `src/adapters/`.

The hook never blocks a tool. It prints nothing to stdout, swallows every error, and exits 0. Set `BINAS_DEBUG=1` to see errors on stderr.

## Event contract v0.1

One JSON object per line. `t` and `kind` are required.

```json
{"t":"2026-10-07T09:31:07.000Z","kind":"handoff","agent":"AR","role":"architect","to":"C1","toRole":"coder","paper":"P2","text":"blob access plan","source":"demo"}
```

| kind | meaning |
|---|---|
| `join` / `leave` | an agent takes or leaves a desk (`agent`, `role`, `name`) |
| `arrive` | a paper enters through the chute (`paper`, `text`, optional `to`) |
| `claim` / `handoff` | a paper goes by tube from `agent` to `to` |
| `start` | `agent` works on `paper` (`text` is the task line) |
| `block` / `unblock` | `agent` needs a yes; the flag goes up and down |
| `done` / `fail` | a stamp lands on `agent`'s desk |
| `ship` | `agent` sends `paper` out through the dock |

Strings are trimmed, stripped of control characters and capped. Unknown kinds and bad lines are skipped, never fatal. The engine assigns desks by role: coordinator → Mailroom, research → Research, architect/planner → Drafting, tester → Test lab, reviewer/security → Review, release/deploy → Dock, everyone else → Build floor. A full room overflows to the Build floor.

## Run it in the cloud (Vercel + Neon)

The same page deploys to Vercel with three functions in `api/` and a Neon Postgres table behind them. No dependencies: `src/cloud/neon.mjs` speaks Neon's HTTP SQL endpoint directly.

| Piece | What it does |
|---|---|
| `GET /api/events?floor=default&after=<id>` | the feed after a cursor, oldest first. Needs `x-binas-key`. |
| `POST /api/ingest?floor=default` | accepts one event, an array, or JSON lines. Needs `x-binas-key`. Normalizes before insert. |
| `GET /api/info` | is a key set, is a database connected, how many events. Never a secret. |

Project settings: root directory `plugins/ruflo-binas`, build `node scripts/build-cloud.mjs`, output `dist-cloud` (already in `vercel.json`). Environment variables:

| Variable | Purpose |
|---|---|
| `BINAS_KEY` | the floor key. Without it every live read and write is refused. The page asks for it once and keeps it in that browser only. |
| `DATABASE_URL` | a Neon connection string. Without it the API answers 503 and the demo still works. |

Send your local hooks to the cloud floor too:

```bash
export BINAS_INGEST_URL=https://<your-deployment>/api/ingest
export BINAS_KEY=<the floor key>
claude --plugin-dir plugins/ruflo-binas
```

The hook still writes the local log first; the cloud copy is capped at 1.5 s and never blocks a tool. A `?floor=<name>` on the page and on the ingest URL keeps separate floors apart in one table.

## The workshop (the factory)

Binas builds things, not just shows them. A job is a paper on the floor: you describe what to build, the workshop runs one headless Claude Code session per turn with the Ruflo pipeline, parks when the coordinator needs a decision, resumes with your answer, and ships.

```bash
node bin/binas.mjs job add --title "Barber booking" --brief "A booking page with time slots for a barber shop. Done means a customer can pick a slot and get a confirmation." --ship pr --budget 5
node bin/binas.mjs run            # the workshop: builds queued jobs, one at a time, with the Claude login on this machine
node bin/binas.mjs jobs           # states, questions, links
node bin/binas.mjs answer <jobId> "yes, dark mode by default"
```

Or do all of it from the Factory panel on the local floor (`binas serve`): the form queues jobs, cards show state, cost and links, and a question shows its options as buttons.

| Setting | Default | What it means |
|---|---|---|
| fuel | the `claude` login on the machine | the API key is stripped from job sessions; set `billing: "api"` on a job to allow it |
| autonomy | `ask` | edits auto-accepted, a fixed tool allowlist, no `git push`; `full` skips permissions (only in a container) |
| sandbox | `none` | `--sandbox docker` runs each turn in a container that sees only the work dir, `~/.claude` and the plugin (untested here, no Docker in the build session) |
| budget | $5 per turn | `--max-budget-usd` on the session |
| ship | `pr` | commit leftovers, push the branch, open a pull request with `gh`; `branch` pushes only; `none` keeps it local. No remote means branch only, said so in the log |
| project | new | a fresh repo under `projects/<slug>` with a CLAUDE.md; `--project <path>` works in a git worktree on branch `binas/<jobId>` |

The coordinator prompt ends a turn with a fenced `binas-ask` block to ask you something, or a `binas-done` block with a summary and how to run it. Both are parsed by the runner; anything else is treated as done with a note.

## Replay

Drop any `.jsonl` of events onto the floor to replay it. The scrubber, arrow keys and speeds work on live feeds too: drag back to review, press Back to live to catch up.

## Layout

```
bin/binas.mjs                 CLI: serve, demo, tail, emit
src/events.mjs                contract: normalize, parse, write
src/log.mjs                   append-only log, rotation, follow
src/adapters/claude-hooks.mjs hook payload -> events (pure)
src/adapters/missions.mjs     Ruflo mission log -> events (pure + reader)
src/server.mjs                loopback http + SSE
web/engine.js                 the fold: events -> world at any instant (pure; shared with tests)
web/scene.js                  the model, in three.js
web/board.js                  split-flap cells and synthesized sound
web/app.js                    sources, time, controls
demo/shift-014.jsonl          the recorded demo shift (scripts/make-demo-shift.mjs)
```

Zero dependencies. `npm test` runs `node --test tests/*.test.mjs`. `scripts/smoke.sh` is the structural contract CI runs.

## Known limits (0.1.0)

- Pegs do not walk; paper moves, people stay seated. Agents beyond the desks on the floor share a desk.
- The hook adapter names subagents from the `Agent` tool input; a subagent spawned any other way shows up only when `SubagentStop` can pair it.
- Three.js comes from a CDN; there is no offline bundle yet.
- Sound is synthesized and off by default.
