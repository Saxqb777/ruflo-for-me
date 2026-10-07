// Ruflo mission log -> Binas events. Reads .claude-flow/missions/<msn_…>/events.jsonl (ADR-406: append-only,
// hash-chained, torn tail ignored) and maps the mission's control and observation events onto the floor.
// A mission is a paper; its executor is the agent that holds it. Unknown event types are ignored.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MISSIONS_DIR = join('.claude-flow', 'missions');
const MISSION_ID = /^msn_[a-f0-9]{24}$/;
const short = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function who(me) {
  const p = me.payload || {};
  const id = p.executorId || p.executor || p.agentId || p.agent || (me.channel === 'executor' ? 'executor' : me.principalId) || 'executor';
  return { agent: String(id).slice(0, 48), role: me.channel === 'executor' ? 'worker' : 'coordinator' };
}
function title(me) { const p = me.payload || {}; return short(p.title || p.goal || p.summary || p.description || me.missionId, 90); }

/** Map one MissionEvent (already parsed) to zero or more Binas events. */
export function mapMissionEvent(me) {
  if (!me || typeof me !== 'object' || !me.type || !me.missionId) return [];
  const t = Date.parse(me.at); if (!Number.isFinite(t)) return [];
  const paper = String(me.missionId).slice(0, 64); const w = who(me); const src = 'missions';
  const p = me.payload || {};
  switch (me.type) {
    case 'mission.created': return [{ t, kind: 'arrive', paper, text: title(me), source: src }];
    case 'plan.validated': case 'plan.revised': return [{ t, kind: 'start', agent: 'main', role: 'coordinator', paper, text: me.type === 'plan.validated' ? 'plan validated' : 'plan revised', source: src }];
    case 'admission.accepted': case 'executor.acknowledged': return [{ t, kind: 'handoff', agent: 'main', role: 'coordinator', to: w.agent, toRole: 'worker', paper, text: me.type === 'admission.accepted' ? 'admitted' : 'acknowledged', source: src }];
    case 'task.observed': case 'executor.observed': return [{ t, kind: 'start', agent: w.agent, role: w.role, paper, text: short(p.summary || p.taskId || p.state || 'working', 90), source: src }];
    case 'evidence.recorded': return [{ t, kind: 'start', agent: w.agent, role: w.role, paper, text: `evidence · ${short(p.kind || p.summary || 'recorded', 70)}`, source: src }];
    case 'authorization.missing': return [{ t, kind: 'block', agent: w.agent, role: w.role, paper, text: short(p.reason || 'authorization missing', 90), source: src }];
    case 'blocked': return [{ t, kind: 'block', agent: w.agent, role: w.role, paper, text: short(p.reason || p.summary || 'blocked', 90), source: src }];
    case 'resume.admitted': return [{ t, kind: 'unblock', agent: w.agent, text: 'resumed', source: src }];
    case 'pause.accepted': case 'quiescence.confirmed': return [{ t, kind: 'done', agent: w.agent, role: w.role, paper, text: 'paused', source: src }];
    case 'tasks.settled': case 'acceptance.passed': return [{ t, kind: 'done', agent: w.agent, role: w.role, paper, text: me.type === 'acceptance.passed' ? 'acceptance passed' : 'tasks settled', source: src }];
    case 'acceptance.failed': case 'failure.verified': return [{ t, kind: 'fail', agent: w.agent, role: w.role, paper, text: short(p.reason || me.type, 90), source: src }];
    case 'cancel.admitted': case 'cancel.settled': return [{ t, kind: 'fail', agent: w.agent, role: w.role, paper, text: 'cancelled', source: src }];
    default: return [];
  }
}

export function parseMissionLog(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { out.push(...mapMissionEvent(JSON.parse(s))); } catch { /* torn tail or junk */ }
  }
  return out;
}

/** All mission events under root, mapped and sorted by time. */
export function readMissions(root) {
  const dir = join(root, MISSIONS_DIR); if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!MISSION_ID.test(name)) continue;
    const f = join(dir, name, 'events.jsonl'); if (!existsSync(f)) continue;
    try { out.push(...parseMissionLog(readFileSync(f, 'utf8'))); } catch { /* skip */ }
  }
  return out.sort((a, b) => a.t - b.t);
}
