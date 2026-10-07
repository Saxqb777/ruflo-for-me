// Split-flap cells (counters, clock, the departures board) and the opt-in synthesized sound.
export const ALPHA = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-/→✓×!·?+';
const pending = new Set();
const RM = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

class Flap {
  constructor(el) { this.el = el; this.cur = 0; this.tgt = 0; this.steps = 0; this.k = false; this.delay = 0; this.cls = ''; }
  set(ch, cls, delay) {
    const i = Math.max(0, ALPHA.indexOf(ch));
    if (cls !== undefined && cls !== this.cls) { this.cls = cls; this.el.className = 'cell ' + cls; }
    if (i === this.tgt) return;
    this.tgt = i; this.steps = 0; this.delay = delay || 0; pending.add(this);
  }
  tick() {
    if (this.delay > 0) { this.delay--; return false; }
    if (this.cur === this.tgt) { pending.delete(this); return false; }
    this.steps++; this.cur = this.steps > 10 ? this.tgt : (this.cur + 1) % ALPHA.length;
    this.el.textContent = ALPHA[this.cur] || ' ';
    if (!RM) { this.k = !this.k; this.el.className = 'cell ' + this.cls + (this.k ? ' f1' : ' f2'); }
    return true;
  }
}

export function createFlaps(container, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const s = document.createElement('span'); s.className = 'cell'; s.textContent = ' '; container.appendChild(s); out.push(new Flap(s)); }
  return out;
}
export function setFlapText(flaps, text, cls, ripple) {
  text = String(text).toUpperCase();
  for (let i = 0; i < flaps.length; i++) { let ch = text[i] || ' '; if (ALPHA.indexOf(ch) < 0) ch = ' '; flaps[i].set(ch, cls, ripple ? Math.floor(i / 2) : 0); }
}
/* Stepped from the frame loop; several steps per frame keep it converging on slow frames. */
let acc = 0;
export function flapAdvance(dt, onTick) {
  acc += dt * 1000; const steps = Math.min(6, Math.floor(acc / 45)); if (steps <= 0) return; acc -= steps * 45;
  let n = 0;
  for (const f of pending) { for (let s = 0; s < steps; s++) { if (f.tick()) n++; if (!pending.has(f)) break; } }
  if (n && onTick) onTick(Math.min(n, 4));
}

/* ---- sound: synthesized, off until the viewer turns it on ---- */
export function createAudio() {
  let ctx = null, lastTick = 0;
  const ac = () => { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; };
  const noise = (dur) => { const c = ac(); const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = b; return s; };
  const tone = (f, v, dur, type = 'sine') => { const c = ac(), t = c.currentTime; const o = c.createOscillator(); o.type = type; o.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05); };
  const S = {
    tick(n) { const c = ac(), t = c.currentTime; if (t - lastTick < 0.03) return; lastTick = t; const s = noise(0.018); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400 + Math.random() * 600; f.Q.value = 1.4; const g = c.createGain(); g.gain.setValueAtTime(0.05 + 0.02 * (n || 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.02); s.connect(f).connect(g).connect(c.destination); s.start(t); },
    thud() { const c = ac(), t = c.currentTime; const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.14); const g = c.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.2); const s = noise(0.03); const g2 = c.createGain(); g2.gain.setValueAtTime(0.2, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.03); s.connect(g2).connect(c.destination); s.start(t); },
    bell() { tone(1568, 0.16, 1.1); tone(2349, 0.07, 1.0); tone(3136, 0.04, 0.9); },
    whoosh() { const c = ac(), t = c.currentTime; const s = noise(0.5); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.4); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5); s.connect(f).connect(g).connect(c.destination); s.start(t); },
    click() { const c = ac(), t = c.currentTime; const s = noise(0.012); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800; const g = c.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.012); s.connect(f).connect(g).connect(c.destination); s.start(t); },
    thunk() { S.click(); setTimeout(S.click, 60); },
    flag() { S.thud(); setTimeout(S.click, 120); },
    slide() { const c = ac(), t = c.currentTime; const s = noise(0.3); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; const g = c.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); s.connect(f).connect(g).connect(c.destination); s.start(t); },
    belt() { tone(38, 0.03, 2.4, 'square'); },
  };
  return { enabled: false, enable(on) { this.enabled = on; if (on) ac(); }, play(kind) { if (this.enabled && S[kind]) S[kind](); }, tick(n) { if (this.enabled) S.tick(n); } };
}
