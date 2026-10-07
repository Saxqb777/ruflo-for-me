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

## Open

- Sound design beyond the synthesized set.
- Whether customer-facing Binas is a paid tier of Doc Ledger or included.
- Offline bundle of three.js (currently cdnjs).
- The finance-floor room layout for docledger (Mailroom, Reading desk, Review desk, Ledger, Treasury, Archive, Dispatch).

## Before any paying customer (docledger, not Binas)

- Receipts are uploaded to Vercel Blob with public access. Make them private with signed reads.
- Blobs are never deleted when an expense is deleted.
- No rate limiting; no lockfile committed; page-only totals in the Records header and Savings footer.
