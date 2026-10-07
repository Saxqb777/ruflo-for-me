# Binas — brief v1 (2026-10-07)

## What it is
- A factory for building software on a project basis. You describe what you want; a Ruflo pipeline of Claude Code agents builds it; you watch them work on a 3D office floor; you keep talking to the project until it is right.
- Two halves. The **showroom** on Vercel + Neon: login, your floor, your projects, the conversation, approvals. The **workshop** on a machine with a Claude login: the runner that actually builds, pushes and deploys.

## Who uses it
1. The owner. Main floor, no limits, sees every floor (the Building view), gets the approvals tray.
2. Two testers for now. One floor each, a monthly allowance, their own login. A turn sized over the allowance parks in the owner's tray.
3. Later: paying users. Same floors, API billing per floor instead of the owner's plan.

## Where it lives
- `plugins/ruflo-binas/` in `ruflo-for-me`. Zero dependencies. Static page + `api/` functions on Vercel, tables on Neon, runner on the owner's machine.
- Results land in the owner's accounts: one private repo per project, a Vercel preview per web project, a Neon database when a project needs one.

## How a project goes
- First message creates the project: repo, branch, a written design system (`DESIGN.md`) with a banned list for anything with a screen.
- Every later message is a turn on the same Claude session and branch. Small turn = coder only. Big turn = research → architecture → code → test → review.
- The pipeline may stop and ask; the answer resumes it. Every turn ends with a shift report: what changed, how to open it, what is next.
- Nothing with a screen goes live before a visual review against `DESIGN.md`.

## Event contract v0.1 (one JSON object per line)
- kinds: `join` `leave` `arrive` `claim` `start` `handoff` `block` `unblock` `done` `fail` `ship`
- `t` and `kind` are required. `agent` is a stable id. Everything else is optional.
- Fed by Claude Code hooks and Ruflo mission logs. Any shift can be replayed.

## Non-negotiables
- Every mark on screen is a real event. No decorative busy-work. Anything not measured reads `n/a`.
- Overprint rules hold: zero radius, no shadow, flat inks, Archivo + Fragment Mono. Travel is slow and linear, state changes are stepped. Never a spring.
- No slop is a pipeline stage: designer role, written design system, visual review, tests must pass.
- Strangers' prompts never run on the owner's machine with the owner's tokens in reach: each turn runs in a container; the host pushes and deploys afterwards.
- No secrets in the repo, ever. The API key is stripped from job sessions.

## Milestones
- M0  Moving mock, then the 3D living-model direction. Done.
- M1  Renderer, hooks + missions adapters, replay. Done (`plugins/ruflo-binas` 0.1.0).
- M2  Cloud floor on Vercel + Neon. Done.
- M3  Workshop: jobs, runner, asks, answers, ship. Done locally.
- M4  Showroom: users, floors, Building view, allowances + approvals, cloud job board, intake chat, designer stage, shift report, preview deploys. In progress.
- M5  "Take it home": move a project to the user's own GitHub/Vercel/Neon. Billing per floor.
