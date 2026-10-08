// The showroom panel on the cloud floor: sign in, your projects as conversations, the Building view and the
// approvals tray for the owner. Talks to the api/ functions with the session cookie. Lists are rebuilt only
// when their content changes, so a button is never replaced between mouse-down and mouse-up.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Number(n || 0).toFixed(2);
const when = (ms) => { const d = new Date(Number(ms)); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const STATUS = { new: 'opening', queued: 'in line', approval: 'waiting for the owner’s OK', running: 'being built', blocked: 'needs your answer', idle: 'ready', failed: 'stopped', closed: 'closed' };
const TURN = { queued: 'in line', approval: 'waiting for the owner’s OK', running: 'being built', blocked: 'waiting for your answer', done: 'done', failed: 'stopped', rejected: 'not run', open: 'open' };
const api = async (method, path, body) => { const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); const j = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, ...j }; };
const el = (tag, cls, text) => { const d = document.createElement(tag); if (cls) d.className = cls; if (text !== undefined) d.textContent = text; return d; };
const btn = (label, onclick, cls) => { const b = el('button', cls, label); b.type = 'button'; b.onclick = onclick; return b; };

export function createShowroom({ root, status, onFloor, onUser }) {
  const $ = (sel) => root.querySelector(sel);
  const S = { user: null, floor: null, floors: [], approvals: [], projects: [], project: null, turns: [], sig: {}, timer: null, busy: false };
  const say = (s) => { status.textContent = s; };
  const changed = (key, value) => { const sig = JSON.stringify(value); if (S.sig[key] === sig) return false; S.sig[key] = sig; return true; };
  const owner = () => S.user && S.user.role === 'owner';
  const openAsk = (turns) => { const last = turns[turns.length - 1]; return last && last.kind === 'ask' && last.status === 'open' ? last : null; };

  /* ---- sign in ---- */
  const login = $('#loginForm');
  login.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(login); say('signing in…');
    const r = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
    if (!r.ok) { say(r.error || 'sign-in refused'); return; }
    login.reset(); await setUser(r.user);
  });
  const signOut = document.getElementById('signOut');
  signOut.onclick = async () => { await api('DELETE', '/api/login'); S.user = null; S.floor = null; S.project = null; show(); say('signed out'); if (onUser) onUser(null); };
  async function setUser(u) {
    S.user = u; S.floor = u ? u.floor : null; S.project = null; S.sig = {}; show(); if (onUser) onUser(u); if (onFloor && u) onFloor(S.floor);
    say(u ? `${u.display} · floor ${u.floor}${u.role === 'owner' ? ' · owner' : ''}` : 'sign in to use the floor');
    await refresh();
  }
  function show() {
    const on = !!S.user;
    $('#loginForm').hidden = on; signOut.hidden = !on; $('#projectForm').hidden = !on;
    $('#projects').hidden = !on; $('#building').hidden = !on || !owner(); $('#tray').hidden = !on || !owner();
    $('#thread').hidden = !on || !S.project;
  }

  /* ---- the Building view (owner) ---- */
  function renderFloors() {
    const box = $('#building'); if (!changed('floors', [S.floors, S.floor])) return;
    box.replaceChildren(el('h3', 'sub', 'Building'));
    const grid = el('div', 'floorgrid');
    for (const f of S.floors) {
      const c = btn('', () => { S.floor = f.floor; S.project = null; S.sig = {}; if (onFloor) onFloor(f.floor); refresh(); }, 'floorcard' + (f.floor === S.floor ? ' on' : '') + (f.active ? ' live' : ''));
      c.append(el('span', 'fname', f.user.display), el('span', 'fmeta mono', `${f.floor} · ${f.projects} proj · ${f.active ? 'building' : 'quiet'}`), el('span', 'fuse mono', f.allowanceUsd === null ? `${money(f.usedUsd)} · unlimited` : `${money(f.usedUsd)} of ${money(f.allowanceUsd)}`));
      if (f.approvals) c.append(el('span', 'fbadge', `${f.approvals} waiting for you`));
      if (f.snags) c.append(el('span', 'fbadge', `${f.snags} snag${f.snags === 1 ? '' : 's'}`));
      grid.appendChild(c);
    }
    box.appendChild(grid);
  }
  function renderTray() {
    const box = $('#tray'); if (!changed('tray', S.approvals)) return;
    box.replaceChildren(); if (!S.approvals.length) { box.hidden = true; return; } box.hidden = false;
    box.appendChild(el('h3', 'sub', `Approvals · ${S.approvals.length}`));
    for (const a of S.approvals) {
      const row = el('div', 'trayrow');
      row.append(el('div', 'who mono', `${a.user.display || a.floor} · ${a.projectTitle}`), el('div', 'txt', a.text.length > 220 ? a.text.slice(0, 219) + '…' : a.text), el('div', 'meta mono', `turn ${a.n} · cap ${money(a.budgetUsd)} · ${when(a.createdAt)}`));
      const acts = el('div', 'acts');
      acts.append(btn('Approve', () => decide(a.id, 'approve')), btn('Decline', () => decide(a.id, 'reject'), 'quiet'));
      row.appendChild(acts); box.appendChild(row);
    }
  }
  async function decide(turn, decision) { const r = await api('POST', '/api/approvals', { turn, decision }); say(r.ok ? (decision === 'approve' ? 'approved · the workshop picks it up' : 'declined') : r.error || 'refused'); refresh(); }

  /* ---- projects ---- */
  function renderProjects() {
    const box = $('#projects'); if (!changed('projects', [S.projects, S.project && S.project.id])) return;
    box.replaceChildren(el('h3', 'sub', S.projects.length ? `Projects · ${S.projects.length}` : 'Projects'));
    if (!S.projects.length) box.appendChild(el('div', 'none', 'none yet. Open one below: say what it is, who it is for, what done looks like.'));
    for (const p of S.projects) {
      const row = btn('', () => { S.project = p; S.turns = []; delete S.sig.thread; refresh(); }, 'projrow st-' + p.status + (S.project && S.project.id === p.id ? ' on' : ''));
      row.append(el('span', 'ptitle', p.title), el('span', 'pstate', STATUS[p.status] || p.status), el('span', 'pmeta mono', `${p.turns} round${p.turns === 1 ? '' : 's'}${owner() ? ' · ' + money(p.costUsd) : ''}${owner() && !S.floor ? ' · ' + p.floor : ''}`));
      if (p.latest && p.latest.text) row.append(el('span', 'plast', (p.latest.author === 'binas' ? 'binas: ' : '') + p.latest.text.slice(0, 90)));
      box.appendChild(row);
    }
  }
  const pf = $('#projectForm');
  pf.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(pf); say('opening…');
    const r = await api('POST', '/api/projects', { title: f.get('title'), brief: f.get('brief'), kind: f.get('kind') });
    if (!r.ok) { say(r.error || 'refused'); return; }
    pf.reset(); say(r.approval ? 'opened · over your allowance, so it waits in the owner’s tray' : 'opened · the workshop picks it up'); S.project = r.project; S.turns = []; delete S.sig.thread; refresh();
  });

  /* ---- the thread ---- */
  function renderThread() {
    const box = $('#thread'); const p = S.project; if (!p) { box.hidden = true; return; }
    box.hidden = false; if (!changed('thread', [p.id, p.status, p.previewUrl, p.repo, S.turns])) return;
    box.replaceChildren();
    const head = el('div', 'thead');
    const links = [p.previewUrl ? `<a href="${esc(p.previewUrl)}" target="_blank" rel="noopener">open the preview</a>` : '', p.repo ? `<a href="${esc(p.repo)}" target="_blank" rel="noopener">code</a>` : ''].filter(Boolean).join(' · ');
    head.innerHTML = `<div class="ttitle"></div><div class="tstate mono"></div>${links ? `<div class="tlinks">${links}</div>` : ''}`;
    head.querySelector('.ttitle').textContent = p.title; head.querySelector('.tstate').textContent = `${STATUS[p.status] || p.status}${owner() ? ' · ' + money(p.costUsd) + ' so far' : ''}`;
    const acts = el('div', 'back'); acts.append(btn('All projects', () => { S.project = null; delete S.sig.projects; show(); }, 'quiet'), btn('Close', () => closeProject(p), 'quiet')); head.appendChild(acts);
    box.appendChild(head);
    const list = el('div', 'msgs');
    for (const t of S.turns) {
      const m = el('div', `msg k-${t.kind}${t.author === 'binas' ? ' binas' : ' mine'}${t.status === 'approval' ? ' waiting' : ''}`);
      m.append(el('span', 'who mono', t.author === 'binas' ? (t.kind === 'ask' ? 'the floor asks' : t.kind === 'report' ? 'what got built' : 'the floor') : t.author), el('span', 'at mono', when(t.createdAt)));
      m.appendChild(el('div', 'txt', t.text));
      if (t.kind === 'report' && t.options && t.options.length) { const ul = el('ul', 'changes'); t.options.forEach((c) => ul.appendChild(el('li', '', c))); m.appendChild(ul); }
      if (t.note && ['ask', 'report', 'note'].includes(t.kind) && (owner() || !/^detail: /.test(t.note))) m.appendChild(el('div', 'note', t.note));
      if (t.kind === 'report' && t.links && (t.links.preview || t.links.remote)) { const d = el('div', 'tlinks'); d.innerHTML = [t.links.preview ? `<a href="${esc(t.links.preview)}" target="_blank" rel="noopener">open the preview</a>` : '', t.links.remote ? `<a href="${esc(t.links.remote)}" target="_blank" rel="noopener">code</a>` : ''].filter(Boolean).join(' · '); m.appendChild(d); }
      if (['request', 'answer'].includes(t.kind)) m.appendChild(el('div', 'tstatus mono', `${TURN[t.status] || t.status}${owner() && t.budgetUsd ? ' · cap ' + money(t.budgetUsd) : ''}${owner() && t.costUsd !== null && t.costUsd !== undefined ? ' · ' + money(t.costUsd) : ''}${t.note && t.status === 'running' ? ' · ' + t.note : ''}`));
      list.appendChild(m);
    }
    box.appendChild(list);
    const ask = openAsk(S.turns);
    if (ask && ask.options.length) { const opts = el('div', 'jopts'); ask.options.forEach((o, i) => { const b = btn(o, () => send(o)); if (i === 0 && ask.links && ask.links.recommended) b.appendChild(el('span', 'rec', 'recommended')); opts.appendChild(b); }); box.appendChild(opts); }
    const open = S.turns.find((t) => ['request', 'answer'].includes(t.kind) && ['queued', 'running', 'approval'].includes(t.status));
    const form = el('form', 'composer'); const ta = el('textarea'); ta.rows = 2; ta.maxLength = 8000; ta.placeholder = ask ? 'or answer in your own words' : open ? `${open.status === 'approval' ? 'waiting for the owner’s OK' : 'the floor is still building'} · one message at a time` : 'tell the floor what to change or add next'; ta.setAttribute('aria-label', 'Message');
    const sendB = el('button', '', ask ? 'Answer' : 'Send'); sendB.type = 'submit'; sendB.disabled = !!open && !ask;
    form.append(ta, sendB); form.addEventListener('submit', (e) => { e.preventDefault(); const v = ta.value.trim(); if (v) send(v); });
    ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') form.requestSubmit(); });
    box.appendChild(form);
    list.scrollTop = list.scrollHeight;
  }
  async function closeProject(p) {
    if (!confirm(`Close "${p.title}"? Nothing is deleted; queued work is withdrawn and it leaves the list.`)) return;
    const r = await api('DELETE', `/api/projects?project=${encodeURIComponent(p.id)}`); say(r.ok ? 'closed' : r.error || 'refused');
    if (r.ok) { S.project = null; delete S.sig.projects; show(); refresh(); }
  }
  async function send(text) {
    if (!S.project) return false; say('sending…');
    const r = await api('POST', '/api/turns', { project: S.project.id, text });
    if (!r.ok) { say(r.error || 'refused'); return false; }
    say(r.approval ? 'sent · over your allowance, so it waits in the owner’s tray' : 'sent · the workshop picks it up'); delete S.sig.thread; await refresh(); return true;
  }

  /* ---- polling ---- */
  async function refresh() {
    if (S.busy) return; S.busy = true;
    try {
      if (!S.user) { const me = await api('GET', '/api/login'); if (me.ok) { S.user = me.user; S.floor = me.user.floor; show(); if (onUser) onUser(me.user); if (onFloor) onFloor(S.floor); say(`${me.user.display} · floor ${me.user.floor}`); } else { if (me.status === 503) say(me.error || 'showroom not configured'); show(); return; } }
      const q = owner() && S.floor ? `?floor=${encodeURIComponent(S.floor)}` : '';
      const [pr, fl, ap] = await Promise.all([api('GET', '/api/projects' + q), api('GET', '/api/floors'), owner() ? api('GET', '/api/approvals') : null]);
      if (pr.status === 401) { S.user = null; show(); say('session ended · sign in again'); return; }
      S.projects = pr.projects || []; if (fl && fl.ok) S.floors = fl.floors || []; if (ap && ap.ok) S.approvals = ap.approvals || [];
      if (!owner() && S.floors[0] && S.floors[0].allowanceUsd !== null) say(`${S.user.display} · ${money(Math.max(0, S.floors[0].allowanceUsd - S.floors[0].usedUsd))} of building left this month`);
      if (S.project) { const t = await api('GET', `/api/turns?project=${encodeURIComponent(S.project.id)}`); if (t.ok) { S.project = t.project; S.turns = t.turns || []; } else S.project = null; }
      renderFloors(); renderTray(); renderProjects(); renderThread();
    } catch { say('showroom unreachable · retrying'); }
    finally { S.busy = false; }
  }
  /** For the "waiting for a yes" list: the open question on a project, by project id. */
  function question(projectId) {
    if (S.project && S.project.id === projectId) { const a = openAsk(S.turns); return a ? { text: a.text, options: a.options } : null; }
    const p = S.projects.find((x) => x.id === projectId); return p && p.latest && p.latest.kind === 'ask' && p.latest.status === 'open' ? { text: p.latest.text, options: p.latest.options || [] } : null;
  }
  async function answer(projectId, text) {
    if (!S.project || S.project.id !== projectId) { S.project = S.projects.find((x) => x.id === projectId) || { id: projectId, title: '', status: '', kind: '' }; S.turns = []; delete S.sig.thread; }
    return send(text);
  }
  show(); refresh(); S.timer = setInterval(refresh, 3000);
  return { question, answer, refresh, floor: () => S.floor, user: () => S.user, stop() { clearInterval(S.timer); } };
}
