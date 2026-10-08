// Wires a feed (live SSE, the demo file, or a dropped .jsonl) through the engine into the scene and the board.
import { createEngine } from './engine.js';
import { createScene } from './scene.js';
import { createFlaps, setFlapText, flapAdvance, createAudio } from './board.js';
import { createJobs } from './jobs.js';
import { createShowroom } from './showroom.js';

const $ = (id) => document.getElementById(id);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ROWS = 7, COLS = 30;
const pad = (n) => String(n).padStart(2, '0');
const clockStr = (ms) => { const d = new Date(ms); return isNaN(d) ? '--:--:--' : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const mmss = (s) => { s = Math.max(0, Math.floor(s)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

const stage = $('stage'), labelsEl = $('labels'), canvas = $('gl');
if (typeof THREE === 'undefined') { const d = document.createElement('div'); d.className = 'nogl'; d.textContent = 'The 3D library did not load. Check the network and reload.'; stage.appendChild(d); throw new Error('three.js missing'); }

let engine = createEngine();
const scene = createScene(THREE, canvas, stage, labelsEl);
const audio = createAudio();
const F = {}; document.querySelectorAll('[data-flaps]').forEach((c) => { F[c.dataset.flaps] = createFlaps(c, Number(c.dataset.n)); });
const rowsF = []; for (let r = 0; r < ROWS; r++) { const row = document.createElement('div'); row.className = 'row'; $('board').appendChild(row); rowsF.push(createFlaps(row, COLS)); }

/* ---- time ---- */
const T = { mode: 'replay', now: 0, playing: true, speed: 1, live: true, lag: 800, loop: false, label: '—' };
const range = $('range'), elapsedEl = $('elapsed'), yesEl = $('yes'), card = $('card'), legend = $('legend');
let selected = null, lastFeedN = -1, lastNow = 0, lastTs = performance.now();
function bounds() { const b = engine.bounds(); return Number.isFinite(b.t0) ? { t0: b.t0 - 500, t1: b.t1 + 6000 } : { t0: Date.now() - 1000, t1: Date.now() + 1000 }; }

/* ---- sources ---- */
let es = null, cloudTimer = null, cloudCursor = 0, dateSet = false;
const isLoop = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
function stopSources() { if (es) { es.close(); es = null; } if (cloudTimer) { clearInterval(cloudTimer); cloudTimer = null; } }
function resetEngine(label, meta) { stopSources(); engine = createEngine(); lastFeedN = -1; selected = null; dateSet = false; card.hidden = true; legend.hidden = false; T.label = label; scene.setMeta(meta); }
const keyGet = () => { try { return localStorage.getItem('binas.key') || ''; } catch { return ''; } };
const keySet = (v) => { try { localStorage.setItem('binas.key', v); } catch { /* per-viewer convenience only */ } };
const showKey = (on) => { $('keyForm').hidden = !on; };
/* Cloud: the Vercel functions in api/ backed by Neon. Polls a cursor; the key is kept in this browser only. */
const cloudMode = !isLoop && location.protocol !== 'file:';
let cloudFloor = new URLSearchParams(location.search).get('floor') || 'default';
function loadCloud(floor = cloudFloor) {
  cloudFloor = floor;
  resetEngine('CLOUD', { shift: 'CLOUD', date: new Date().toISOString().slice(0, 10), source: 'CLOUD · NEON', title: 'BINAS WORKS · ' + floor.toUpperCase() });
  T.mode = 'live'; T.live = true; T.loop = false; T.playing = true; $('live').hidden = true; $('srcName').textContent = 'CLOUD'; cloudCursor = 0; $('floorName').textContent = floor === 'default' ? 'A-01' : floor.toUpperCase();
  const poll = async () => {
    if (floor !== cloudFloor) return;
    const key = keyGet(); const signedIn = cloudMode && factory.user && factory.user();
    if (!key && !signedIn) { showKey(!cloudMode); setInfo(cloudMode ? 'sign in below to follow the live feed · the demo needs no sign-in' : 'enter the floor key to follow the live feed'); return; }
    try {
      const r = await fetch(`/api/events?floor=${encodeURIComponent(floor)}&after=${cloudCursor}&limit=2000`, { headers: key ? { 'x-binas-key': key } : {}, cache: 'no-store' });
      if (r.status === 401) { if (signedIn) { setInfo('this floor is not yours to watch'); return; } showKey(true); setInfo(key ? 'that floor key was refused' : 'sign in, or enter a floor key'); return; }
      if (r.status === 503) { setInfo('cloud: no database connected yet · the demo works'); return; }
      if (!r.ok) { setInfo(`cloud feed answered ${r.status}`); return; }
      const j = await r.json(); showKey(false);
      j.events.forEach((e) => engine.push(e)); cloudCursor = j.cursor || cloudCursor;
      if (j.events.length && !dateSet) { scene.setMeta({ date: dateOf(j.events) }); dateSet = true; }
      setInfo(engine.feed.length ? `${engine.feed.length} lines · following · floor ${floor}` : `floor ${floor} is empty · waiting for the first event`);
    } catch { setInfo('cloud feed unreachable · retrying'); }
  };
  poll(); cloudTimer = setInterval(poll, 2000);
}
$('keyForm').addEventListener('submit', (e) => { e.preventDefault(); keySet($('key').value.trim()); $('key').value = ''; loadCloud(); });
/* The Factory panel on the local floor is the workshop's job board; on the cloud floor it is the showroom. */
const factory = cloudMode
  ? (() => { $('jobForm').hidden = true; $('jobList').hidden = true; $('showroom').hidden = false; $('factoryTitle').textContent = 'Showroom'; return createShowroom({ root: $('showroom'), status: $('jobStatus'), onFloor: (f) => { if (f && f !== cloudFloor) loadCloud(f); }, onUser: (u) => { if (!u) { $('floorName').textContent = 'A-01'; } } }); })()
  : createJobs({ section: $('factory'), form: $('jobForm'), list: $('jobList'), status: $('jobStatus'), enabled: isLoop && location.protocol !== 'file:' });
function loadReplay(events, label, meta) {
  resetEngine(label, meta); events.sort((a, b) => a.t - b.t).forEach((e) => engine.push(e));
  T.mode = 'replay'; T.loop = label === 'DEMO'; const b = bounds(); T.now = b.t0; T.playing = true; T.live = false; $('live').hidden = true; $('srcName').textContent = label;
  setInfo(`${events.length} events · ${mmss((b.t1 - b.t0) / 1000)} · replay`);
}
async function loadDemo() {
  try { const r = await fetch('./demo/shift-014.jsonl', { cache: 'no-cache' }); const text = await r.text(); const events = parseJsonl(text); loadReplay(events, 'DEMO', { shift: '014', date: dateOf(events), source: 'DEMO · RECORDED' }); }
  catch { setInfo('demo file not found. Run: binas demo'); }
}
function loadLive() {
  resetEngine('LIVE', { shift: 'LIVE', date: new Date().toISOString().slice(0, 10), source: 'LIVE · HOOKS + MISSIONS' });
  T.mode = 'live'; T.live = true; T.loop = false; T.playing = true; $('live').hidden = false; $('srcName').textContent = 'LIVE';
  es = new EventSource('/events');
  es.addEventListener('backlog', (m) => { try { const arr = JSON.parse(m.data); arr.forEach((e) => engine.push(e)); setInfo(arr.length ? `${arr.length} events in the log · following` : 'log is empty · waiting for the first hook event'); if (arr.length) scene.setMeta({ date: dateOf(arr) }); } catch { /* ignore */ } });
  es.addEventListener('ev', (m) => { try { engine.push(JSON.parse(m.data)); } catch { /* ignore */ } });
  es.onerror = () => setInfo('feed disconnected · retrying');
}
function parseJsonl(text) { const out = []; for (const line of text.split('\n')) { const s = line.trim(); if (!s) continue; try { const o = JSON.parse(s); const t = typeof o.t === 'number' ? o.t : Date.parse(o.t); if (Number.isFinite(t) && o.kind) out.push({ ...o, t }); } catch { /* skip */ } } return out; }
function dateOf(events) { const e = events.find((x) => Number.isFinite(x.t)); return e ? new Date(e.t).toISOString().slice(0, 10) : ''; }
function setInfo(s) { $('info').textContent = s; }
stage.addEventListener('dragover', (e) => { e.preventDefault(); }); stage.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return; const events = parseJsonl(await f.text()); loadReplay(events, 'FILE', { shift: f.name.slice(0, 14), date: dateOf(events), source: 'FILE · REPLAY' }); });

/* ---- theme ---- */
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); if (t === 'dark') return true; if (t === 'light') return false; return matchMedia('(prefers-color-scheme: dark)').matches; };
function applyTheme() { const cs = getComputedStyle(document.documentElement); scene.setTheme(isDark(), cs.getPropertyValue('--paper').trim() || '#EDECE8'); }
applyTheme(); new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
$('theme').onclick = () => { document.documentElement.setAttribute('data-theme', isDark() ? 'light' : 'dark'); };

/* ---- selection ---- */
function select(id) { selected = id; card.hidden = !id; legend.hidden = !!id; $('vFollow').disabled = !id; if (id) setView('follow', id); else if (scene.view === 'follow') setView('model'); }
scene.onPick(select);
function setView(v, id) { scene.setView(v, id); ['vPlan', 'vModel', 'vFollow'].forEach((b) => $(b).setAttribute('aria-pressed', String(b === 'v' + v[0].toUpperCase() + v.slice(1)))); }
$('vPlan').onclick = () => setView('plan'); $('vModel').onclick = () => setView('model'); $('vFollow').onclick = () => { if (selected) setView('follow', selected); };
function renderCard(vw) {
  const a = vw.agents.find((x) => x.id === selected); if (!a) return;
  const hist = engine.feed.filter((f) => f.t <= T.now && (f.who === a.id || f.text.includes(a.id))).slice(-5).reverse();
  card.innerHTML = `<div class="big"></div><div class="r"></div><div class="s ${a.state}">${a.state === 'idle' ? 'idle at desk' : a.state === 'blocked' ? 'waiting for a yes' : a.state === 'done' ? 'just finished' : a.state === 'gone' ? 'left the floor' : 'working, lamp on'}</div><div class="task"></div><ol class="hist">${hist.map(() => '<li><span class="t"></span><span></span></li>').join('')}</ol><button type="button" id="unsel">Back to legend</button>`;
  card.querySelector('.big').textContent = String(a.name || a.id).toUpperCase().slice(0, 10); card.querySelector('.r').textContent = `${a.role} · ${a.slot.room}`; card.querySelector('.task').textContent = a.text || '—';
  card.querySelectorAll('.hist li').forEach((li, i) => { li.firstElementChild.textContent = clockStr(hist[i].t); li.lastElementChild.textContent = hist[i].text; });
  $('unsel').onclick = () => select(null);
}

/* ---- controls ---- */
$('play').onclick = () => { T.playing = !T.playing; $('play').textContent = T.playing ? 'Pause' : 'Play'; $('play').setAttribute('aria-pressed', String(T.playing)); };
$('speed').onclick = () => { T.speed = T.speed === 1 ? 4 : T.speed === 4 ? 10 : 1; $('speed').textContent = T.speed + '×'; };
$('snd').onclick = () => { audio.enable(!audio.enabled); $('snd').textContent = audio.enabled ? 'Sound on' : 'Sound off'; $('snd').setAttribute('aria-pressed', String(audio.enabled)); };
$('live').onclick = () => { T.live = true; T.playing = true; };
range.addEventListener('input', () => { const b = bounds(); T.now = b.t0 + (Number(range.value) / 1000) * (b.t1 - b.t0); T.live = false; lastNow = T.now; lastFeedN = -1; });
const typing = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName) || el.isContentEditable);
document.addEventListener('keydown', (e) => { if (typing(e.target)) return; if (e.code === 'Space') { e.preventDefault(); $('play').click(); } if (e.key === 'ArrowRight') { T.now += 2000; T.live = false; lastFeedN = -1; } if (e.key === 'ArrowLeft') { T.now -= 2000; T.live = false; lastFeedN = -1; } if (e.key === 'Escape') select(null); });

/* The "waiting for a yes" list is rebuilt only when its content changes, never per frame: a button that is
   replaced between mouse-down and mouse-up never receives its click. Countdowns update in place. */
let yesSig = '';
function renderYes(notes) {
  const sig = notes.map((n) => { const q = n.a.startsWith('job.') ? factory.question(n.a.slice(4)) : null; const ag = engine.agents.get(n.a); return n.a + '|' + (ag ? ag.name : '') + '|' + n.text + '|' + (q ? q.options.join(',') : ''); }).join(';');
  if (sig !== yesSig) {
    yesSig = sig; yesEl.replaceChildren();
    if (!notes.length) { const d = document.createElement('div'); d.className = 'none'; d.textContent = 'none'; yesEl.appendChild(d); }
    notes.forEach((n) => { const d = document.createElement('div'); d.className = 'yes-item'; d.innerHTML = '<span class="who"></span><span class="cd"></span><span class="txt"></span>'; const ag = engine.agents.get(n.a); d.children[0].textContent = ag && ag.name !== ag.id ? ag.name : n.a.replace(/^job\./, ''); d.children[2].textContent = n.text;
      const q = n.a.startsWith('job.') ? factory.question(n.a.slice(4)) : null;
      if (q) { const row = document.createElement('div'); row.className = 'yes-opts'; (q.options || []).forEach((o) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = o; b.onclick = () => factory.answer(n.a.slice(4), o); row.appendChild(b); }); const more = document.createElement('button'); more.type = 'button'; more.textContent = 'answer in Factory'; more.onclick = () => $('factory').scrollIntoView({ behavior: 'smooth' }); row.appendChild(more); d.appendChild(row); }
      yesEl.appendChild(d); });
  }
  const items = yesEl.querySelectorAll('.yes-item .cd'); notes.forEach((n, i) => { if (items[i]) { const s = n.t1 === Infinity ? 'waiting' : mmss((n.t1 - T.now) / 1000); if (items[i].textContent !== s) items[i].textContent = s; } });
}

/* ---- frame ---- */
function frame(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000); lastTs = ts;
  const b = bounds();
  if (T.mode === 'live' && T.live) T.now = Date.now() - T.lag;
  else if (T.playing) { T.now += dt * 1000 * T.speed; if (T.now > b.t1) { if (T.loop) { T.now = b.t0; lastFeedN = -1; lastNow = b.t0; } else if (T.mode === 'live') { T.live = true; } else T.now = b.t1; } }
  if (T.mode === 'live' && !T.live) $('live').hidden = false; else if (T.mode === 'live') $('live').hidden = true;
  if (audio.enabled && T.playing && T.speed <= 4 && T.now > lastNow && T.now - lastNow < 5000) for (const s of engine.sfx) if (s.t > lastNow && s.t <= T.now) audio.play(s.k);
  lastNow = T.now;
  const vw = engine.view(T.now, { reduced: RM });
  const dayFrac = T.mode === 'live' ? (((new Date(T.now).getHours() * 60 + new Date(T.now).getMinutes()) - 480) / 600) : (T.now - b.t0) / Math.max(1, b.t1 - b.t0);
  scene.render(vw, T.now, dt, Math.max(0, Math.min(1, dayFrac)), selected);
  flapAdvance(dt, (n) => audio.tick(n));
  setFlapText(F.cIn, String(vw.inN).padStart(2, '0'), 'dim'); setFlapText(F.cFloor, String(vw.floorN).padStart(2, '0'), ''); setFlapText(F.cBlocked, String(vw.blocked).padStart(2, '0'), vw.blocked ? 'warn' : 'dim'); setFlapText(F.cShipped, String(vw.shipped).padStart(3, '0'), vw.shipped ? 'ok' : 'dim');
  setFlapText(F.clock, clockStr(T.now), '');
  elapsedEl.textContent = T.mode === 'live' && T.live ? 'live' : `${mmss((T.now - b.t0) / 1000)} / ${mmss((b.t1 - b.t0) / 1000)}`;
  if (document.activeElement !== range) range.value = String(Math.round(((T.now - b.t0) / Math.max(1, b.t1 - b.t0)) * 1000));
  if (vw.feedN !== lastFeedN) {
    lastFeedN = vw.feedN; const vis = engine.feed.filter((x) => x.t <= T.now).slice(-ROWS).reverse();
    for (let r = 0; r < ROWS; r++) { const e = vis[r]; if (!e) { setFlapText(rowsF[r], '', 'dim', true); continue; } const line = `${clockStr(e.t).slice(0, 5)} ${String(e.who).slice(0, 3).padEnd(3, ' ')} ${e.text}`; const cls = e.lv === 'warn' || e.lv === 'bad' ? 'warn' : e.lv === 'ok' ? 'ok' : e.lv === 'move' ? 'move' : e.lv === 'in' || e.lv === 'dim' ? 'dim' : ''; setFlapText(rowsF[r], line.slice(0, COLS), cls, true); }
  }
  renderYes(vw.notes);
  if (selected) renderCard(vw);
  requestAnimationFrame(frame);
}

const src = new URLSearchParams(location.search).get('src') || (location.protocol === 'file:' ? 'demo' : isLoop ? 'live' : 'cloud');
if (src === 'demo') loadDemo(); else if (src === 'cloud' || (src === 'live' && !isLoop)) loadCloud(cloudFloor); else loadLive();
$('srcDemo').onclick = loadDemo; $('srcLive').onclick = () => (isLoop ? loadLive() : loadCloud(cloudFloor));
requestAnimationFrame(frame);
