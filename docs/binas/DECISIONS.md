# Binas — decisions log

One line per decision, newest at the bottom. The next session reads this first.

| Date | Decision | Why |
|---|---|---|
| 2026-10-07 | Name is **Binas**. Wordmark BINAS. | Owner's call. Pairs with the Tower (Doc Ledger's sales floor). |
| 2026-10-07 | Work from `Saxqb777/Petty-Cash-` (doc-ledger v2.0, Express + React + Neon + Blob + Paddle). `Saxqb777/docledger` (Next.js prototype) is retired. | v2 has billing, demo site, landing page, multi-tenant, the Overprint design system. |
| 2026-10-07 | Ruflo is the engine that builds and sells Doc Ledger, not a runtime dependency of it. No repo merge. | Ruflo is 153 MB, 25 packages, its own release train. Doc Ledger stays small. |
| 2026-10-07 | One renderer, two feeds: dev agents first (Ruflo and Claude Code hooks), customers' finance office second (docledger server events). | Same picture for the owner, for customers, and as the sales demo. |
| 2026-10-07 | Binas lives at `plugins/ruflo-binas/` as its own zero-dependency package. docledger will vendor `web/` + a built `dist/`. Own repo later if it earns one. | Ships as a Ruflo plugin today; the only repo this session can push to; nothing in the layout blocks extraction. |
| 2026-10-07 | Visual direction: a living architectural model in 3D (three.js), not a flat plan. Cutaway office on its own blueprint, moving daylight, pneumatic tubes, desk lamps, flags, stamp blocks, belt + roller door, split-flap board, opt-in synthesized sound. | The flat plan read as "basic". The model reads as a physical object nobody else ships. Still Overprint: paper, one ink, three spot inks, zero radius, no glow. |
| 2026-10-07 | Honesty rule: every mark on the floor is a real event. No decorative busy-work. Title block names the source (DEMO · RECORDED, LIVE · HOOKS + MISSIONS, FILE · REPLAY). | Same ethic as the Ruflo console: anything not measured reads n/a. |
| 2026-10-07 | Event contract v0.1 adds `join` and `leave` to the nine kinds in the brief. Desks are assigned by role on first sight; a full room overflows to the Build floor. | Live sessions spawn agents dynamically; the floor cannot assume a roster. |
| 2026-10-07 | Live feed = Claude Code command hooks writing `.claude-flow/binas/events.jsonl`, plus a reader for Ruflo mission logs. Hook never blocks a tool: no stdout, every error swallowed, exit 0. | Hooks are the richest honest signal of agents working. Mission logs are Ruflo's durable truth. |
| 2026-10-07 | A `git push`, `gh pr create` or `npm publish` is a shipment. | The one moment work actually leaves the building. |
| 2026-10-07 | Motion exception to Overprint's 120 ms rule: travel is slow and linear; state changes are stepped (flaps, stamps, flags). Never a spring. | Mechanical reads as a model; bouncy reads as a game. |
| 2026-10-07 | Pegs do not walk in 0.1.0. Paper moves, people sit. | Half the animation code, no loss of legibility; walking is a later milestone if wanted. |
| 2026-10-07 | Cloud Binas = Vercel static page + three functions in `api/` + one Neon table `binas_events`, keyed by `floor`. Reads and writes need `BINAS_KEY`; no key configured means nobody gets in. Neon is reached over its HTTP SQL endpoint with no dependency. | Serverless cannot tail a file or hold an SSE connection; a table with an id cursor and 2 s polling is the honest equivalent. Fail closed because the feed names files, tools and prompts. |
| 2026-10-07 | Vercel project `binas` in team saxqb777's projects, root `plugins/ruflo-binas`, deployed from this branch. Neon not yet attached: the Neon connector was not authorized in the session that built this. | Owner asked to run it on Vercel + Neon; the page ships now in demo mode and lights up live when `DATABASE_URL` is set. |

| 2026-10-07 | **Pivot: Binas is the factory, not a window.** Doc Ledger is out of scope; it stays deployed, untouched, and can be fed to the factory as any other project. | Owner's call: "the ultimate factory to build things on a project basis". |
| 2026-10-07 | The factory has two halves. Showroom on Vercel + Neon (floor, job board, chat, users). Workshop on a machine with a Claude login (the runner). Vercel cannot run Claude Code. | Serverless functions stop after seconds; Claude Code runs for minutes to hours and needs a login. |
| 2026-10-07 | Fuel is the owner's Claude plan, not an API key. The runner strips `ANTHROPIC_API_KEY` from job sessions unless a job says `billing: "api"`. | Owner's call. Flagged once: serving other people on one subscription is personal use for two testers, not for a user base; the fuel line is swappable to API billing per floor with no other change. |
| 2026-10-07 | Users: owner plus two testers for now, username + password, one floor each. Owner unlimited and sees every floor (Building view). Testers get a monthly allowance; a turn sized over it parks in the owner's Approvals tray. | Owner's inputs. Later a business where users pay to build. |
| 2026-10-07 | Results live under the owner's accounts: one private GitHub repo per project, one Vercel project per web project, one Neon database per project that needs one. Users download a zip or get added as collaborators; "take it home" to their own accounts later. | Testers have no install and no accounts of their own; the owner's accounts are the only place things can land today. |
| 2026-10-07 | Projects are conversations, not one-shot prompts. The first message creates the repo; every later message is a turn on the same session and branch. Small turn = coder only; big turn = full pipeline. | Owner: "not one prompt build, they can add live changes like how I do with you". |
| 2026-10-07 | No slop is a pipeline stage, not a hope: a designer role for anything with a screen, a written design system per project at intake with a banned list, a visual review on screenshots before a preview goes live, tests must pass. | Owner: "users should be impressed". |
| 2026-10-07 | Before any tester gets a login, each turn runs in a container with no owner tokens inside; the host does push and deploy afterwards. | Strangers' prompts on the owner's machine with the owner's tokens is the one unacceptable risk. |
| 2026-10-07 | Workshop v1 shipped: job store, pipeline prompt with `binas-ask` / `binas-done` fences, runner (worktree, headless session, ask, answer, resume, ship), local job board on the page and the CLI. Cloud job board, users, allowances, intake chat and Building view wait on Neon. | Neon connector still unauthorized; Doc Ledger's connection string on Vercel is a sealed secret no API can read. |

| 2026-10-07 | Neon attached: project `binas` (`little-brook-04386070`, aws-us-east-1, Postgres 17), database `binas`, role `binas`, table `binas_events`. The connection string lives only in the Vercel project `binas` as a sealed `DATABASE_URL`. | Same AWS region as the Vercel functions (iad1). The owner re-authorized the Neon connector mid-session and its tools appeared. |
| 2026-10-07 | Doc Ledger scrubbed from Binas: title block and eyebrow read BINAS WORKS, the demo shift builds neutral papers (payments webhook, private uploads, dashboard totals), plugin keyword `docledger` dropped, the brief rewritten for the factory. Doc Ledger's own pre-customer list (public receipt blobs, blobs never deleted, no rate limit) belongs with Doc Ledger, not here. | Owner: "why is docledger in topic" → "Scrub". |

## Open

- Sound design beyond the synthesized set.
- Offline bundle of three.js (currently cdnjs).
- Pegs walking between desks (paper moves, people sit, for now).
- Per-floor API billing for paying users; "take it home" export to a user's own accounts.
