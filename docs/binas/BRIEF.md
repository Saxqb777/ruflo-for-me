# Binas — brief v0 (2026-10-07)

## What it is
- A top-down office floor where AI agents work, drawn as a plotter-printed architect's plan in Doc Ledger's Overprint system.
- One renderer. Two feeds. Same picture for you, for customers, and for prospects.

## Who sees it, in order
1. You. Ruflo dev agents building Doc Ledger. Feed exists today.
2. Doc Ledger customers. Their finance back office at work. Feed to be added to the docledger server.
3. Prospects. The hero of the sales page and the live demo. Replays a recorded shift.

## Where it lives
- `plugins/ruflo-binas/` in `ruflo-for-me`. Own `package.json`, Vite, zero imports from Ruflo internals.
- docledger vendors the built `dist/` and mounts it at `/office`.
- If Binas grows its own audience it moves to its own repo after milestone 2. Nothing in the layout blocks that.

## Event contract v0 (one JSON object per line)
```
{ "t": "2026-10-07T09:31:07Z", "kind": "start", "agent": "C1", "role": "coder",
  "paper": "P2", "from": "AR", "to": "C1", "text": "private blobs + signed reads",
  "needs": null, "verdict": null }
```
- kinds: `join` `leave` `arrive` `claim` `start` `handoff` `block` `unblock` `done` `fail` `ship`
- `t` is required. `agent` is a stable id. Everything else is optional.
- v0.1 adds `join` and `leave` (2026-10-07): live sessions spawn agents dynamically, so the floor assigns desks by role on first sight.
- Two adapters emit it:
  - ruflo: tails `.claude-flow/missions/*/events.jsonl` and the hook-handler pre/post events.
  - docledger: server-sent events for `upload` `extracted` `needs_review` `saved` `duplicate` `exported`.

## Two floor layouts, same renderer
- Engineering floor: Mailroom, Research, Drafting, Build Floor, Test Lab, Review, Release Dock, Records.
- Finance floor: Mailroom, Reading Desk, Review Desk, Ledger, Treasury, Archive, Dispatch.

## Non-negotiables
- Every mark on screen is a real event. No decorative busy-work. Idle is uncoloured.
- Anything not measured reads `n/a`, same ethic as the Ruflo console.
- Overprint rules hold: zero radius, no shadow, flat inks, multiply where inks cross, Archivo + Fragment Mono, measured contrast steps.
- One deliberate exception to the 120 ms motion rule: travel is slow, linear, and stepped on a 4 px grid. Mechanical, never bouncy.
- Replay is first-class. Logs are append-only, so any shift can be scrubbed and replayed.

## Milestones
- M0  Moving mock. Done 2026-10-07: first a flat plan, then the 3D living-model direction (see DECISIONS.md).
- M1  Renderer package, hooks + missions adapters, replay scrubber, keyboard and reduced-motion support. Landed as `plugins/ruflo-binas` 0.1.0.
- M2  docledger adapter and `/office` route. Fix public blobs and missing deletes first.
- M3  Sales page hero plus a recorded demo shift that plays on docledger.site.
- M4  Finance floor layout, opt-in sound, agent detail cards with typed-out task lines.

## Open
- Sound design.
- Whether customer-facing Binas is a paid tier or included.
