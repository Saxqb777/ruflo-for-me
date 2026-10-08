// The Build view: the stage stops showing the office and shows the thing being built. The maquette in the
// middle, the round as eight plain-word stops across the top, a narration bar that says what is happening in
// a human sentence, and, once it is live, the site itself on the stage. app.js calls render() each frame.
import { createMaquette } from './maquette.js';
import { STAGES, stagesFor, plainDoing } from './stages.js';

export function createBuildView({ THREE, $, stage, getEngine, getProject, onMode }) {
  const mq = createMaquette(THREE, $('mq'), stage, $('mqLabels'));
  const els = { gl: $('gl'), labels: $('labels'), mq: $('mq'), mqLabels: $('mqLabels'), ui: $('buildUI'), rail: $('rail'), head: $('narrHead'), sub: $('narrSub'), stats: $('narrStats'), live: $('liveWrap'), frame: $('liveFrame'), url: $('liveUrl'), openA: $('liveOpen'), show: $('liveShow'), btn: $('vBuild'), hint: $('hint') };
  let mode = 'floor', liveChoice = null, lastProject = null, railSig = '', liveSrc = '';
  const set = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

  function setMode(m) {
    mode = m === 'build' ? 'build' : 'floor'; const b = mode === 'build';
    els.gl.hidden = b; els.labels.hidden = b; els.mq.hidden = !b; els.mqLabels.hidden = !b; els.ui.hidden = !b;
    els.btn.setAttribute('aria-pressed', String(b)); if (els.hint) els.hint.textContent = b ? 'drag to turn the model · wheel to zoom · point at a piece to name it' : 'drag to orbit · wheel to zoom · press an agent · drop a .jsonl to replay';
    if (b) mq.resize(); if (onMode) onMode(mode);
  }
  els.btn.onclick = () => setMode(mode === 'build' ? 'floor' : 'build');
  $('liveHide').onclick = () => { liveChoice = false; };
  els.show.onclick = () => { liveChoice = true; };

  function focusRoot(engine) { const cur = getProject(); if (cur && cur.project) return 'job.' + cur.project.id; return engine.roots()[0] || null; }
  function renderRail(stages) {
    const sig = stages.map((s) => s.state).join(','); if (sig === railSig) return; railSig = sig;
    els.rail.replaceChildren(...stages.map((s, i) => { const li = document.createElement('li'); li.className = 'st-' + s.state; li.innerHTML = '<span class="n"></span><span class="l"></span>'; li.firstChild.textContent = s.state === 'done' ? '✓' : String(i + 1); li.lastChild.textContent = s.label; li.title = s.label + ' · ' + ({ todo: 'next', active: 'happening now', done: 'done', skipped: 'not needed this round', retry: 'trying again' }[s.state]); return li; }));
  }
  function narrate(root, vw, engine, st, files) {
    const cur = getProject(); const p = cur && cur.project; const turns = (cur && cur.turns) || [];
    const work = turns.filter((t) => t.kind === 'request' || t.kind === 'answer').pop();
    const doing = vw.agents.filter((a) => a.state === 'working' && !a.gone && root && engine.rootOf(a.id) === root).slice(0, 2);
    const stageNow = st.current >= 0 ? STAGES[st.current].label : null;
    let head;
    if (p && p.status === 'queued') head = 'In line. The workshop picks this up in a few seconds.';
    else if (p && p.status === 'approval') head = 'Waiting for the owner’s OK on this round.';
    else if (p && p.status === 'blocked') head = 'The team needs your answer. It is in the chat, with buttons.';
    else if (p && p.status === 'failed') head = 'This round stopped. Send a message and the team picks it back up.';
    else if (p && p.status === 'running') head = (work && work.note && !/^detail: /.test(work.note) ? work.note : (stageNow ? stageNow + '…' : 'The team is getting started…'));
    else if (p && p.previewUrl) head = 'It is live. Play with it, then tell the team what to change.';
    else if (p) head = 'Ready for your next message.';
    else if (st.stages[7].state === 'done' && !doing.length) head = 'Shipped. Every piece is in.';
    else if (stageNow) head = stageNow + '…';
    else if (doing.length) head = 'The floor is working.';
    else head = files.length ? `Between rounds. ${files.length} pieces built so far.` : 'Quiet floor. Open a project to watch it get built.';
    set(els.head, head);
    set(els.sub, doing.length ? doing.map((a) => `${String(a.name || a.id).toLowerCase()} · ${plainDoing(a.role, a.text)}`).join('   ·   ') : (p && p.status === 'running' ? 'between steps' : ''));
    const lines = files.reduce((n, f) => n + (Number(f.lines) || 0), 0);
    set(els.stats, files.length ? `${files.length} piece${files.length === 1 ? '' : 's'} · ${lines.toLocaleString()} lines` : '');
  }
  function renderLive() {
    const cur = getProject(); const p = cur && cur.project;
    if ((p && p.id) !== lastProject) { lastProject = p && p.id; liveChoice = null; }
    const url = p && p.previewUrl && ['idle', 'ready'].includes(p.status) ? p.previewUrl : null;
    const open = !!url && liveChoice !== false;
    els.live.hidden = !open; els.show.hidden = !url || open;
    if (open && liveSrc !== url) { liveSrc = url; els.frame.src = url; set(els.url, url.replace(/^https:\/\//, '')); els.openA.href = url; }
    if (!url && liveSrc) { liveSrc = ''; els.frame.removeAttribute('src'); }
  }

  /** One frame of the Build view. vw is the engine's view at `now` (already computed by app.js). */
  function render(vw, now, dt) {
    const engine = getEngine(); const root = focusRoot(engine);
    const files = root ? engine.files(root, now) : []; const active = root ? engine.activeFile(root, now) : null;
    const st = stagesFor(engine, root, now);
    const cur = getProject(); const p = cur && cur.project;
    const title = p ? p.title : root ? String((engine.agents.get(root) || {}).name || root) : '';
    mq.render({ files, active, dt, testsOk: st.stages[4].state === 'done', live: st.stages[7].state === 'done' || !!(p && p.previewUrl), title, who: (id) => String((engine.agents.get(id) || {}).name || id).toLowerCase() });
    renderRail(st.stages); narrate(root, vw, engine, st, files); renderLive();
  }
  return { setMode, render, get mode() { return mode; } };
}
