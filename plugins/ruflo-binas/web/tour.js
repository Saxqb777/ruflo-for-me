// The first-run walkthrough, the way a game teaches its controls: one spotlight at a time, a coach card with
// what to do and why, progress pips, Back / Next / Skip, Enter and Esc. Shown once per person on this browser
// (a convenience: if storage is blocked it simply shows again), replayable from "How it works".
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* per-viewer only */ } } };

export function createTour({ steps, keyFor = (u) => 'binas.tour.v1.' + u }) {
  const root = document.createElement('div'); root.className = 'tour'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  root.innerHTML = '<div class="tour-spot"></div><div class="tour-card" tabindex="-1"><div class="tour-top"><span class="tour-step"></span><span class="tour-pips"></span></div><h3 class="tour-title"></h3><p class="tour-body"></p><div class="tour-chips"></div><div class="tour-acts"><button type="button" class="tour-skip quiet">Skip</button><span class="tour-sp"></span><button type="button" class="tour-back quiet">Back</button><button type="button" class="tour-next">Next</button></div></div>';
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s); const spot = $('.tour-spot'), card = $('.tour-card');
  let i = 0, list = [], user = null, onEnd = null;

  function place() {
    const s = list[i]; const el = s && s.target ? document.querySelector(s.target) : null; const r = el && el.offsetParent !== null ? el.getBoundingClientRect() : null;
    const vw = innerWidth, vh = innerHeight, pad = 8;
    if (r) { spot.style.display = ''; Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' }); } else { spot.style.display = 'none'; }
    root.classList.toggle('dim', !r);
    const cw = Math.min(380, vw - 32); card.style.width = cw + 'px'; const ch = card.offsetHeight || 220;
    let x, y;
    if (!r) { x = (vw - cw) / 2; y = (vh - ch) / 2; }
    else if (r.right + 24 + cw < vw) { x = r.right + 20; y = r.top; }
    else if (r.left - 24 - cw > 0) { x = r.left - 20 - cw; y = r.top; }
    else if (r.bottom + 20 + ch < vh) { x = r.left; y = r.bottom + 16; }
    else { x = r.left; y = r.top - ch - 16; }
    card.style.left = Math.max(16, Math.min(vw - cw - 16, x)) + 'px'; card.style.top = Math.max(16, Math.min(vh - ch - 16, y)) + 'px';
  }
  function show() {
    const s = list[i];
    $('.tour-step').textContent = `${i + 1} / ${list.length}`;
    $('.tour-pips').replaceChildren(...list.map((_, k) => { const p = document.createElement('i'); if (k < i) p.className = 'done'; if (k === i) p.className = 'on'; return p; }));
    $('.tour-title').textContent = s.title; $('.tour-body').textContent = s.body;
    const chips = $('.tour-chips'); chips.replaceChildren();
    (s.chips || []).forEach((c) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = c.label; b.onclick = () => { if (c.onPick) c.onPick(); }; chips.appendChild(b); });
    $('.tour-back').hidden = i === 0; $('.tour-next').textContent = s.cta || (i === list.length - 1 ? 'Start building' : 'Next');
    if (s.onShow) s.onShow();
    place(); requestAnimationFrame(place); card.focus();
  }
  function end(finished) {
    root.hidden = true; document.removeEventListener('keydown', onKey, true); removeEventListener('resize', place);
    if (user) store.set(keyFor(user), finished ? 'done' : 'skipped');
    const last = list[list.length - 1]; if (finished && last && last.onFinish) last.onFinish();
    if (onEnd) onEnd(finished);
  }
  function onKey(e) {
    if (root.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); end(false); }
    else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'BUTTON' && e.target.classList.contains('chip'))) { e.preventDefault(); next(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(); } else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); i--; show(); }
  }
  function next() { if (i < list.length - 1) { i++; show(); } else end(true); }
  $('.tour-next').onclick = next; $('.tour-back').onclick = () => { if (i > 0) { i--; show(); } }; $('.tour-skip').onclick = () => end(false);

  /** Start for this person; steps can depend on who they are (owner or tester). */
  function start(u, { onEnd: cb } = {}) {
    user = u ? u.username : null; onEnd = cb || null; list = typeof steps === 'function' ? steps(u) : steps; if (!list.length) return;
    i = 0; root.hidden = false; document.addEventListener('keydown', onKey, true); addEventListener('resize', place); show();
  }
  /** Start only if this person has never finished or skipped it here. */
  function maybeStart(u) { if (u && !store.get(keyFor(u.username))) { setTimeout(() => start(u), 600); return true; } return false; }
  return { start, maybeStart, get open() { return !root.hidden; } };
}
