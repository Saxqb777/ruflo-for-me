// Claude Code hook payload -> Binas events. Pure: mapHook(payload, state, nowMs) returns { events, state }.
// The main session is the coordinator at the mailroom desk. Every Agent tool call is a subagent that gets a
// desk by role, a paper by tube, and a done stamp when its result comes back. A git push is a shipment.
import { basename } from 'node:path';

const SHIP_RE = /\bgit\s+push\b|\bgh\s+pr\s+create\b|\bnpm\s+publish\b|\bvercel\b.*\b(--prod|deploy)\b|\bpnpm\s+publish\b/;
const PERMISSION_RE = /permission|approve|allow|waiting for your input|needs your/i;
const short = (s, n = 72) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function emptyState(sessionId) {
  const sid = String(sessionId || 'solo').replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase() || 'solo';
  return { v: 1, sid, main: `me-${sid}`, n: 0, paper: null, subs: {}, subN: 0, blocked: false, mainWorking: false, lastStart: 0, joined: false };
}

export function describeTool(name, input = {}) {
  const f = input.file_path || input.path || input.notebook_path;
  switch (name) {
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return `${name.toLowerCase()} ${f ? basename(String(f)) : 'a file'}`;
    case 'Read': return `reading ${f ? basename(String(f)) : 'a file'}`;
    case 'Grep': case 'Glob': return `searching ${short(input.pattern, 40)}`;
    case 'Bash': return short(input.description || input.command, 70);
    case 'WebFetch': return `fetching ${short(input.url, 50)}`;
    case 'WebSearch': return `searching the web · ${short(input.query, 40)}`;
    case 'Agent': case 'Task': return `spawning ${input.subagent_type || 'an agent'}`;
    default: return short(name, 40);
  }
}

function joinMain(state, now, events) {
  if (state.joined) return;
  state.joined = true; events.push({ t: now, kind: 'join', agent: state.main, role: 'coordinator', name: 'ME', source: 'claude-hooks' });
}
function unblock(state, now, events, text) {
  if (!state.blocked) return;
  state.blocked = false; events.push({ t: now, kind: 'unblock', agent: state.main, text: text || 'yes', source: 'claude-hooks' });
}
function startMain(state, now, events, text, force) {
  if (!force && state.mainWorking && now - state.lastStart < 2000) return;
  state.mainWorking = true; state.lastStart = now;
  events.push({ t: now, kind: 'start', agent: state.main, role: 'coordinator', paper: state.paper || undefined, text, source: 'claude-hooks' });
}

/** Map one hook payload. `state` is this session's small correlation record; it is returned updated. */
export function mapHook(payload, state, nowMs = Date.now()) {
  const events = [];
  const p = payload && typeof payload === 'object' ? payload : {};
  state = state && state.v === 1 ? state : emptyState(p.session_id);
  const ev = String(p.hook_event_name || '');
  const tool = String(p.tool_name || '');
  const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  const isAgentTool = tool === 'Agent' || tool === 'Task';

  switch (ev) {
    case 'SessionStart': joinMain(state, nowMs, events); break;

    case 'UserPromptSubmit': {
      joinMain(state, nowMs, events); unblock(state, nowMs, events, 'you replied');
      state.n += 1; state.paper = `p${state.sid}-${state.n}`;
      events.push({ t: nowMs, kind: 'arrive', paper: state.paper, to: state.main, text: short(p.prompt, 90), source: 'claude-hooks' });
      startMain(state, nowMs + 1, events, 'reading the request', true);
      break;
    }

    case 'PreToolUse': {
      joinMain(state, nowMs, events); unblock(state, nowMs, events, 'approved');
      if (isAgentTool) {
        state.subN += 1;
        const base = String(input.name || input.subagent_type || 'agent').replace(/[^a-z0-9_-]/gi, '').slice(0, 24).toLowerCase() || 'agent';
        const id = `${base}.${state.sid}.${state.subN}`; const role = String(input.subagent_type || base);
        const paper = `${state.paper || 'p' + state.sid}.${state.subN}`; const text = short(input.description || input.prompt, 90);
        const key = String(p.tool_use_id || `${base}-${state.subN}`); state.subs[key] = { id, paper, role, t: nowMs };
        events.push({ t: nowMs, kind: 'join', agent: id, role, name: base, source: 'claude-hooks' });
        events.push({ t: nowMs + 1, kind: 'handoff', agent: state.main, role: 'coordinator', to: id, toRole: role, paper, text, source: 'claude-hooks' });
        events.push({ t: nowMs + 2, kind: 'start', agent: id, role, paper, text, source: 'claude-hooks' });
      } else startMain(state, nowMs, events, describeTool(tool, input));
      break;
    }

    case 'PostToolUse': {
      unblock(state, nowMs, events, 'approved');
      const resp = p.tool_response; const failed = !!(resp && typeof resp === 'object' && (resp.is_error || resp.error));
      if (isAgentTool) {
        const key = String(p.tool_use_id || ''); const sub = state.subs[key] || Object.values(state.subs).sort((a, b) => a.t - b.t)[0];
        if (sub) {
          delete state.subs[Object.keys(state.subs).find((k) => state.subs[k] === sub)];
          events.push({ t: nowMs, kind: failed ? 'fail' : 'done', agent: sub.id, role: sub.role, paper: sub.paper, source: 'claude-hooks' });
          events.push({ t: nowMs + 1, kind: 'handoff', agent: sub.id, role: sub.role, to: state.main, toRole: 'coordinator', paper: sub.paper, text: failed ? 'came back with an error' : 'result', source: 'claude-hooks' });
          events.push({ t: nowMs + 2, kind: 'leave', agent: sub.id, source: 'claude-hooks' });
        }
      } else if (tool === 'Bash' && !failed && SHIP_RE.test(String(input.command || ''))) {
        events.push({ t: nowMs, kind: 'ship', agent: state.main, role: 'coordinator', paper: state.paper || undefined, text: short(input.description || input.command, 60), source: 'claude-hooks' });
        state.n += 1; state.paper = `p${state.sid}-${state.n}`; // the next work is a new paper
      }
      break;
    }

    case 'Notification': {
      const kind = String(p.notification_type || p.type || ''); const msg = String(p.message || p.title || '');
      if (!state.blocked && (kind === 'permission_prompt' || kind === 'idle_prompt' || PERMISSION_RE.test(msg))) {
        state.blocked = true; events.push({ t: nowMs, kind: 'block', agent: state.main, role: 'coordinator', text: short(msg || 'needs your permission', 90), source: 'claude-hooks' });
      }
      break;
    }
    case 'PermissionRequest': {
      if (!state.blocked) { state.blocked = true; events.push({ t: nowMs, kind: 'block', agent: state.main, role: 'coordinator', text: `permission · ${describeTool(tool, input)}`, source: 'claude-hooks' }); }
      break;
    }

    case 'SubagentStop': {
      const open = Object.entries(state.subs);
      if (open.length === 1) { const [key, sub] = open[0]; delete state.subs[key];
        events.push({ t: nowMs, kind: 'done', agent: sub.id, role: sub.role, paper: sub.paper, source: 'claude-hooks' });
        events.push({ t: nowMs + 1, kind: 'handoff', agent: sub.id, role: sub.role, to: state.main, toRole: 'coordinator', paper: sub.paper, text: 'result', source: 'claude-hooks' });
        events.push({ t: nowMs + 2, kind: 'leave', agent: sub.id, source: 'claude-hooks' }); }
      break;
    }

    case 'Stop': {
      if (state.mainWorking) { state.mainWorking = false; events.push({ t: nowMs, kind: 'done', agent: state.main, role: 'coordinator', paper: state.paper || undefined, text: 'turn finished', source: 'claude-hooks' }); }
      break;
    }
    case 'SessionEnd': {
      if (state.mainWorking) { state.mainWorking = false; events.push({ t: nowMs, kind: 'done', agent: state.main, role: 'coordinator', paper: state.paper || undefined, source: 'claude-hooks' }); }
      for (const sub of Object.values(state.subs)) events.push({ t: nowMs, kind: 'leave', agent: sub.id, source: 'claude-hooks' });
      state.subs = {};
      events.push({ t: nowMs + 1, kind: 'leave', agent: state.main, source: 'claude-hooks' }); state.joined = false;
      break;
    }
    default: break;
  }
  return { events, state };
}
