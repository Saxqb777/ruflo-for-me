// Binas event engine. Pure: no DOM, no three.js. The page, the demo generator and the node tests share it.
// Feed it normalized events (see ../src/events.mjs); ask it for the world at any instant with view(nowMs).
export const CONTRACT = 'binas.event/0.1';
export const KINDS = ['join', 'leave', 'arrive', 'claim', 'start', 'handoff', 'block', 'unblock', 'done', 'fail', 'ship'];

// Plan units are pixels on a 1200 x 720 sheet; world units are plan px * 0.1, centred on the sheet.
export const PX = 0.1;
export const wx = (px) => (px - 600) * PX;
export const wz = (py) => (py - 360) * PX;
export const TUBE_Y = 3.3;
export const TRAY_Y = 1.02;
export const SPEED = { tube: 30, slide: 20, belt: 13 }; // world units per second

export const ROOMS = [
  { id: '101', name: 'Mailroom', x: 24, y: 24, w: 176, h: 308, door: { x: 112, y: 332 }, side: 'top',
    slots: [{ desk: { x: 84, y: 166, w: 56, h: 28 }, home: { x: 112, y: 214 } }, { desk: { x: 84, y: 250, w: 56, h: 28 }, home: { x: 112, y: 298 } }] },
  { id: '102', name: 'Research', x: 200, y: 24, w: 240, h: 308, door: { x: 320, y: 332 }, side: 'top',
    slots: [{ desk: { x: 236, y: 186, w: 48, h: 28 }, home: { x: 260, y: 232 } }, { desk: { x: 346, y: 186, w: 48, h: 28 }, home: { x: 370, y: 232 } }] },
  { id: '103', name: 'Drafting', x: 440, y: 24, w: 240, h: 308, door: { x: 560, y: 332 }, side: 'top',
    slots: [{ desk: { x: 520, y: 176, w: 80, h: 44 }, home: { x: 560, y: 240 } }, { desk: { x: 470, y: 262, w: 48, h: 28 }, home: { x: 494, y: 306 } }] },
  { id: '104', name: 'Test lab', x: 680, y: 24, w: 280, h: 308, door: { x: 820, y: 332 }, side: 'top',
    slots: [{ desk: { x: 730, y: 186, w: 60, h: 28 }, home: { x: 760, y: 232 } }, { desk: { x: 850, y: 186, w: 60, h: 28 }, home: { x: 880, y: 232 } }] },
  { id: '105', name: 'Review', x: 960, y: 24, w: 216, h: 308, door: { x: 1068, y: 332 }, side: 'top',
    slots: [{ desk: { x: 1028, y: 140, w: 80, h: 80, round: true }, home: { x: 1068, y: 240 } }, { desk: { x: 990, y: 262, w: 48, h: 28 }, home: { x: 1014, y: 306 } }] },
  { id: '201', name: 'Build floor', x: 24, y: 388, w: 696, h: 308, door: { x: 372, y: 388 }, side: 'bot',
    slots: [176, 396, 616].flatMap((x) => [466, 596].map((y) => ({ desk: { x, y, w: 48, h: 28 }, home: { x: x + 24, y: y + 46 } }))) },
  { id: '202', name: 'Release dock', x: 720, y: 388, w: 280, h: 308, door: { x: 860, y: 388 }, side: 'bot',
    slots: [{ desk: { x: 740, y: 440, w: 48, h: 28 }, home: { x: 764, y: 486 } }] },
  { id: '203', name: 'Records', x: 1000, y: 388, w: 176, h: 160, door: { x: 1088, y: 388 }, side: 'bot', slots: [] },
];

export const CHUTE = { x: wx(30), y: 1.3, z: wz(164) };
export const BELT = [{ x: wx(800), y: 1.06, z: wz(454) }, { x: wx(870), y: 1.06, z: wz(454) }, { x: wx(870), y: 1.06, z: wz(690) }, { x: wx(870), y: 1.06, z: wz(748) }];
export const DOCK_STAMP = { x: wx(870), z: wz(610) };

const ROLE_ROOM = [
  [/coordinat|queen|lead|orchestr|main|^me$|session/, '101'],
  [/research|analy|scout|explor/, '102'],
  [/architect|design|spec|plan/, '103'],
  [/test|qa\b|valid|bench/, '104'],
  [/review|secur|audit/, '105'],
  [/release|deploy|cicd|ship|publish/, '202'],
];
export function roomForRole(role) {
  const r = String(role || '').toLowerCase();
  for (const [re, id] of ROLE_ROOM) if (re.test(r)) return id;
  return '201';
}

function slotWorld(s) {
  const d = s.desk;
  return {
    cx: wx(d.x + d.w / 2), cz: wz(d.y + d.h / 2), w: d.w * PX, d: d.h * PX, round: !!d.round,
    home: { x: wx(s.home.x), z: wz(s.home.y) },
    tray: d.round ? { x: wx(d.x + d.w / 2 + 14), z: wz(d.y + d.h / 2 - 14) } : { x: wx(d.x + d.w - 12), z: wz(d.y + 9) },
    station: { x: wx(d.x + d.w + 9), z: wz(d.y + d.h / 2) },
    lamp: d.round ? { x: wx(d.x + d.w / 2), z: wz(d.y + d.h / 2) } : { x: wx(d.x + 5), z: wz(d.y + 5) },
    flag: d.round ? { x: wx(d.x + d.w / 2 - 16), z: wz(d.y + d.h / 2 + 14) } : { x: wx(d.x + d.w - 4), z: wz(d.y + 3) },
  };
}

/** Every desk on the floor, with world geometry, in a stable order. */
export function makeSlots() {
  const out = [];
  for (const r of ROOMS) r.slots.forEach((s, i) => out.push({ id: r.id + String.fromCharCode(97 + i), room: r.id, plan: s, W: slotWorld(s) }));
  return out;
}

const dist3 = (p, q) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
export function plen(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += dist3(pts[i - 1], pts[i]); return l; }
export function along(pts, len, f) {
  let d = Math.max(0, Math.min(1, f)) * len;
  for (let i = 1; i < pts.length; i++) {
    const s = dist3(pts[i - 1], pts[i]);
    if (d <= s || i === pts.length - 1) {
      const k = s ? Math.min(1, d / s) : 1; const p = pts[i - 1], q = pts[i];
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k, dx: q.x - p.x, dy: q.y - p.y, dz: q.z - p.z };
    }
    d -= s;
  }
  const q = pts[pts.length - 1]; return { x: q.x, y: q.y, z: q.z, dx: 0, dy: 1, dz: 0 };
}
export function tubePath(S, T) {
  return [{ x: S.x, y: TRAY_Y + 0.2, z: S.z }, { x: S.x, y: TUBE_Y, z: S.z }, { x: S.x, y: TUBE_Y, z: 0 }, { x: T.x, y: TUBE_Y, z: 0 }, { x: T.x, y: TUBE_Y, z: T.z }, { x: T.x, y: TRAY_Y + 0.2, z: T.z }];
}

const LEVEL = { arrive: 'in', claim: 'move', handoff: 'move', start: 'info', block: 'warn', unblock: 'ok', done: 'ok', fail: 'bad', ship: 'ok', join: 'dim', leave: 'dim' };
const short = (s, n = 72) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/**
 * createEngine(): an incremental fold over events. push() in time order (out-of-order is tolerated but
 * animations are computed from the time the event is pushed), then view(now) gives the whole world.
 */
export function createEngine() {
  const slots = makeSlots();
  const taken = new Set();
  const agents = new Map(), papers = new Map(), trays = new Map();
  const stamps = [], notes = [], ships = [], feed = [], flashes = [], doors = [], sfx = [];
  let t0 = Infinity, t1 = -Infinity;

  const feedLine = (t, kind, who, text) => feed.push({ t, lv: LEVEL[kind] || 'info', who, text });
  const setState = (a, t, s, text) => { a.states.push({ t, s, text }); };
  const noteTime = (t) => { if (t < t0) t0 = t; if (t > t1) t1 = t; };

  function pickSlot(role) {
    const want = roomForRole(role);
    const free = (room) => slots.find((s) => s.room === room && !taken.has(s.id));
    return free(want) || free('201') || slots.filter((s) => s.room === want)[0] || slots[0];
  }
  function ensureAgent(id, role, t, name) {
    if (!id) return null;
    let a = agents.get(id);
    if (a) { if (role && a.role === 'worker') { a.role = role; } return a; }
    const slot = pickSlot(role || 'worker');
    taken.add(slot.id);
    a = { id, name: name || id, role: role || 'worker', slot, states: [{ t: t - 1, s: 'idle', text: '—' }], joinedAt: t, left: null };
    agents.set(id, a); trays.set(id, []);
    return a;
  }
  function coordinator() {
    for (const a of agents.values()) if (a.slot.room === '101') return a;
    return null;
  }
  function ensurePaper(id, text, t) {
    let p = papers.get(id);
    if (!p) { p = { id, title: short(text || id), pos: [{ t: t - 1, k: 'gone' }], status: [{ t: t - 1, s: 'none' }], holder: null }; papers.set(id, p); }
    else if (text && p.title === p.id) p.title = short(text);
    return p;
  }
  function trayPlace(p, a, t) {
    const l = trays.get(a.id); let i = l.indexOf(null); if (i < 0) { i = l.length; l.push(p.id); } else l[i] = p.id;
    const tr = a.slot.W.tray; p.pos.push({ t, k: 'at', x: tr.x + i * 0.5, y: TRAY_Y + i * 0.09, z: tr.z - i * 0.3 }); p.holder = a.id; p.readyAt = t;
  }
  function trayRemove(p) {
    if (!p.holder) return; const l = trays.get(p.holder) || []; const i = l.indexOf(p.id); if (i >= 0) l[i] = null; p.holder = null;
  }
  function path(p, t, pts, speed) { const len = plen(pts); const end = t + (len / speed) * 1000; p.pos.push({ t, k: 'path', t0: t, t1: end, pts, len }); return end; }
  function lastWorking(a) { for (let i = a.states.length - 1; i >= 0; i--) if (a.states[i].s === 'working') return a.states[i]; return null; }

  const H = {
    join(e) { const a = ensureAgent(e.agent, e.role, e.t, e.name); feedLine(e.t, 'join', a.id, `${a.name} joined · ${a.role}`); },
    leave(e) { const a = agents.get(e.agent); if (!a) return; a.left = e.t; setState(a, e.t, 'gone', '—'); feedLine(e.t, 'leave', a.id, `${a.name} left`); },
    arrive(e) {
      const p = ensurePaper(e.paper, e.text, e.t);
      const to = (e.to && ensureAgent(e.to, e.toRole, e.t)) || coordinator() || ensureAgent('main', 'coordinator', e.t, 'ME');
      trayRemove(p);
      const tr = to.slot.W.tray; const end = path(p, e.t, [CHUTE, { x: tr.x, y: 1.3, z: CHUTE.z }, { x: tr.x, y: TRAY_Y, z: tr.z }], SPEED.slide);
      trayPlace(p, to, end); p.status.push({ t: e.t, s: 'in' }); sfx.push({ t: e.t, k: 'slide' });
      feedLine(e.t, 'arrive', 'IN', `${p.id} arrived · ${p.title}`);
    },
    claim(e) { H.handoff(e); },
    handoff(e) {
      const a = ensureAgent(e.agent, e.role, e.t); const to = ensureAgent(e.to, e.toRole, e.t); if (!to) return;
      const p = ensurePaper(e.paper, e.text, e.t);
      if (p.holder !== a.id) { trayRemove(p); trayPlace(p, a, e.t - 1); }
      trayRemove(p);
      const end = path(p, e.t, tubePath(a.slot.W.station, to.slot.W.station), SPEED.tube); trayPlace(p, to, end);
      p.status.push({ t: e.t, s: 'floor' }); flashes.push({ t: e.t, a: a.id }); sfx.push({ t: e.t, k: 'whoosh' }, { t: end, k: 'thunk' });
      feedLine(e.t, e.kind, a.id, `${a.id} → ${to.id} · ${p.id}${e.text ? ' · ' + short(e.text, 60) : ''}`);
    },
    start(e) {
      const a = ensureAgent(e.agent, e.role, e.t); if (!a) return;
      if (e.paper) { const p = ensurePaper(e.paper, e.text, e.t); if (p.holder !== a.id) { trayRemove(p); trayPlace(p, a, e.t); if (p.status[p.status.length - 1].s === 'none') p.status.push({ t: e.t, s: 'floor' }); } p.pos.push({ t: e.t, k: 'work' }); }
      setState(a, e.t, 'working', short(e.text, 90)); sfx.push({ t: e.t, k: 'click' }); feedLine(e.t, 'start', a.id, short(e.text, 90) || 'working');
    },
    block(e) {
      const a = ensureAgent(e.agent, e.role, e.t); if (!a) return;
      const n = { a: a.id, t0: e.t, t1: Infinity, text: short(e.text || e.needs, 90) }; notes.push(n);
      setState(a, e.t, 'blocked', n.text); sfx.push({ t: e.t, k: 'flag' }); feedLine(e.t, 'block', a.id, `needs you · ${n.text}`);
    },
    unblock(e) {
      const a = agents.get(e.agent); if (!a) return;
      for (const n of notes) if (n.a === a.id && n.t1 === Infinity) n.t1 = e.t;
      const prev = lastWorking(a); setState(a, e.t, prev ? 'working' : 'idle', prev ? prev.text : '—');
      stamps.push({ t: e.t, a: a.id, text: 'YES', kind: 'done', small: true }); sfx.push({ t: e.t, k: 'thud' }); feedLine(e.t, 'unblock', 'YOU', short(e.text, 90) || 'yes');
    },
    done(e) { H._verdict(e, false); },
    fail(e) { H._verdict(e, true); },
    _verdict(e, fail) {
      const a = ensureAgent(e.agent, e.role, e.t); if (!a) return;
      for (const n of notes) if (n.a === a.id && n.t1 === Infinity) n.t1 = e.t;
      stamps.push({ t: e.t, a: a.id, text: fail ? 'FAIL' : 'DONE', kind: fail ? 'fail' : 'done' });
      setState(a, e.t, 'done', '—'); setState(a, e.t + 900, 'idle', '—'); sfx.push({ t: e.t, k: 'thud' });
      feedLine(e.t, fail ? 'fail' : 'done', a.id, `${fail ? 'FAIL' : 'done'}${e.paper ? ' · ' + e.paper : ''}${e.text ? ' · ' + short(e.text, 70) : ''}`);
    },
    ship(e) {
      const a = ensureAgent(e.agent, e.role, e.t); if (!a) return;
      const p = ensurePaper(e.paper || `ship-${ships.length + 1}`, e.text, e.t);
      if (p.holder !== a.id) { trayRemove(p); trayPlace(p, a, e.t - 1); }
      trayRemove(p);
      const tr = a.slot.W.tray; const end = path(p, e.t, [{ x: tr.x, y: TRAY_Y, z: tr.z }, ...BELT], SPEED.belt); p.pos.push({ t: end, k: 'gone' });
      doors.push({ t0: end - 1600, t1: end + 500 }); stamps.push({ t: end - 900, dock: true, text: 'SHIPPED', kind: 'ship' });
      ships.push({ t: end, p: p.id }); p.status.push({ t: end, s: 'shipped' }); flashes.push({ t: e.t, a: a.id });
      sfx.push({ t: e.t, k: 'belt' }, { t: end - 900, k: 'thud' }, { t: end, k: 'bell' });
      feedLine(end - 900, 'ship', a.id, `SHIPPED · ${p.id} · ${short(e.text, 60) || p.title}`);
    },
  };

  function push(e) {
    if (!e || !KINDS.includes(e.kind) || typeof e.t !== 'number') return false;
    noteTime(e.t); H[e.kind](e); return true;
  }

  /* ---- evaluation ---- */
  function stateOf(a, now) { let r = a.states[0]; for (const x of a.states) { if (x.t <= now) r = x; else break; } return r; }
  function paperAt(p, now, reduced) {
    let pos = null, work = false;
    for (const r of p.pos) { if (r.t > now) break; if (r.k === 'work') work = true; else { pos = r; work = false; } }
    if (!pos || pos.k === 'gone') return null;
    if (pos.k === 'at') return { x: pos.x, y: pos.y, z: pos.z, work, moving: false };
    const f = reduced ? 1 : (now - pos.t0) / (pos.t1 - pos.t0); const q = along(pos.pts, pos.len, f);
    return { x: q.x, y: q.y, z: q.z, dx: q.dx, dy: q.dy, dz: q.dz, work: false, moving: now < pos.t1, belt: pos.pts.length > 4 && pos.pts[1].y < 2 };
  }
  function statusOf(p, now) { let r = 'none'; for (const s of p.status) { if (s.t <= now) r = s.s; else break; } return r; }

  function view(now, opts = {}) {
    const out = { agents: [], papers: [], stamps: [], notes: [], flashes: new Set(), door: 0, shipped: 0, inN: 0, floorN: 0, blocked: 0, feedN: 0 };
    for (const a of agents.values()) {
      if (a.joinedAt > now + 1) continue;
      const st = stateOf(a, now); if (st.s === 'blocked') out.blocked++;
      out.agents.push({ id: a.id, name: a.name, role: a.role, slot: a.slot, state: st.s, text: st.text, gone: !!(a.left && a.left <= now) });
    }
    for (const p of papers.values()) {
      const pos = paperAt(p, now, opts.reduced); const s = statusOf(p, now);
      if (s === 'in') out.inN++; else if (s === 'floor') out.floorN++;
      out.papers.push({ id: p.id, title: p.title, pos });
    }
    for (const s of stamps) if (now >= s.t && now < s.t + 2000) out.stamps.push({ ...s, age: (now - s.t) / 1000 });
    for (const n of notes) if (now >= n.t0 && now < n.t1) out.notes.push(n);
    for (const f of flashes) if (now >= f.t && now < f.t + 500) out.flashes.add(f.a);
    for (const d of doors) if (now >= d.t0 && now <= d.t1 + 800) { const a = Math.min(1, (now - d.t0) / 600), b = now > d.t1 ? Math.max(0, 1 - (now - d.t1) / 800) : 1; out.door = Math.max(out.door, Math.min(a, b)); }
    for (const s of ships) if (s.t <= now) out.shipped++;
    for (const f of feed) if (f.t <= now) out.feedN++;
    return out;
  }

  return { push, view, agents, papers, feed, notes, sfx, slots, bounds: () => ({ t0, t1 }), coordinator };
}
